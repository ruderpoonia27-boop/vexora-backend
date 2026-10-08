import express from 'express';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import User from '../models/User.js';
import Deposit from '../models/Deposit.js';
import Refund from '../models/Refund.js';
import Withdrawal from '../models/Withdrawal.js';
import WalletTransaction from '../models/WalletTransaction.js';
import { isDBConnected } from '../config/database.js';
import { getStore, persistStore } from '../config/fileStore.js';
import { authenticate, optionalAuth, requireSelfOrAdmin } from '../middleware/auth.js';
import { requestDeposit } from './wallet.js';
import { serializeDeposit, serializeRefund, serializeUser, serializeWalletTransaction, serializeWithdrawal } from '../utils/serializers.js';

const router = express.Router();

// What anyone may see about another player.
const serializePublicUser = (user, totalWinnings = 0) => {
  const full = serializeUser(user);
  return {
    _id: full._id,
    id: full.id,
    name: full.name,
    avatar_id: full.avatar_id,
    avatarId: full.avatarId,
    avatar_rarity: full.avatar_rarity,
    avatarRarity: full.avatarRarity,
    totalWinnings
  };
};

router.get('/', optionalAuth, async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const perPage = Math.min(250, Math.max(1, Number(req.query.perPage || req.query.limit) || 50));
    const serialize = req.user?.isAdmin ? serializeUser : (user) => serializePublicUser(user);

    if (isDBConnected()) {
      const [totalItems, users] = await Promise.all([
        User.countDocuments(),
        User.find().select('-password -notifications').sort({ createdAt: -1 }).skip((page - 1) * perPage).limit(perPage)
      ]);
      const items = users.map(serialize);
      return res.json({ items, users: items, page, perPage, totalItems, totalPages: Math.ceil(totalItems / perPage) || 1 });
    }

    const store = await getStore();
    const items = store.users.slice((page - 1) * perPage, page * perPage).map(serialize);
    return res.json({ items, users: items, page, perPage, totalItems: store.users.length, totalPages: Math.ceil(store.users.length / perPage) || 1 });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Top players by prize money won (reward transactions), not by wallet balance.
router.get('/leaderboard', async (req, res) => {
  try {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 100));

    if (isDBConnected()) {
      const totals = await WalletTransaction.aggregate([
        { $match: { type: 'reward' } },
        { $group: { _id: '$userId', totalWinnings: { $sum: '$amount' } } },
        { $sort: { totalWinnings: -1 } },
        { $limit: limit }
      ]);
      const users = await User.find({ _id: { $in: totals.map((item) => item._id) }, isBlocked: { $ne: true } })
        .select('name avatar_id avatar_rarity');
      const byId = new Map(users.map((user) => [user._id.toString(), user]));
      const items = totals
        .filter((item) => byId.has(String(item._id)))
        .map((item) => serializePublicUser(byId.get(String(item._id)), item.totalWinnings));
      return res.json({ items });
    }

    const store = await getStore();
    const totals = new Map();
    for (const transaction of store.walletTransactions || []) {
      if ((transaction.type || 'reward') !== 'reward') continue;
      const userId = String(transaction.userId);
      totals.set(userId, (totals.get(userId) || 0) + Number(transaction.amount || 0));
    }
    const items = [...totals.entries()]
      .map(([userId, totalWinnings]) => ({ user: store.users.find((item) => item._id === userId && !item.isBlocked), totalWinnings }))
      .filter((item) => item.user)
      .sort((left, right) => right.totalWinnings - left.totalWinnings)
      .slice(0, limit)
      .map((item) => serializePublicUser(item.user, item.totalWinnings));
    return res.json({ items });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/profile/:id', optionalAuth, async (req, res) => {
  try {
    const canSeeAll = req.user?.isAdmin || String(req.user?._id) === req.params.id;
    const serialize = canSeeAll ? serializeUser : (user) => serializePublicUser(user);

    if (isDBConnected()) {
      if (!mongoose.isValidObjectId(req.params.id)) {
        return res.status(404).json({ error: 'User not found' });
      }
      const user = await User.findById(req.params.id).select('-password -notifications');
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      return res.json(serialize(user));
    }

    const store = await getStore();
    const user = store.users.find(u => u._id === req.params.id || u.id === req.params.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    return res.json(serialize(user));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const updateUser = async (req, res) => {
  try {
    const { name, oldPassword, password, passwordConfirm } = req.body;
    const trimmedName = typeof name === 'string' ? name.trim() : '';
    const avatarId = req.body.avatarId || req.body.avatar_id;

    if (password && password !== passwordConfirm) {
      return res.status(400).json({ error: 'New passwords do not match' });
    }

    if (isDBConnected()) {
      const user = await User.findById(req.params.id);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      if (trimmedName) user.name = trimmedName;
      if (avatarId) user.avatar_id = String(avatarId).trim();
      if (trimmedName && user.avatar_id) user.profile_setup_completed = true;
      if (password) {
        if (!oldPassword) {
          return res.status(400).json({ error: 'Current password is required' });
        }
        const isMatch = await bcrypt.compare(oldPassword, user.password);
        if (!isMatch) {
          return res.status(400).json({ error: 'Current password is incorrect' });
        }
        user.password = await bcrypt.hash(password, 10);
      }
      await user.save();
      return res.json(serializeUser(user));
    }

    const store = await getStore();
    const userIndex = store.users.findIndex(u => u._id === req.params.id || u.id === req.params.id);
    if (userIndex === -1) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (trimmedName) store.users[userIndex].name = trimmedName;
    if (avatarId) store.users[userIndex].avatar_id = String(avatarId).trim();
    if (trimmedName && store.users[userIndex].avatar_id) {
      store.users[userIndex].profile_setup_completed = true;
    }
    if (password) {
      const isMatch = await bcrypt.compare(oldPassword || '', store.users[userIndex].password);
      if (!isMatch) {
        return res.status(400).json({ error: 'Current password is incorrect' });
      }
      store.users[userIndex].password = await bcrypt.hash(password, 10);
    }
    await persistStore();
    return res.json(serializeUser(store.users[userIndex]));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

router.put('/profile/:id', authenticate, requireSelfOrAdmin('id'), updateUser);
router.put('/:id', authenticate, requireSelfOrAdmin('id'), updateUser);

router.post('/wallet-request', authenticate, requestDeposit);

router.get('/deposits/:userId', authenticate, requireSelfOrAdmin(), async (req, res) => {
  try {
    if (isDBConnected()) {
      const [deposits, refunds, walletTransactions] = await Promise.all([
        Deposit.find({ userId: req.params.userId }).sort({ createdAt: -1 }),
        Refund.find({ userId: req.params.userId }).sort({ createdAt: -1 }),
        WalletTransaction.find({ userId: req.params.userId }).sort({ createdAt: -1 })
      ]);
      const items = [
        ...deposits.map((deposit) => ({ ...serializeDeposit(deposit), type: 'deposit' })),
        ...refunds.map(serializeRefund),
        ...walletTransactions.map(serializeWalletTransaction)
      ].sort((left, right) => new Date(right.createdAt || right.created || 0) - new Date(left.createdAt || left.created || 0));
      return res.json(items);
    }

    const store = await getStore();
    const userDeposits = (store.deposits || [])
      .filter(d => d.userId === req.params.userId)
      .map((deposit) => ({ ...serializeDeposit(deposit), type: 'deposit' }));
    const userRefunds = (store.refunds || [])
      .filter(refund => refund.userId === req.params.userId)
      .map(serializeRefund);
    const userTransactions = (store.walletTransactions || [])
      .filter(transaction => transaction.userId === req.params.userId)
      .map(serializeWalletTransaction);
    const items = [...userDeposits, ...userRefunds, ...userTransactions]
      .sort((left, right) => new Date(right.createdAt || right.created || 0) - new Date(left.createdAt || left.created || 0));
    return res.json(items);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/withdrawals/history/:userId', authenticate, requireSelfOrAdmin(), async (req, res) => {
  try {
    if (isDBConnected()) {
      const withdrawals = await Withdrawal.find({ userId: req.params.userId }).sort({ createdAt: -1 });
      return res.json(withdrawals.map(serializeWithdrawal));
    }

    const store = await getStore();
    const withdrawals = store.withdrawals.filter(w => w.userId === req.params.userId).map(serializeWithdrawal);
    return res.json(withdrawals);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
