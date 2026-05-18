const asId = (value) => value?._id?.toString?.() || value?.toString?.() || value;

const serializePlayer = (player) => {
  if (!player) return null;
  if (typeof player === 'string') return { _id: player, id: player, avatar_id: 'vanguard-01', avatarId: 'vanguard-01', avatar_rarity: 'Legendary', avatarRarity: 'Legendary' };
  const id = asId(player);
  return {
    _id: id,
    id,
    name: player.name,
    email: player.email,
    avatar_id: player.avatar_id || player.avatarId || 'vanguard-01',
    avatarId: player.avatar_id || player.avatarId || 'vanguard-01',
    avatar_rarity: player.avatar_rarity || player.avatarRarity || 'Legendary',
    avatarRarity: player.avatar_rarity || player.avatarRarity || 'Legendary'
  };
};

const serializeWinner = (winner) => {
  if (!winner) return null;
  if (typeof winner === 'string') return { _id: winner, id: winner, avatar_id: 'vanguard-01', avatarId: 'vanguard-01', avatar_rarity: 'Legendary', avatarRarity: 'Legendary' };
  const id = asId(winner);
  return {
    _id: id,
    id,
    name: winner.name,
    email: winner.email,
    avatar_id: winner.avatar_id || winner.avatarId || 'vanguard-01',
    avatarId: winner.avatar_id || winner.avatarId || 'vanguard-01',
    avatar_rarity: winner.avatar_rarity || winner.avatarRarity || 'Legendary',
    avatarRarity: winner.avatar_rarity || winner.avatarRarity || 'Legendary'
  };
};

const serializeSquad = (squad) => {
  if (!squad) return null;
  const squadId = asId(squad._id) || squad.id;
  const members = (squad.members || []).map(serializePlayer).filter(Boolean);
  const captainId = asId(squad.captain);
  return {
    _id: squadId,
    id: squadId,
    name: squad.name,
    captain: serializePlayer(squad.captain),
    captainId,
    members,
    memberCount: members.length,
    createdAt: squad.createdAt || null
  };
};

const serializeWinningSquad = (squads = [], winnerSquadId = '') => (
  squads.find((squad) => (squad._id || squad.id) === winnerSquadId) || null
);

const serializeParticipantProfile = (profile) => {
  if (!profile) return null;
  const user = profile.user && typeof profile.user === 'object' ? serializePlayer(profile.user) : serializePlayer(profile.user || profile.userId);
  return {
    _id: asId(profile._id) || `${asId(profile.user)}_${profile.game_uid || profile.gameUid || 'profile'}`,
    user,
    userId: asId(profile.user || profile.userId),
    in_game_name: profile.in_game_name || profile.inGameName || '',
    inGameName: profile.in_game_name || profile.inGameName || '',
    game_uid: profile.game_uid || profile.gameUid || '',
    gameUid: profile.game_uid || profile.gameUid || '',
    game_name: profile.game_name || profile.gameName || '',
    gameName: profile.game_name || profile.gameName || '',
    join_method: profile.join_method || profile.joinMethod || 'wallet',
    joinMethod: profile.join_method || profile.joinMethod || 'wallet',
    squad_id: profile.squad_id || profile.squadId || '',
    squadId: profile.squad_id || profile.squadId || '',
    joined_at: profile.joined_at || profile.joinedAt || null,
    joinedAt: profile.joined_at || profile.joinedAt || null
  };
};

