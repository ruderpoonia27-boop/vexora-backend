import crypto from 'crypto';
import express from 'express';
import mongoose from 'mongoose';
import User from '../models/User.js';
import Deposit from '../models/Deposit.js';
import Withdrawal from '../models/Withdrawal.js';
import Refund from '../models/Refund.js';
import Tournament from '../models/Tournament.js';
import WalletTransaction from '../models/WalletTransaction.js';
import { isDBConnected } from '../config/database.js';
import { getStore, persistStore } from '../config/fileStore.js';
import { authenticate } from '../middleware/auth.js';
import { getCachedSettings } from './settings.js';
import { serializeDeposit, serializeWithdrawal } from '../utils/serializers.js';
import { completeReferralFirstDeposit, ensureReferralState } from '../utils/referrals.js';
import {
  createCashfreeOrder,
  getCashfreeMode,
  getCashfreeOrder,
  getCashfreeOrderPayments,
  isCashfreeEnabled,
  verifyCashfreeWebhook
} from '../utils/cashfree.js';

const router = express.Router();

const ACTIVITY_LIMIT = 100;
const UTR_PATTERN = /^[A-Za-z0-9]{6,30}$/;
const UPI_PATTERN = /^[A-Za-z0-9._-]{2,256}@[A-Za-z]{2,64}$/;

const idOf = (value) => String(value?._id ?? value ?? '');

const toTime = (value) => {
  const time = new Date(value || 0).getTime();
  return Number.isNaN(time) ? 0 : time;
};

// Older withdrawals were only debited on approval; they still reserve balance while pending.
const isLegacyReserve = (withdrawal) => (
  withdrawal.status === 'pending'
  && (withdrawal.debited_at_request === false || withdrawal.debitedAtRequest === false)
);

const getLimits = async () => {
  const settings = isDBConnected() ? await getCachedSettings() : (await getStore()).settings;
  return {
    minDeposit: settings?.min_deposit_amount || 10,
    minWithdraw: settings?.min_withdraw_amount || 50
  };
};

const depositStatus = (status) => (status === 'approved' ? 'completed' : status || 'pending');

const buildActivity = ({ userId, deposits, withdrawals, refunds, transactions, tournaments }) => {
  const tournamentTitle = new Map(tournaments.map((tournament) => [
    idOf(tournament),
    tournament.title || tournament.name || 'Tournament'
  ]));
  const titleFor = (tournamentId) => tournamentTitle.get(idOf(tournamentId)) || 'Tournament';
  const items = [];

  for (const deposit of deposits) {
    // Gateway checkouts that were never paid are not real activity.
    if (deposit.status === 'awaiting_payment' || deposit.status === 'failed') continue;
    items.push({
      id: `deposit_${idOf(deposit)}`,
      kind: 'deposit',
      title: 'Deposit',
      subtitle: deposit.gateway === 'cashfree' ? 'Paid online' : `UTR ${deposit.transaction_id}`,
      amount: Number(deposit.amount || 0),
      direction: 'in',
      status: depositStatus(deposit.status),
      createdAt: deposit.createdAt
    });
  }

  for (const withdrawal of withdrawals) {
    const debitedOnRequest = withdrawal.debited_at_request !== false && withdrawal.debitedAtRequest !== false;
    const refunded = withdrawal.status === 'rejected' && debitedOnRequest;
    items.push({
      id: `withdrawal_${idOf(withdrawal)}`,
      kind: 'withdrawal',
      title: 'Withdrawal',
      subtitle: refunded ? 'Rejected · amount returned to wallet' : `To ${withdrawal.upi_id}`,
      amount: Number(withdrawal.amount || 0),
      direction: 'out',
      status: depositStatus(withdrawal.status),
      createdAt: withdrawal.createdAt
    });
  }

  for (const refund of refunds) {
    items.push({
      id: `refund_${idOf(refund)}`,
      kind: 'refund',
      title: 'Refund',
      subtitle: titleFor(refund.tournamentId),
      amount: Number(refund.amount || 0),
      direction: 'in',
      status: 'completed',
      createdAt: refund.createdAt
    });
  }

  const transactionTitles = {
    reward: 'Prize won',
    admin_credit: 'Added by admin',
    admin_debit: 'Deducted by admin'
  };
  for (const transaction of transactions) {
    const type = transaction.type || 'reward';
    items.push({
      id: `txn_${idOf(transaction)}`,
      kind: type,
      title: transactionTitles[type] || 'Wallet update',
      subtitle: type === 'reward' ? titleFor(transaction.tournamentId) : (transaction.description || ''),
      amount: Number(transaction.amount || 0),
      direction: type === 'admin_debit' ? 'out' : 'in',
      status: 'completed',
      createdAt: transaction.createdAt
    });
  }

  // Entry fees are not stored as transactions, so derive them from tournament participation.
  for (const tournament of tournaments) {
    const title = titleFor(tournament._id);
    const captainSquads = (tournament.squads || []).filter((squad) => idOf(squad.captain) === userId);
    for (const squad of captainSquads) {
      const amount = Number(squad.total_entry_fee || 0);
      if (amount <= 0) continue;
      items.push({
        id: `entry_${idOf(tournament)}_${idOf(squad)}`,
        kind: 'entry_fee',
        title: 'Squad entry fee',
        subtitle: title,
        amount,
        direction: 'out',
        status: 'completed',
        createdAt: squad.createdAt || tournament.createdAt
      });
    }

    if ((tournament.match_type || 'solo') === 'squad') continue;
    const profile = (tournament.participant_profiles || []).find((item) => idOf(item.user ?? item.userId) === userId);
    if (!profile) continue;
    const usedFreeEntry = profile.join_method === 'free_entry';
    const amount = usedFreeEntry ? 0 : Number(tournament.entry_fee || 0);
    if (!usedFreeEntry && amount <= 0) continue;
    items.push({
      id: `entry_${idOf(tournament)}`,
      kind: usedFreeEntry ? 'free_entry' : 'entry_fee',
      title: usedFreeEntry ? 'Free entry used' : 'Tournament entry fee',
      subtitle: title,
      amount,
      direction: usedFreeEntry ? 'none' : 'out',
      status: 'completed',
      createdAt: profile.joined_at || tournament.createdAt
    });
  }

  return items
    .sort((left, right) => toTime(right.createdAt) - toTime(left.createdAt))
    .slice(0, ACTIVITY_LIMIT);
};

