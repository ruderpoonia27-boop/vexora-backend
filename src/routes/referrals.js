import express from 'express';
import User from '../models/User.js';
import { isDBConnected } from '../config/database.js';
import { getStore, persistStore } from '../config/fileStore.js';
import { authenticate } from '../middleware/auth.js';
import {
  createUniqueReferralCode,
  ensureReferralAchievements,
  ensureReferralHistory,
  ensureReferralState,
  ensureReferralStats,
  normalizeReferralCode
} from '../utils/referrals.js';

const router = express.Router();

const buildClientUrl = (req) => (
  process.env.CLIENT_URL
  || req.headers.origin
  || 'http://localhost:3000'
);

const serializeAchievement = (achievement, index) => ({
  id: achievement?._id?.toString?.() || `${achievement?.achieved_at || achievement?.achievedAt || index}_${index}`,
  squadNumber: Number(achievement?.squad_number || achievement?.squadNumber || 0),
  freeEntriesAwarded: Number(achievement?.free_entries_awarded || achievement?.freeEntriesAwarded || 1),
  title: achievement?.title || '',
  subtitle: achievement?.subtitle || '',
  achievedAt: achievement?.achieved_at || achievement?.achievedAt || null
});

const serializeReferralItem = (item, index) => {
  const user = item?.user && typeof item.user === 'object' ? item.user : null;
  const depositComplete = !!item?.deposit_completed;
  return {
    id: item?._id?.toString?.() || item?.userId?.toString?.() || user?._id?.toString?.() || `referral_${index}`,
    username: item?.user_name || user?.name || 'Unknown Player',
    email: item?.user_email || user?.email || '',
    avatarId: item?.avatar_id || item?.avatarId || user?.avatar_id || user?.avatarId || 'vanguard-01',
    signupComplete: item?.signup_completed !== false,
    depositComplete,
    completionStatus: depositComplete ? 'completed' : 'signup_complete',
    joinedAt: item?.joined_at || item?.joinedAt || user?.createdAt || null,
    firstDepositCompletedAt: item?.first_deposit_completed_at || item?.firstDepositCompletedAt || null,
    progressPercent: depositComplete ? 100 : 50,
    progressLabel: depositComplete ? 'Deposit Complete' : 'Signup Complete'
  };
};

router.get('/me', authenticate, async (req, res) => {
  try {
    if (isDBConnected()) {
      const user = await User.findById(req.user._id).populate('referral_history.user', 'name email createdAt');
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      ensureReferralState(user);
      let needsSave = false;
      if (!normalizeReferralCode(user.referral_code)) {
        user.referral_code = await createUniqueReferralCode(user.name, async (candidate) => {
          const existing = await User.exists({ referral_code: candidate, _id: { $ne: user._id } });
          return !!existing;
        });
        needsSave = true;
      }

      const history = ensureReferralHistory(user);
      const stats = ensureReferralStats(user);
      const achievements = ensureReferralAchievements(user);

      if (needsSave) {
        await user.save();
      }

      return res.json({
        referralCode: user.referral_code,
        referralLink: `${buildClientUrl(req)}/ref/${user.referral_code}`,
        stats: {
          freeEntriesEarned: Number(stats.free_entries_earned || 0),
          squadsCompleted: Number(stats.squads_completed || 0),
          completedReferrals: Number(stats.completed_deposits || 0),
          currentProgress: Number(stats.current_progress || 0),
          totalInvited: history.length
        },
        achievements: achievements
          .slice()
          .sort((left, right) => new Date(right.achieved_at || right.achievedAt || 0) - new Date(left.achieved_at || left.achievedAt || 0))
          .map(serializeAchievement),
        referrals: history
          .slice()
          .sort((left, right) => new Date(right.joined_at || right.joinedAt || 0) - new Date(left.joined_at || left.joinedAt || 0))
          .map(serializeReferralItem)
      });
    }

    const store = await getStore();
    const user = store.users.find((item) => item._id === req.user._id || item.id === req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    ensureReferralState(user);
    let needsSave = false;
    if (!normalizeReferralCode(user.referral_code)) {
      user.referral_code = await createUniqueReferralCode(user.name, async (candidate) => (
        store.users.some((item) => item._id !== user._id && normalizeReferralCode(item.referral_code) === candidate)
      ));
      needsSave = true;
    }

    const history = ensureReferralHistory(user);
    const stats = ensureReferralStats(user);
    const achievements = ensureReferralAchievements(user);

    if (needsSave) {
      await persistStore();
    }

    return res.json({
      referralCode: user.referral_code,
      referralLink: `${buildClientUrl(req)}/ref/${user.referral_code}`,
      stats: {
        freeEntriesEarned: Number(stats.free_entries_earned || 0),
        squadsCompleted: Number(stats.squads_completed || 0),
        completedReferrals: Number(stats.completed_deposits || 0),
        currentProgress: Number(stats.current_progress || 0),
        totalInvited: history.length
      },
      achievements: achievements
        .slice()
        .sort((left, right) => new Date(right.achieved_at || right.achievedAt || 0) - new Date(left.achieved_at || left.achievedAt || 0))
        .map(serializeAchievement),
      referrals: history
        .slice()
        .sort((left, right) => new Date(right.joined_at || right.joinedAt || 0) - new Date(left.joined_at || left.joinedAt || 0))
        .map(serializeReferralItem)
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

export default router;
