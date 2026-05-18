const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const buildRandomSuffix = (length = 4) => Array.from({ length }, () => (
  CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]
)).join('');

const sanitizeName = (value) => (
  String(value || 'PLAYER')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
);

const toDateValue = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const getOrdinal = (value) => {
  const mod100 = value % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${value}th`;
  const mod10 = value % 10;
  if (mod10 === 1) return `${value}st`;
  if (mod10 === 2) return `${value}nd`;
  if (mod10 === 3) return `${value}rd`;
  return `${value}th`;
};

export const normalizeReferralCode = (value) => String(value || '').trim().toUpperCase();

export const ensureReferralStats = (user) => {
  user.referral_stats = user.referral_stats || user.referralStats || {};
  user.referral_stats.completed_deposits = Number(user.referral_stats.completed_deposits || user.referral_stats.completedDeposits || 0);
  user.referral_stats.squads_completed = Number(user.referral_stats.squads_completed || user.referral_stats.squadsCompleted || 0);
  user.referral_stats.free_entries_earned = Number(user.referral_stats.free_entries_earned || user.referral_stats.freeEntriesEarned || 0);
  user.referral_stats.free_entries_used = Number(user.referral_stats.free_entries_used || user.referral_stats.freeEntriesUsed || 0);
  user.referral_stats.current_progress = Number(user.referral_stats.current_progress || user.referral_stats.currentProgress || 0);
  user.referralStats = user.referral_stats;
  return user.referral_stats;
};

export const ensureReferralHistory = (user) => {
  user.referral_history = Array.isArray(user.referral_history)
    ? user.referral_history
    : Array.isArray(user.referralHistory)
      ? user.referralHistory
      : [];
  user.referralHistory = user.referral_history;
  return user.referral_history;
};

export const ensureReferralAchievements = (user) => {
  user.referral_achievements = Array.isArray(user.referral_achievements)
    ? user.referral_achievements
    : Array.isArray(user.referralAchievements)
      ? user.referralAchievements
      : [];
  user.referralAchievements = user.referral_achievements;
  return user.referral_achievements;
};

export const ensureReferralState = (user) => {
  if (!user) return null;
  ensureReferralStats(user);
  ensureReferralHistory(user);
  ensureReferralAchievements(user);
  return user;
};

export const createUniqueReferralCode = async (name, existsFn) => {
  const prefix = sanitizeName(name).slice(0, 6) || 'PLAYER';
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const suffixLength = attempt < 10 ? 4 : attempt < 40 ? 5 : 6;
    const candidate = normalizeReferralCode(`${prefix}${buildRandomSuffix(suffixLength)}`);
    // eslint-disable-next-line no-await-in-loop
    const exists = await existsFn(candidate);
    if (!exists) {
      return candidate;
    }
  }

  let fallbackAttempt = 0;
  while (true) {
    const candidate = normalizeReferralCode(`PLAYER${Date.now().toString(36).toUpperCase()}${buildRandomSuffix(6)}${fallbackAttempt || ''}`);
    // eslint-disable-next-line no-await-in-loop
    const exists = await existsFn(candidate);
    if (!exists) {
      return candidate;
    }
    fallbackAttempt += 1;
  }
};

export const ensureUniqueReferralCodesForUsers = async (users, persistUser) => {
  const list = Array.isArray(users) ? users : [];
  const usedCodes = new Set();
  let changedCount = 0;

  for (const user of list) {
    const currentCode = normalizeReferralCode(user?.referral_code || user?.referralCode || '');
    const needsNewCode = !currentCode || usedCodes.has(currentCode);

    if (needsNewCode) {
      // eslint-disable-next-line no-await-in-loop
      const nextCode = await createUniqueReferralCode(user?.name, async (candidate) => usedCodes.has(candidate));
      user.referral_code = nextCode;
      user.referralCode = nextCode;
      usedCodes.add(nextCode);
      changedCount += 1;
      if (persistUser) {
        // eslint-disable-next-line no-await-in-loop
        await persistUser(user);
      }
      continue;
    }

    user.referral_code = currentCode;
    user.referralCode = currentCode;
    usedCodes.add(currentCode);
  }

  return changedCount;
};

export const addReferralSignup = (referrer, referredUser) => {
  ensureReferralState(referrer);
  const history = ensureReferralHistory(referrer);
  const referredUserId = referredUser?._id?.toString?.() || referredUser?.id?.toString?.() || referredUser?.toString?.();
  const existing = history.find((item) => {
    const itemUserId = item?.user?._id?.toString?.() || item?.user?.toString?.() || item?.userId?.toString?.();
    return itemUserId === referredUserId;
  });

  const joinedAt = referredUser?.createdAt || referredUser?.created || new Date();
  const nextEntry = {
    ...(existing || {}),
    user: existing?.user || referredUser?._id || referredUserId,
    userId: existing?.userId || referredUserId,
    user_name: referredUser?.name || existing?.user_name || 'Unknown Player',
    user_email: referredUser?.email || existing?.user_email || '',
    avatar_id: referredUser?.avatar_id || referredUser?.avatarId || existing?.avatar_id || 'vanguard-01',
    signup_completed: true,
    joined_at: existing?.joined_at || joinedAt
  };

  if (existing) {
    Object.assign(existing, nextEntry);
    return existing;
  }

  history.push(nextEntry);
  return nextEntry;
};

export const completeReferralFirstDeposit = (referrer, referredUser, completedAt = new Date()) => {
  ensureReferralState(referrer);
  const stats = ensureReferralStats(referrer);
  const history = ensureReferralHistory(referrer);
  const achievements = ensureReferralAchievements(referrer);
  const referredUserId = referredUser?._id?.toString?.() || referredUser?.id?.toString?.() || referredUser?.toString?.();

  let item = history.find((entry) => {
    const entryUserId = entry?.user?._id?.toString?.() || entry?.user?.toString?.() || entry?.userId?.toString?.();
    return entryUserId === referredUserId;
  });

  if (!item) {
    item = addReferralSignup(referrer, referredUser);
  }

  if (item.deposit_completed) {
    return null;
  }

  item.deposit_completed = true;
  item.first_deposit_completed_at = toDateValue(completedAt) || new Date();
  item.user_name = referredUser?.name || item.user_name || 'Unknown Player';
  item.user_email = referredUser?.email || item.user_email || '';
  item.avatar_id = referredUser?.avatar_id || referredUser?.avatarId || item.avatar_id || 'vanguard-01';

  stats.completed_deposits += 1;
  stats.current_progress = stats.completed_deposits % 3;
  referrer.referralStats = stats;

  let achievement = null;
  if (stats.completed_deposits % 3 === 0) {
    stats.squads_completed += 1;
    stats.free_entries_earned += 1;
    stats.current_progress = 0;
    achievement = {
      squad_number: stats.squads_completed,
      free_entries_awarded: 1,
      title: `${getOrdinal(stats.squads_completed)} Squad Complete!`,
      subtitle: stats.squads_completed === 1 ? 'Free Entry Unlocked!' : 'Another Free Entry Earned!',
      achieved_at: toDateValue(completedAt) || new Date()
    };
    achievements.push(achievement);
  }

  return achievement;
};
