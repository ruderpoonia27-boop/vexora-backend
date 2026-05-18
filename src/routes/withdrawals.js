import express from 'express';
import { getStore, persistStore } from '../config/fileStore.js';
import { isDBConnected } from '../config/database.js';
import User from '../models/User.js';
import Withdrawal from '../models/Withdrawal.js';
import Settings from '../models/Settings.js';
import { serializeWithdrawal } from '../utils/serializers.js';

const router = express.Router();

const getMinimumWithdrawAmount = async () => {
  if (isDBConnected()) {
    const settings = await Settings.findOne();
    return settings?.min_withdraw_amount || 50;
  }

  const store = await getStore();
  return store.settings?.min_withdraw_amount || 50;
};

const wasWithdrawalDebitedOnRequest = (withdrawal) => (
  withdrawal?.debited_at_request !== false && withdrawal?.debitedAtRequest !== false
);

router.get('/', async (req, res) => {
  try {
    const filter = {};
    if (req.query.status) {
      filter.status = { $in: req.query.status.split(',') };
    }

    if (isDBConnected()) {
      const withdrawals = await Withdrawal.find(filter).sort({ createdAt: -1 }).populate('userId', 'name email');
      const items = withdrawals.map(serializeWithdrawal);
      return res.json({ items, withdrawals: items, totalItems: items.length, page: 1, perPage: items.length, totalPages: 1 });
    }

    const store = await getStore();
    let items = store.withdrawals.map(serializeWithdrawal);
    if (filter.status?.$in) {
      items = items.filter(w => filter.status.$in.includes(w.status));
    }
    return res.json({ items, withdrawals: items, totalItems: items.length, page: 1, perPage: items.length, totalPages: 1 });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const userId = req.body.userId || req.body._id || req.body.id;
    const { upiId } = req.body;
    const numAmount = Number(req.body.amount);
    if (!userId || !numAmount || !upiId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    if (Number.isNaN(numAmount) || numAmount <= 0) {
      return res.status(400).json({ error: 'Invalid amount' });
    }
    const minWithdrawAmount = await getMinimumWithdrawAmount();
    if (numAmount < minWithdrawAmount) {
      return res.status(400).json({ error: `Minimum withdrawal amount is ${minWithdrawAmount}` });
    }

    if (isDBConnected()) {
      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      const pendingWithdrawals = await Withdrawal.find({ userId, status: 'pending' });
      const pendingReservedAmount = pendingWithdrawals
        .filter((withdrawal) => !wasWithdrawalDebitedOnRequest(withdrawal))
        .reduce((total, withdrawal) => total + Number(withdrawal.amount || 0), 0);
      if (((user.walletBalance || 0) - pendingReservedAmount) < numAmount) {
        return res.status(400).json({ error: 'Insufficient balance' });
      }

      const withdrawal = await Withdrawal.create({
        userId,
        amount: numAmount,
        upi_id: upiId,
        debited_at_request: false,
        status: 'pending'
      });
      return res.status(201).json({ message: 'Withdrawal request submitted', withdrawal: serializeWithdrawal(withdrawal) });
    }

    const store = await getStore();
    const user = store.users.find(u => u._id === userId || u.id === userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    const pendingReservedAmount = (store.withdrawals || [])
      .filter((withdrawal) => (withdrawal.userId === userId) && withdrawal.status === 'pending' && !wasWithdrawalDebitedOnRequest(withdrawal))
      .reduce((total, withdrawal) => total + Number(withdrawal.amount || 0), 0);
    if (((user.walletBalance || 0) - pendingReservedAmount) < numAmount) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }
    const withdrawal = {
      _id: `offline_wd_${store.nextIds.withdrawal++}`,
      userId,
      amount: numAmount,
      upi_id: upiId,
      debited_at_request: false,
      status: 'pending',
      createdAt: new Date().toISOString()
    };
    store.withdrawals.push(withdrawal);
    await persistStore();
    return res.status(201).json({ message: 'Withdrawal request submitted', withdrawal: serializeWithdrawal(withdrawal) });
  } catch (error) {
    console.error('Withdrawal error:', error);
    res.status(500).json({ error: error.message || 'Withdrawal failed' });
  }
});

router.get('/history/:userId', async (req, res) => {
  try {
    if (isDBConnected()) {
      const withdrawals = await Withdrawal.find({ userId: req.params.userId }).sort({ createdAt: -1 });
      return res.json(withdrawals.map(serializeWithdrawal));
    }

    const store = await getStore();
    const { userId } = req.params;
    const withdrawals = store.withdrawals.filter(w => w.userId === userId).map(serializeWithdrawal);
    return res.json(withdrawals);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
