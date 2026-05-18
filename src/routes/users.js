import express from 'express';
import bcrypt from 'bcryptjs';
import User from '../models/User.js';
import Deposit from '../models/Deposit.js';
import Refund from '../models/Refund.js';
import Withdrawal from '../models/Withdrawal.js';
import Settings from '../models/Settings.js';
import WalletTransaction from '../models/WalletTransaction.js';
import { isDBConnected } from '../config/database.js';
import { getStore, persistStore } from '../config/fileStore.js';
import { serializeDeposit, serializeRefund, serializeUser, serializeWalletTransaction, serializeWithdrawal } from '../utils/serializers.js';

const router = express.Router();

const getMinimums = async () => {
  if (isDBConnected()) {
    const settings = await Settings.findOne();
    return {
      minDeposit: settings?.min_deposit_amount || 10,
      minWithdraw: settings?.min_withdraw_amount || 50
    };
  }

  const store = await getStore();
  return {
    minDeposit: store.settings?.min_deposit_amount || 10,
    minWithdraw: store.settings?.min_withdraw_amount || 50
  };
};

router.get('/', async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const perPage = Math.max(1, Number(req.query.perPage || req.query.limit) || 50);

    if (isDBConnected()) {
      const [totalItems, users] = await Promise.all([
        User.countDocuments(),
        User.find().select('-password').sort({ createdAt: -1 }).skip((page - 1) * perPage).limit(perPage)
      ]);
      const items = users.map(serializeUser);
      return res.json({ items, users: items, page, perPage, totalItems, totalPages: Math.ceil(totalItems / perPage) || 1 });
    }

    const store = await getStore();
    const items = store.users.map(serializeUser);
    return res.json({ items, users: items, page: 1, perPage: items.length, totalItems: items.length, totalPages: 1 });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/profile/:id', async (req, res) => {
  try {
    if (isDBConnected()) {
      const user = await User.findById(req.params.id).select('-password');
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      return res.json(serializeUser(user));
    }

    const store = await getStore();
    const user = store.users.find(u => u._id === req.params.id || u.id === req.params.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    return res.json(serializeUser(user));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const updateUser = async (req, res) => {
  try {
    const { name, oldPassword, password, passwordConfirm } = req.body;
    const avatarId = req.body.avatarId || req.body.avatar_id;

    if (password && password !== passwordConfirm) {
      return res.status(400).json({ error: 'New passwords do not match' });
    }

    if (isDBConnected()) {
      const user = await User.findById(req.params.id);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      if (name) user.name = name;
      if (avatarId) user.avatar_id = String(avatarId).trim();
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

    if (name) store.users[userIndex].name = name;
    if (avatarId) store.users[userIndex].avatar_id = String(avatarId).trim();
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

router.put('/profile/:id', updateUser);
router.put('/:id', updateUser);

router.post('/wallet-add', async (req, res) => {
  try {
    const { userId } = req.body;
    const amount = Number(req.body.amount);
    if (!userId || Number.isNaN(amount)) {
      return res.status(400).json({ error: 'User and amount are required' });
    }

    if (isDBConnected()) {
      const user = await User.findByIdAndUpdate(userId, { $inc: { walletBalance: amount } }, { new: true }).select('-password');
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      return res.json(serializeUser(user));
    }

    const store = await getStore();
    const user = store.users.find(u => u._id === userId || u.id === userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    user.walletBalance = (user.walletBalance || 0) + amount;
    await persistStore();
    return res.json(serializeUser(user));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/wallet-request', async (req, res) => {
  try {
    const userId = req.body.userId || req.body._id || req.body.id;
    const amount = Number(req.body.amount);
    const { transactionId, method, paymentScreenshot } = req.body;
    if (!userId || !amount || !transactionId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    const { minDeposit } = await getMinimums();
    if (amount < minDeposit) {
      return res.status(400).json({ error: `Minimum deposit amount is ${minDeposit}` });
    }

    if (isDBConnected()) {
      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      const deposit = await Deposit.create({
        userId,
        amount,
        transaction_id: transactionId,
        payment_method: method || 'UPI',
        payment_screenshot: paymentScreenshot || '',
        status: 'pending'
      });
      await deposit.populate('userId', 'name email');
      return res.status(201).json({
        message: 'Deposit request submitted successfully',
        deposit: serializeDeposit(deposit)
      });
    }

    const store = await getStore();
    const deposit = {
      _id: `offline_dep_${store.nextIds.deposit++}`,
      userId,
      amount,
      transaction_id: transactionId,
      payment_method: method || 'UPI',
      payment_screenshot: paymentScreenshot || '',
      status: 'pending',
      createdAt: new Date().toISOString()
    };
    store.deposits.push(deposit);
    await persistStore();
    res.status(201).json({ message: 'Deposit request submitted successfully', deposit: serializeDeposit(deposit) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/deposits/:userId', async (req, res) => {
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

router.get('/withdrawals/history/:userId', async (req, res) => {
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