export const serializeUser = (user) => {
  const source = user?.toObject ? user.toObject() : user;
  if (!source) return null;
  const id = asId(source);
  const referralStats = source.referral_stats || source.referralStats || {};
  const freeEntriesEarned = Number(referralStats.free_entries_earned || referralStats.freeEntriesEarned || 0);
  const freeEntriesUsed = Number(referralStats.free_entries_used || referralStats.freeEntriesUsed || 0);
  const freeEntriesAvailable = Math.max(0, freeEntriesEarned - freeEntriesUsed);
  return {
    _id: id,
    id,
    email: source.email,
    name: source.name,
    avatar_id: source.avatar_id || source.avatarId || 'vanguard-01',
    avatarId: source.avatar_id || source.avatarId || 'vanguard-01',
    avatar_rarity: source.avatar_rarity || source.avatarRarity || 'Legendary',
    avatarRarity: source.avatar_rarity || source.avatarRarity || 'Legendary',
    walletBalance: source.walletBalance || 0,
    wallet_balance: source.walletBalance || 0,
    isAdmin: !!source.isAdmin,
    isBlocked: !!source.isBlocked,
    blockedAt: source.blockedAt,
    blockedReason: source.blockedReason || '',
    referral_code: source.referral_code || '',
    referralCode: source.referral_code || '',
    referred_by: asId(source.referred_by) || source.referred_by_code || '',
    referredBy: asId(source.referred_by) || source.referred_by_code || '',
    referral_stats: {
      completed_deposits: Number(referralStats.completed_deposits || referralStats.completedDeposits || 0),
      squads_completed: Number(referralStats.squads_completed || referralStats.squadsCompleted || 0),
      free_entries_earned: freeEntriesEarned,
      free_entries_used: freeEntriesUsed,
      free_entries_available: freeEntriesAvailable,
      current_progress: Number(referralStats.current_progress || referralStats.currentProgress || 0)
    },
    freeEntriesAvailable,
    createdAt: source.createdAt,
    created: source.createdAt
  };
};

export const serializeTournament = (tournament) => {
  const source = tournament?.toObject ? tournament.toObject() : tournament;
  if (!source) return null;

  const id = asId(source);
  const players = (source.currentPlayers || []).map(serializePlayer).filter(Boolean);
  const joinedCount = players.length || source.joined_count || source.joinedCount || 0;
  const gameName = source.name || source.game_type || source.gameType || 'BGMI';
  const entryFee = Number(source.entry_fee ?? source.entryFee ?? 0);
  const basePrize = Number(source.base_prize ?? source.basePrize ?? source.prizePool ?? 0);
  const firstPrizePercentage = Number(source.first_prize_percentage ?? source.firstPrizePercentage ?? 50);
  const totalSlots = Number(source.total_slots ?? source.totalSlots ?? 1);
  const startTime = source.match_start_time || source.startTime || null;
  const roomId = source.room_id || source.roomId || '';
  const roomPassword = source.room_password || source.roomPassword || '';
  const winner = serializeWinner(source.winner);
  const secondWinner = serializeWinner(source.second_winner || source.secondWinner);
  const thirdWinner = serializeWinner(source.third_winner || source.thirdWinner);
  const matchType = source.match_type || source.matchType || 'solo';
  const squadSize = Number(source.squad_size ?? source.squadSize ?? (matchType === 'squad' ? 4 : 1));
  const squads = (source.squads || []).map(serializeSquad).filter(Boolean);
  const winnerSquadId = source.winner_squad || source.winnerSquad || '';
  const winnerSquad = serializeWinningSquad(squads, winnerSquadId);
  const participantProfiles = (source.participant_profiles || source.participantProfiles || []).map(serializeParticipantProfile).filter(Boolean);

  return {
    ...source,
    _id: id,
    id,
    name: gameName,
    game_type: gameName,
    gameType: gameName,
    title: source.title || `${gameName} Showdown`,
    match_type: matchType,
    matchType,
    squad_size: matchType === 'solo' ? 1 : squadSize,
    squadSize: matchType === 'solo' ? 1 : squadSize,
    entry_fee: entryFee,
    entryFee,
    base_prize: basePrize,
    basePrize,
    prizePool: basePrize,
    first_prize_percentage: firstPrizePercentage,
    firstPrizePercentage,
    solo_first_place_percentage: Number(source.solo_first_place_percentage ?? source.soloFirstPlacePercentage ?? 60),
    soloFirstPlacePercentage: Number(source.solo_first_place_percentage ?? source.soloFirstPlacePercentage ?? 60),
    solo_second_place_percentage: Number(source.solo_second_place_percentage ?? source.soloSecondPlacePercentage ?? 30),
    soloSecondPlacePercentage: Number(source.solo_second_place_percentage ?? source.soloSecondPlacePercentage ?? 30),
    solo_third_place_percentage: Number(source.solo_third_place_percentage ?? source.soloThirdPlacePercentage ?? 10),
    soloThirdPlacePercentage: Number(source.solo_third_place_percentage ?? source.soloThirdPlacePercentage ?? 10),
    total_slots: totalSlots,
    totalSlots,
    currentPlayers: players,
    participant_profiles: participantProfiles,
    participantProfiles,
    squads,
    joined_count: joinedCount,
    joinedCount,
    match_start_time: startTime,
    startTime,
    room_id: roomId,
    roomId,
    room_password: roomPassword,
    roomPassword,
    room_details_set_at: source.room_details_set_at || null,
    finished_at: source.finished_at || null,
    dismissed_at: source.dismissed_at || null,
    refunded_at: source.refunded_at || null,
    refund_processed: !!(source.refund_processed ?? source.refundProcessed),
    refundProcessed: !!(source.refund_processed ?? source.refundProcessed),
    winner,
    second_winner: secondWinner,
    secondWinner,
    third_winner: thirdWinner,
    thirdWinner,
    winner_squad: winnerSquadId,
    winnerSquadId,
    winner_squad_name: source.winner_squad_name || source.winnerSquadName || winnerSquad?.name || '',
    winnerSquadName: source.winner_squad_name || source.winnerSquadName || winnerSquad?.name || '',
    winnerSquad,
    winner_prize: Number(source.winner_prize || 0),
    winnerPrize: Number(source.winner_prize || 0),
    total_collection: Number(source.total_collection || source.totalCollection || 0),
    totalCollection: Number(source.total_collection || source.totalCollection || 0),
    reward_pool: Number(source.reward_pool || source.rewardPool || 0),
    rewardPool: Number(source.reward_pool || source.rewardPool || 0),
    platform_earnings: Number(source.platform_earnings || source.platformEarnings || 0),
    platformEarnings: Number(source.platform_earnings || source.platformEarnings || 0),
    reward_per_member: Number(source.reward_per_member || source.rewardPerMember || 0),
    rewardPerMember: Number(source.reward_per_member || source.rewardPerMember || 0),
    first_place_prize: Number(source.first_place_prize || source.firstPlacePrize || source.winner_prize || 0),
    firstPlacePrize: Number(source.first_place_prize || source.firstPlacePrize || source.winner_prize || 0),
    second_place_prize: Number(source.second_place_prize || source.secondPlacePrize || 0),
    secondPlacePrize: Number(source.second_place_prize || source.secondPlacePrize || 0),
    third_place_prize: Number(source.third_place_prize || source.thirdPlacePrize || 0),
    thirdPlacePrize: Number(source.third_place_prize || source.thirdPlacePrize || 0),
    winner_declared_at: source.winner_declared_at || null,
    created: source.createdAt,
    updated: source.updatedAt
  };
};

