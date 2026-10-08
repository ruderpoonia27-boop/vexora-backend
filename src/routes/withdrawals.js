import express from 'express';
import { getStore } from '../config/fileStore.js';
import { isDBConnected } from '../config/database.js';
import Withdrawal from '../models/Withdrawal.js';
import { authenticate, authorizeAdmin, requireSelfOrAdmin } from '../middleware/auth.js';
import { requestWithdrawal } from './wallet.js';
import { serializeWithdrawal } from '../utils/serializers.js';

const router = express.Router();

router.get('/', authenticate, authorizeAdmin, async (req, res) => {
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

router.post('/', authenticate, requestWithdrawal);

router.get('/history/:userId', authenticate, requireSelfOrAdmin(), async (req, res) => {
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