const loadWalletRecords = async (userId) => {
  if (isDBConnected()) {
    const objectId = new mongoose.Types.ObjectId(userId);
    const byUser = { userId: objectId };
    const recent = (Model) => Model.find(byUser).sort({ createdAt: -1 }).limit(ACTIVITY_LIMIT).lean();
    const [deposits, withdrawals, refunds, transactions, tournaments] = await Promise.all([
            recent(Deposit),
      recent(Withdrawal),
      recent(Refund),
      recent(WalletTransaction),
      Tournament.find({ $or: [{ currentPlayers: objectId }, { 'squads.captain': objectId }] })
        .select({
          title: 1,
          name: 1,
          entry_fee: 1,
          match_type: 1,
          createdAt: 1,
          participant_profiles: { $elemMatch: { user: objectId } },
          squads: { $elemMatch: { captain: objectId } }
        })
        .sort({ createdAt: -1 })
        .limit(ACTIVITY_LIMIT)
        .lean()
    ]);
    return { deposits, withdrawals, refunds, transactions, tournaments };
  }

  const store = await getStore();
  const mine = (items) => (items || []).filter((item) => idOf(item.userId) === userId);
  return {
    deposits: mine(store.deposits),
    withdrawals: mine(store.withdrawals),
    refunds: mine(store.refunds),
    transactions: mine(store.walletTransactions),
    tournaments: (store.tournaments || []).filter((tournament) => (
      (tournament.currentPlayers || []).some((player) => idOf(player) === userId)
      || (tournament.squads || []).some((squad) => idOf(squad.captain) === userId)
    ))
  };
};

const sumAmounts = (items) => items.reduce((total, item) => total + Number(item.amount || 0), 0);