export const serializeWalletTransaction = (transaction) => {
  const source = transaction?.toObject ? transaction.toObject() : transaction;
  if (!source) return null;
  const id = asId(source);
  return {
    ...source,
    _id: id,
    id,
    type: source.type || 'reward',
    userId: asId(source.userId),
    tournamentId: asId(source.tournamentId),
    description: source.description || 'Wallet transaction',
    status: source.status || 'approved',
    created: source.createdAt
  };
};

export const serializeDeposit = (deposit) => {
  const source = deposit?.toObject ? deposit.toObject() : deposit;
  if (!source) return null;
  const id = asId(source);
  const user = source.userId && typeof source.userId === 'object' ? serializeUser(source.userId) : null;
  return {
    ...source,
    _id: id,
    id,
    userId: asId(source.userId),
    expand: {
      userId: user ? { name: user.name, email: user.email } : null
    },
    created: source.createdAt
  };
};

export const serializeWithdrawal = (withdrawal) => {
  const source = withdrawal?.toObject ? withdrawal.toObject() : withdrawal;
  if (!source) return null;
  const id = asId(source);
  const user = source.userId && typeof source.userId === 'object' ? serializeUser(source.userId) : null;
  return {
    ...source,
    _id: id,
    id,
    userId: asId(source.userId),
    expand: {
      userId: user ? { name: user.name, email: user.email } : null
    },
    created: source.createdAt
  };
};

export const serializeRefund = (refund) => {
  const source = refund?.toObject ? refund.toObject() : refund;
  if (!source) return null;
  const id = asId(source);
  const user = source.userId && typeof source.userId === 'object' ? serializeUser(source.userId) : null;
  return {
    ...source,
    _id: id,
    id,
    type: 'refund',
    userId: asId(source.userId),
    tournamentId: asId(source.tournamentId),
    expand: {
      userId: user ? { name: user.name, email: user.email } : null
    },
    created: source.createdAt
  };
};
