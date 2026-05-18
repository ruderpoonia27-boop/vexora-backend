import express from 'express';
import { getStore, persistStore } from '../config/fileStore.js';
import { isDBConnected } from '../config/database.js';
import User from '../models/User.js';
import Deposit from '../models/Deposit.js';
import Withdrawal from '../models/Withdrawal.js';
import { authenticate, authorizeAdmin } from '../middleware/auth.js';
import { serializeDeposit, serializeUser, serializeWithdrawal } from '../utils/serializers.js';
import { completeReferralFirstDeposit, ensureReferralState, ensureReferralStats } from '../utils/referrals.js';

const router = express.Router();

const addUserNotification = (user, payload) => {
  user.notifications = user.notifications || [];
  user.notifications.push({
    message: payload.message,
    type: payload.type || 'info',
    link: payload.link || '',
    read: false,
    createdAt: new Date()
  });
};

const addOfflineUserNotification = (user, payload) => {
  user.notifications = user.notifications || [];
  user.notifications.push({
    _id: `offline_note_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    message: payload.message,
    type: payload.type || 'info',
    link: payload.link || '',
    read: false,
    createdAt: new Date().toISOString()
  });
};

router.get('/users', authenticate, authorizeAdmin, async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const perPage = Math.max(1, Number(req.query.perPage || req.query.limit) || 50);
    const search = req.query.search || '';
    const status = req.query.status || 'all';

    if (isDBConnected()) {
      const filter = {};
      if (search) {
        filter.$or = [
          { name: { $regex: search, $options: 'i' } },
          { email: { $regex: search, $options: 'i' } }
        ];
      }
      if (status === 'blocked') filter.isBlocked = true;
      if (status === 'active') filter.isBlocked = { $ne: true };

      const [totalItems, users] = await Promise.all([
        User.countDocuments(filter),
        User.find(filter).select('-password').sort({ createdAt: -1 }).skip((page - 1) * perPage).limit(perPage)
      ]);
      const items = users.map(serializeUser);
      return res.json({ items, users: items, page, perPage, totalItems, totalPages: Math.ceil(totalItems / perPage) || 1 });
    }

    const store = await getStore();
    let items = store.users.map(serializeUser);
    if (search) {
      const lower = search.toLowerCase();
      items = items.filter(user => user.name?.toLowerCase().includes(lower) || user.email?.toLowerCase().includes(lower));
    }
    if (status === 'blocked') items = items.filter(user => user.isBlocked);
    if (status === 'active') items = items.filter(user => !user.isBlocked);
    const totalItems = items.length;
    const start = (page - 1) * perPage;
    items = items.slice(start, start + perPage);
    return res.json({ items, users: items, page, perPage, totalItems, totalPages: Math.ceil(totalItems / perPage) || 1 });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.patch('/users/:id/block', authenticate, authorizeAdmin, async (req, res) => {
  try {
    const shouldBlock = req.body.isBlocked !== false;
    const reason = req.body.reason || '';

    if (req.user._id?.toString?.() === req.params.id || req.user._id === req.params.id) {
      return res.status(400).json({ error: 'You cannot block your own admin account' });
    }

    if (isDBConnected()) {
      const user = await User.findById(req.params.id);
      if (!user) return res.status(404).json({ error: 'User not found' });
      if (user.isAdmin && shouldBlock) return res.status(400).json({ error: 'Admin accounts cannot be blocked here' });

      user.isBlocked = shouldBlock;
      user.blockedAt = shouldBlock ? new Date() : undefined;
      user.blockedReason = shouldBlock ? reason : '';
      await user.save();
      return res.json({ message: shouldBlock ? 'User blocked' : 'User unblocked', user: serializeUser(user) });
    }

    const store = await getStore();
    const user = store.users.find(u => u._id === req.params.id || u.id === req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.isAdmin && shouldBlock) return res.status(400).json({ error: 'Admin accounts cannot be blocked here' });

    user.isBlocked = shouldBlock;
    user.blockedAt = shouldBlock ? new Date().toISOString() : null;
    user.blockedReason = shouldBlock ? reason : '';
    await persistStore();
    return res.json({ message: shouldBlock ? 'User blocked' : 'User unblocked', user: serializeUser(user) });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/users/:id/balance', authenticate, authorizeAdmin, async (req, res) => {
  try {
    const action = req.body.action;
    const amount = Number(req.body.amount);
    const note = req.body.note || '';

    if (!['add', 'deduct'].includes(action)) {
      return res.status(400).json({ error: 'Action must be add or deduct' });
    }
    if (Number.isNaN(amount) || amount <= 0) {
      return res.status(400).json({ error: 'Amount must be greater than 0' });
    }

    const delta = action === 'add' ? amount : -amount;

    if (isDBConnected()) {
      const user = await User.findById(req.params.id);
      if (!user) return res.status(404).json({ error: 'User not found' });
      const nextBalance = (user.walletBalance || 0) + delta;
      if (nextBalance < 0) return res.status(400).json({ error: 'Cannot deduct more than current wallet balance' });

      user.walletBalance = nextBalance;
      addUserNotification(user, {
        type: 'wallet',
        message: `Admin ${action === 'add' ? 'added' : 'deducted'} Rs.${amount}${note ? `: ${note}` : ''}`,
        link: '/wallet'
      });
      await user.save();
      return res.json({ message: 'Wallet balance updated', user: serializeUser(user) });
    }

    const store = await getStore();
    const user = store.users.find(u => u._id === req.params.id || u.id === req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const nextBalance = (user.walletBalance || 0) + delta;
    if (nextBalance < 0) return res.status(400).json({ error: 'Cannot deduct more than current wallet balance' });

    user.walletBalance = nextBalance;
    addOfflineUserNotification(user, {
      type: 'wallet',
      message: `Admin ${action === 'add' ? 'added' : 'deducted'} Rs.${amount}${note ? `: ${note}` : ''}`,
      link: '/wallet'
    });
    await persistStore();
    return res.json({ message: 'Wallet balance updated', user: serializeUser(user) });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

const grantFreeEntries = async (req, res) => {
  try {
    const amount = Number(req.body.amount);
    const note = req.body.note || '';

    if (Number.isNaN(amount) || amount <= 0 || !Number.isInteger(amount)) {
      return res.status(400).json({ error: 'Free entries amount must be a whole number greater than 0' });
    }

    if (isDBConnected()) {
      const user = await User.findById(req.params.id);
      if (!user) return res.status(404).json({ error: 'User not found' });

      const stats = ensureReferralStats(user);
      stats.free_entries_earned = Number(stats.free_entries_earned || 0) + amount;
      user.referral_stats = stats;
      user.referralStats = stats;

      addUserNotification(user, {
        type: 'referral',
        message: `Admin granted ${amount} free ${amount === 1 ? 'entry' : 'entries'}${note ? `: ${note}` : ''}`,
        link: '/referral'
      });

      await user.save();
      return res.json({ message: 'Free entries granted', user: serializeUser(user) });
    }

    const store = await getStore();
    const user = store.users.find(u => u._id === req.params.id || u.id === req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const stats = ensureReferralStats(user);
    stats.free_entries_earned = Number(stats.free_entries_earned || 0) + amount;
    user.referral_stats = stats;
    user.referralStats = stats;

    addOfflineUserNotification(user, {
      type: 'referral',
      message: `Admin granted ${amount} free ${amount === 1 ? 'entry' : 'entries'}${note ? `: ${note}` : ''}`,
      link: '/referral'
    });

    await persistStore();
    return res.json({ message: 'Free entries granted', user: serializeUser(user) });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

router.post('/users/:id/free-entries', authenticate, authorizeAdmin, grantFreeEntries);
router.post('/users/:id/freeEntries', authenticate, authorizeAdmin, grantFreeEntries);

router.get('/deposits', authenticate, authorizeAdmin, async (req, res) => {
  try {
    if (isDBConnected()) {
      const deposits = await Deposit.find().sort({ createdAt: -1 }).populate('userId', 'name email');
      return res.json(deposits.map(serializeDeposit));
    }

    const store = await getStore();
    const enriched = store.deposits.map(deposit => {
      const user = store.users.find(u => u._id === deposit.userId || u.id === deposit.userId);
      return {
        ...serializeDeposit(deposit),
        expand: {
          userId: user ? { name: user.name, email: user.email } : null
        }
      };
    });
    return res.json(enriched.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/deposits/:id/approve', authenticate, authorizeAdmin, async (req, res) => {
  try {
    if (isDBConnected()) {
      const deposit = await Deposit.findById(req.params.id);
      if (!deposit) return res.status(404).json({ error: 'Deposit not found' });
      if (deposit.status !== 'pending') return res.status(400).json({ error: `Deposit already ${deposit.status}` });

      deposit.status = 'approved';
      const user = await User.findById(deposit.userId);
      let referrer = null;
      if (user) {
        const approvedDepositsBefore = await Deposit.countDocuments({
          userId: deposit.userId,
          _id: { $ne: deposit._id },
          status: 'approved'
        });
        user.walletBalance = (user.walletBalance || 0) + deposit.amount;
        deposit.wallet_credited_at = new Date();
        addUserNotification(user, {
          type: 'wallet',
          message: `Your deposit of Rs.${deposit.amount} was approved.`,
          link: '/wallet'
        });

        if (approvedDepositsBefore === 0 && !deposit.referral_processed_at && (user.referred_by || user.referred_by_code)) {
          referrer = user.referred_by
            ? await User.findById(user.referred_by)
            : await User.findOne({ referral_code: user.referred_by_code });

          if (referrer) {
            ensureReferralState(referrer);
            const achievement = completeReferralFirstDeposit(referrer, user, new Date());
            const referralMessage = achievement
              ? `${achievement.title} ${achievement.subtitle}`
              : `${user.name || user.email} completed their first deposit from your referral link.`;
            addUserNotification(referrer, {
              type: 'referral',
              message: referralMessage,
              link: '/referral'
            });
            deposit.referral_processed_at = new Date();
          }
        }
      }
      if (user) await user.save();
      if (referrer) await referrer.save();
      await deposit.save();
      await deposit.populate('userId', 'name email');
      return res.json({ message: 'Deposit approved', deposit: serializeDeposit(deposit) });
    }

    const store = await getStore();
    const depositIndex = store.deposits.findIndex(d => d._id === req.params.id || d.id === req.params.id);
    if (depositIndex === -1) return res.status(404).json({ error: 'Deposit not found' });
    const deposit = store.deposits[depositIndex];
    if (deposit.status !== 'pending') return res.status(400).json({ error: `Deposit already ${deposit.status}` });
    deposit.status = 'approved';
    const user = store.users.find(u => u._id === deposit.userId || u.id === deposit.userId);
    if (user) {
      const approvedDepositsBefore = store.deposits.filter((item) => (
        item.userId === deposit.userId && item.status === 'approved' && item._id !== deposit._id
      )).length;
      user.walletBalance = (user.walletBalance || 0) + deposit.amount;
      addOfflineUserNotification(user, {
        type: 'wallet',
        message: `Your deposit of Rs.${deposit.amount} was approved.`,
        link: '/wallet'
      });

      if (approvedDepositsBefore === 0 && (user.referred_by || user.referred_by_code)) {
        const referrer = store.users.find((item) => item._id === user.referred_by || item.referral_code === user.referred_by_code);
        if (referrer) {
          ensureReferralState(referrer);
          const achievement = completeReferralFirstDeposit(referrer, user, new Date().toISOString());
          addOfflineUserNotification(referrer, {
            type: 'referral',
            message: achievement
              ? `${achievement.title} ${achievement.subtitle}`
              : `${user.name || user.email} completed their first deposit from your referral link.`,
            link: '/referral'
          });
        }
      }
    }
    await persistStore();
    res.json({ message: 'Deposit approved', deposit: serializeDeposit(deposit) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/deposits/:id/reject', authenticate, authorizeAdmin, async (req, res) => {
  try {
    if (isDBConnected()) {
      const deposit = await Deposit.findById(req.params.id);
      if (!deposit) return res.status(404).json({ error: 'Deposit not found' });
      if (deposit.status !== 'pending') return res.status(400).json({ error: `Deposit already ${deposit.status}` });

      deposit.status = 'rejected';
      const user = await User.findById(deposit.userId);
      if (user) {
        addUserNotification(user, {
          type: 'wallet',
          message: `Your deposit of Rs.${deposit.amount} was rejected.`,
          link: '/wallet'
        });
        await user.save();
      }
      await deposit.save();
      await deposit.populate('userId', 'name email');
      return res.json({ message: 'Deposit rejected', deposit: serializeDeposit(deposit) });
    }

    const store = await getStore();
    const depositIndex = store.deposits.findIndex(d => d._id === req.params.id || d.id === req.params.id);
    if (depositIndex === -1) return res.status(404).json({ error: 'Deposit not found' });
    const deposit = store.deposits[depositIndex];
    if (deposit.status !== 'pending') return res.status(400).json({ error: `Deposit already ${deposit.status}` });
    deposit.status = 'rejected';
    const user = store.users.find(u => u._id === deposit.userId || u.id === deposit.userId);
    if (user) {
      addOfflineUserNotification(user, {
        type: 'wallet',
        message: `Your deposit of Rs.${deposit.amount} was rejected.`,
        link: '/wallet'
      });
    }
    await persistStore();
    res.json({ message: 'Deposit rejected', deposit: serializeDeposit(deposit) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/withdrawals', authenticate, authorizeAdmin, async (req, res) => {
  try {
    if (isDBConnected()) {
      const withdrawals = await Withdrawal.find().sort({ createdAt: -1 }).populate('userId', 'name email');
      return res.json(withdrawals.map(serializeWithdrawal));
    }

    const store = await getStore();
    const enriched = store.withdrawals.map(wd => {
      const user = store.users.find(u => u._id === wd.userId || u.id === wd.userId);
      return {
        ...serializeWithdrawal(wd),
        expand: {
          userId: user ? { name: user.name, email: user.email } : null
        }
      };
    });
    return res.json(enriched.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/withdrawals/:id/approve', authenticate, authorizeAdmin, async (req, res) => {
  try {
    if (isDBConnected()) {
      const withdrawal = await Withdrawal.findById(req.params.id);
      if (!withdrawal) return res.status(404).json({ error: 'Withdrawal not found' });
      if (withdrawal.status !== 'pending') return res.status(400).json({ error: `Withdrawal already ${withdrawal.status}` });

      const user = await User.findById(withdrawal.userId);
      if (user) {
        const wasDebitedOnRequest = withdrawal.debited_at_request !== false && withdrawal.debitedAtRequest !== false;
        if (!wasDebitedOnRequest) {
          if ((user.walletBalance || 0) < withdrawal.amount) {
            return res.status(400).json({ error: 'User wallet balance is no longer sufficient for this withdrawal' });
          }
          user.walletBalance = (user.walletBalance || 0) - withdrawal.amount;
        }
        withdrawal.status = 'approved';
        addUserNotification(user, {
          type: 'wallet',
          message: `Your withdrawal of Rs.${withdrawal.amount} was approved.`,
          link: '/wallet'
        });
        await user.save();
      } else {
        withdrawal.status = 'approved';
      }
      await withdrawal.save();
      await withdrawal.populate('userId', 'name email');
      return res.json({ message: 'Withdrawal approved', wd: serializeWithdrawal(withdrawal) });
    }

    const store = await getStore();
    const wdIndex = store.withdrawals.findIndex(w => w._id === req.params.id || w.id === req.params.id);
    if (wdIndex === -1) return res.status(404).json({ error: 'Withdrawal not found' });
    const wd = store.withdrawals[wdIndex];
    if (wd.status !== 'pending') return res.status(400).json({ error: `Withdrawal already ${wd.status}` });
    const user = store.users.find(u => u._id === wd.userId || u.id === wd.userId);
    if (user) {
      const wasDebitedOnRequest = wd.debited_at_request !== false && wd.debitedAtRequest !== false;
      if (!wasDebitedOnRequest) {
        if ((user.walletBalance || 0) < wd.amount) {
          return res.status(400).json({ error: 'User wallet balance is no longer sufficient for this withdrawal' });
        }
        user.walletBalance = (user.walletBalance || 0) - wd.amount;
      }
      wd.status = 'approved';
      addOfflineUserNotification(user, {
        type: 'wallet',
        message: `Your withdrawal of Rs.${wd.amount} was approved.`,
        link: '/wallet'
      });
    } else {
      wd.status = 'approved';
    }
    await persistStore();
    res.json({ message: 'Withdrawal approved', wd: serializeWithdrawal(wd) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/withdrawals/:id/reject', authenticate, authorizeAdmin, async (req, res) => {
  try {
    if (isDBConnected()) {
      const withdrawal = await Withdrawal.findById(req.params.id);
      if (!withdrawal) return res.status(404).json({ error: 'Withdrawal not found' });
      if (withdrawal.status !== 'pending') return res.status(400).json({ error: `Withdrawal already ${withdrawal.status}` });

      withdrawal.status = 'rejected';
      const user = await User.findById(withdrawal.userId);
      if (user) {
        const wasDebitedOnRequest = withdrawal.debited_at_request !== false && withdrawal.debitedAtRequest !== false;
        if (wasDebitedOnRequest) {
          user.walletBalance = (user.walletBalance || 0) + withdrawal.amount;
        }
        addUserNotification(user, {
          type: 'wallet',
          message: wasDebitedOnRequest
            ? `Your withdrawal of Rs.${withdrawal.amount} was rejected and refunded.`
            : `Your withdrawal of Rs.${withdrawal.amount} was rejected.`,
          link: '/wallet'
        });
      }
      await Promise.all([
        withdrawal.save(),
        user?.save?.()
      ].filter(Boolean));
      await withdrawal.populate('userId', 'name email');
      return res.json({ message: 'Withdrawal rejected and amount refunded', wd: serializeWithdrawal(withdrawal) });
    }

    const store = await getStore();
    const wdIndex = store.withdrawals.findIndex(w => w._id === req.params.id || w.id === req.params.id);
    if (wdIndex === -1) return res.status(404).json({ error: 'Withdrawal not found' });
    const wd = store.withdrawals[wdIndex];
    if (wd.status !== 'pending') return res.status(400).json({ error: `Withdrawal already ${wd.status}` });
    wd.status = 'rejected';
    const user = store.users.find(u => u._id === wd.userId || u.id === wd.userId);
    if (user) {
      const wasDebitedOnRequest = wd.debited_at_request !== false && wd.debitedAtRequest !== false;
      if (wasDebitedOnRequest) {
        user.walletBalance = (user.walletBalance || 0) + wd.amount;
      }
      addOfflineUserNotification(user, {
        type: 'wallet',
        message: wasDebitedOnRequest
          ? `Your withdrawal of Rs.${wd.amount} was rejected and refunded.`
          : `Your withdrawal of Rs.${wd.amount} was rejected.`,
        link: '/wallet'
      });
    }
    await persistStore();
    res.json({ message: 'Withdrawal rejected and amount refunded', wd: serializeWithdrawal(wd) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