router.get('/', authenticate, async (req, res) => {
  try {
    const userId = idOf(req.user);
    const [records, limits] = await Promise.all([loadWalletRecords(userId), getLimits()]);
    // req.user was loaded by authenticate moments ago, so its balance is current.
    records.balance = Number(req.user.walletBalance || 0);
    const reserved = sumAmounts(records.withdrawals.filter(isLegacyReserve));

    // Catch payments whose webhook never arrived (e.g. the user closed the tab mid-checkout).
    if (isCashfreeEnabled() && isDBConnected()) {
      const cutoff = Date.now() - 2 * 60 * 60 * 1000;
      records.deposits
        .filter((deposit) => deposit.gateway === 'cashfree' && deposit.status === 'awaiting_payment' && toTime(deposit.createdAt) > cutoff)
        .slice(0, 3)
        .forEach((deposit) => {
          settleCashfreeOrder(deposit.gateway_order_id).catch(() => {});
        });
    }

    return res.json({
      balance: records.balance,
      available: Math.max(0, records.balance - reserved),
      pending: {
        deposits: sumAmounts(records.deposits.filter((item) => item.status === 'pending')),
        withdrawals: sumAmounts(records.withdrawals.filter((item) => item.status === 'pending'))
      },
      limits,
      gateway: {
        cashfree: isCashfreeEnabled() && isDBConnected(),
        mode: getCashfreeMode()
      },
      activity: buildActivity({ userId, ...records })
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

export const requestDeposit = async (req, res) => {
  try {
    const userId = idOf(req.user);
    const amount = Number(req.body.amount);
    const utr = String(req.body.utr ?? req.body.transactionId ?? req.body.transaction_id ?? '').trim();
    const { minDeposit } = await getLimits();

    if (!Number.isFinite(amount) || amount < minDeposit) {
      return res.status(400).json({ error: `Minimum deposit is Rs.${minDeposit}` });
    }
    if (!UTR_PATTERN.test(utr)) {
      return res.status(400).json({ error: 'Enter the 6-30 character UTR / transaction ID from your payment app' });
    }

    if (isDBConnected()) {
      const duplicate = await Deposit.exists({ transaction_id: utr, status: { $in: ['pending', 'approved'] } });
      if (duplicate) return res.status(400).json({ error: 'This UTR has already been submitted' });

      const deposit = await Deposit.create({
        userId,
        amount,
        transaction_id: utr,
        payment_method: 'UPI',
        status: 'pending'
      });
      return res.status(201).json({ message: 'Deposit submitted for approval', deposit: serializeDeposit(deposit) });
    }

    const store = await getStore();
    const duplicate = (store.deposits || []).some((item) => item.transaction_id === utr && item.status !== 'rejected');
    if (duplicate) return res.status(400).json({ error: 'This UTR has already been submitted' });

    const deposit = {
      _id: `offline_dep_${store.nextIds.deposit++}`,
      userId,
      amount,
      transaction_id: utr,
      payment_method: 'UPI',
      status: 'pending',
      createdAt: new Date().toISOString()
    };
    store.deposits.push(deposit);
    await persistStore();
    return res.status(201).json({ message: 'Deposit submitted for approval', deposit: serializeDeposit(deposit) });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

export const requestWithdrawal = async (req, res) => {
  try {
    const userId = idOf(req.user);
    const amount = Number(req.body.amount);
    const upiId = String(req.body.upiId ?? req.body.upi_id ?? '').trim();
    const { minWithdraw } = await getLimits();

    if (!Number.isFinite(amount) || amount < minWithdraw) {
      return res.status(400).json({ error: `Minimum withdrawal is Rs.${minWithdraw}` });
    }
    if (!UPI_PATTERN.test(upiId)) {
      return res.status(400).json({ error: 'Enter a valid UPI ID, like name@bank' });
    }

    if (isDBConnected()) {
      const legacyPending = await Withdrawal.find({ userId, status: 'pending', debited_at_request: false }).select('amount').lean();
      const reserved = sumAmounts(legacyPending);

      // Debit atomically so two parallel requests cannot spend the same balance.
      const user = await User.findOneAndUpdate(
        { _id: userId, walletBalance: { $gte: amount + reserved } },
        { $inc: { walletBalance: -amount } },
        { new: true }
      ).select('walletBalance');
      if (!user) return res.status(400).json({ error: 'Insufficient balance' });

      try {
        const withdrawal = await Withdrawal.create({
          userId,
          amount,
          upi_id: upiId,
          debited_at_request: true,
          status: 'pending'
        });
        return res.status(201).json({
          message: 'Withdrawal requested',
          balance: user.walletBalance,
          withdrawal: serializeWithdrawal(withdrawal)
        });
      } catch (error) {
        await User.updateOne({ _id: userId }, { $inc: { walletBalance: amount } });
        throw error;
      }
    }

    const store = await getStore();
    const user = store.users.find((item) => idOf(item) === userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const reserved = sumAmounts((store.withdrawals || []).filter((item) => idOf(item.userId) === userId && isLegacyReserve(item)));
    if (Number(user.walletBalance || 0) - reserved < amount) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }

    user.walletBalance = Number(user.walletBalance || 0) - amount;
    const withdrawal = {
      _id: `offline_wd_${store.nextIds.withdrawal++}`,
      userId,
      amount,
      upi_id: upiId,
      debited_at_request: true,
      status: 'pending',
      createdAt: new Date().toISOString()
    };
    store.withdrawals.push(withdrawal);
    await persistStore();
    return res.status(201).json({
      message: 'Withdrawal requested',
      balance: user.walletBalance,
      withdrawal: serializeWithdrawal(withdrawal)
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

// ---------- Cashfree automatic deposits ----------
// Flow: create order -> user pays on Cashfree checkout -> we confirm by fetching the order from
// Cashfree (on return and via webhook) and credit the wallet exactly once.

const PHONE_PATTERN = /^[6-9]\d{9}$/;
const MAX_OPEN_ORDERS_PER_HOUR = 10;
const FAILED_ORDER_STATES = new Set(['EXPIRED', 'TERMINATED', 'TERMINATION_REQUESTED']);

const clientOrigin = (req) => {
  // The CORS middleware has already rejected unknown origins.
  const origin = String(req.headers.origin || '').replace(/\/+$/, '');
  if (origin) return origin;
  return (process.env.CLIENT_URL || 'http://localhost:3000').split(',')[0].trim().replace(/\/+$/, '');
};

const webhookUrl = () => {
  const base = String(process.env.BACKEND_PUBLIC_URL || '').trim().replace(/\/+$/, '');
  return base.startsWith('https://') ? `${base}/api/wallet/cashfree/webhook` : '';
};

const requireGateway = (req, res, next) => {
  if (!isCashfreeEnabled() || !isDBConnected()) {
    return res.status(503).json({ error: 'Online payment is not available right now. Please use manual UPI deposit.' });
  }
  return next();
};

const processFirstDepositReferral = async (userId, depositId) => {
  const user = await User.findById(userId);
  if (!user || !(user.referred_by || user.referred_by_code)) return;
  const earlierDeposits = await Deposit.countDocuments({ userId, _id: { $ne: depositId }, status: 'approved' });
  if (earlierDeposits > 0) return;

  const referrer = user.referred_by
    ? await User.findById(user.referred_by)
    : await User.findOne({ referral_code: user.referred_by_code });
  if (!referrer) return;

  ensureReferralState(referrer);
  const achievement = completeReferralFirstDeposit(referrer, user, new Date());
  referrer.notifications.push({
    type: 'referral',
    message: achievement
      ? `${achievement.title} ${achievement.subtitle}`
      : `${user.name || user.email} completed their first deposit from your referral link.`,
    link: '/referral',
    read: false,
    createdAt: new Date()
  });
  await referrer.save();
  await Deposit.updateOne({ _id: depositId }, { $set: { referral_processed_at: new Date() } });
};

// Safe to call any number of times, from the return page and the webhook concurrently.
const settleCashfreeOrder = async (orderId) => {
  const deposit = await Deposit.findOne({ gateway: 'cashfree', gateway_order_id: orderId }).lean();
  if (!deposit) return 'not_found';
  if (deposit.status === 'approved') return 'paid';
  if (deposit.status === 'failed') return 'failed';

  const order = await getCashfreeOrder(orderId);

  if (order.order_status === 'PAID') {
    if (Math.abs(Number(order.order_amount) - Number(deposit.amount)) > 0.001) {
      console.error(`Cashfree amount mismatch for ${orderId}: paid ${order.order_amount}, expected ${deposit.amount}`);
      return 'pending';
    }

    let paymentId = '';
    try {
      const payments = await getCashfreeOrderPayments(orderId);
      paymentId = String((payments || []).find((payment) => payment.payment_status === 'SUCCESS')?.cf_payment_id || '');
    } catch {
      // The payment id is only for records; the order status is what matters.
    }

    const credited = await Deposit.findOneAndUpdate(
      { _id: deposit._id, status: 'awaiting_payment' },
      { $set: { status: 'approved', wallet_credited_at: new Date(), gateway_payment_id: paymentId } },
      { new: true }
    );
    if (credited) {
      await User.updateOne(
        { _id: deposit.userId },
        {
          $inc: { walletBalance: deposit.amount },
          $push: {
            notifications: {
              type: 'wallet',
              message: `Rs.${deposit.amount} added to your wallet.`,
              link: '/wallet',
              read: false,
              createdAt: new Date()
            }
          }
        }
      );
      await processFirstDepositReferral(deposit.userId, deposit._id)
        .catch((error) => console.error('Referral processing failed:', error.message));
    }
    return 'paid';
  }

  if (FAILED_ORDER_STATES.has(order.order_status)) {
    await Deposit.updateOne({ _id: deposit._id, status: 'awaiting_payment' }, { $set: { status: 'failed' } });
    return 'failed';
  }

  return 'pending';
};

router.post('/cashfree/order', authenticate, requireGateway, async (req, res) => {
  try {
    const userId = idOf(req.user);
    const amount = Math.round(Number(req.body.amount) * 100) / 100;
    const phone = String(req.body.phone || '').replace(/\D/g, '').slice(-10);
    const { minDeposit } = await getLimits();

    if (!Number.isFinite(amount) || amount < minDeposit) {
      return res.status(400).json({ error: `Minimum deposit is Rs.${minDeposit}` });
    }
    if (!PHONE_PATTERN.test(phone)) {
      return res.status(400).json({ error: 'Enter a valid 10-digit mobile number' });
    }

    const openOrders = await Deposit.countDocuments({
      userId,
      gateway: 'cashfree',
      status: 'awaiting_payment',
      createdAt: { $gte: new Date(Date.now() - 60 * 60 * 1000) }
    });
    if (openOrders >= MAX_OPEN_ORDERS_PER_HOUR) {
      return res.status(429).json({ error: 'Too many unfinished payments. Please try again later.' });
    }

    const orderId = `VX_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
    const deposit = await Deposit.create({
      userId,
      amount,
      transaction_id: orderId,
      payment_method: 'CASHFREE',
      gateway: 'cashfree',
      gateway_order_id: orderId,
      status: 'awaiting_payment'
    });

    try {
      const order = await createCashfreeOrder({
        orderId,
        amount,
        customer: { id: userId, name: req.user.name, email: req.user.email, phone },
        returnUrl: `${clientOrigin(req)}/wallet?cf_order={order_id}`,
        notifyUrl: webhookUrl()
      });
      return res.status(201).json({ orderId, paymentSessionId: order.payment_session_id, mode: getCashfreeMode() });
    } catch (error) {
      await Deposit.deleteOne({ _id: deposit._id });
      console.error('Cashfree create order failed:', error.message);
      return res.status(502).json({ error: 'Could not start the payment. Please try again.' });
    }
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.get('/cashfree/order/:orderId', authenticate, requireGateway, async (req, res) => {
  try {
    const owned = await Deposit.exists({ gateway_order_id: req.params.orderId, userId: idOf(req.user) });
    if (!owned) return res.status(404).json({ error: 'Payment not found' });

    const status = await settleCashfreeOrder(req.params.orderId);
    const user = await User.findById(idOf(req.user)).select('walletBalance').lean();
    return res.json({ status, balance: Number(user?.walletBalance || 0) });
  } catch (error) {
    console.error('Cashfree verify failed:', error.message);
    return res.status(502).json({ error: 'Could not confirm the payment yet. It will update automatically.' });
  }
});

router.post('/cashfree/webhook', async (req, res) => {
  if (!isCashfreeEnabled()) return res.status(503).end();
  if (!verifyCashfreeWebhook(req.rawBody, req.get('x-webhook-timestamp'), req.get('x-webhook-signature'))) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const orderId = req.body?.data?.order?.order_id;
  if (orderId && isDBConnected()) {
    try {
      await settleCashfreeOrder(orderId);
    } catch (error) {
      console.error('Cashfree webhook settle failed:', error.message);
      // Non-200 makes Cashfree retry the webhook later.
      return res.status(500).json({ error: 'Retry later' });
    }
  }
  return res.json({ received: true });
});

router.post('/deposit', authenticate, requestDeposit);
router.post('/withdraw', authenticate, requestWithdrawal);

export default router;
