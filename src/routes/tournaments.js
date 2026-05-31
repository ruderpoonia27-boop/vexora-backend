import express from 'express';
import Tournament from '../models/Tournament.js';
import User from '../models/User.js';
import Refund from '../models/Refund.js';
import WalletTransaction from '../models/WalletTransaction.js';
import { isDBConnected } from '../config/database.js';
import { getStore, persistStore } from '../config/fileStore.js';
import { serializeTournament, serializeUser } from '../utils/serializers.js';
import { ensureReferralStats } from '../utils/referrals.js';
import { calculatePrizeBreakdown, isSquadTournament } from '../utils/prizes.js';

const router = express.Router();

const validStatuses = ['pending', 'active', 'completed', 'cancelled', 'dismissed'];
const tournamentPopulate = [
  { path: 'currentPlayers', select: 'name email walletBalance game_profiles gameProfiles avatar_id avatar_rarity' },
  { path: 'participant_profiles.user', select: 'name email walletBalance game_profiles gameProfiles avatar_id avatar_rarity' },
  { path: 'winner', select: 'name email avatar_id avatar_rarity' },
  { path: 'second_winner', select: 'name email avatar_id avatar_rarity' },
  { path: 'third_winner', select: 'name email avatar_id avatar_rarity' },
  { path: 'squads.captain', select: 'name email avatar_id avatar_rarity' },
  { path: 'squads.members', select: 'name email avatar_id avatar_rarity' }
];

const normalizeStatus = (status) => {
  if (!status) return 'active';
  if (status === 'upcoming' || status === 'ongoing') return 'active';
  return validStatuses.includes(status) ? status : 'active';
};

const normalizeTournamentPayload = (body, existingTournament = null) => {
  const current = existingTournament?.toObject ? existingTournament.toObject() : existingTournament;
  const gameName = body.name || body.game_type || body.gameType || body.title || current?.name || current?.game_type || current?.gameType || current?.title || 'BGMI';
  const entryFee = Number(body.entry_fee ?? body.entryFee ?? current?.entry_fee ?? current?.entryFee ?? 0);
  const basePrize = Number(body.base_prize ?? body.basePrize ?? body.prizePool ?? current?.base_prize ?? current?.basePrize ?? current?.prizePool ?? 0);
  const firstPrizePercentage = Number(body.first_prize_percentage ?? body.firstPrizePercentage ?? body.prize_percentage ?? body.prizePercentage ?? current?.first_prize_percentage ?? current?.firstPrizePercentage ?? 50);
  const soloFirstPlacePercentage = Number(body.solo_first_place_percentage ?? body.soloFirstPlacePercentage ?? current?.solo_first_place_percentage ?? current?.soloFirstPlacePercentage ?? 60);
  const soloSecondPlacePercentage = Number(body.solo_second_place_percentage ?? body.soloSecondPlacePercentage ?? current?.solo_second_place_percentage ?? current?.soloSecondPlacePercentage ?? 30);
  const soloThirdPlacePercentage = Number(body.solo_third_place_percentage ?? body.soloThirdPlacePercentage ?? current?.solo_third_place_percentage ?? current?.soloThirdPlacePercentage ?? 10);
  const totalSlots = Number(body.total_slots ?? body.totalSlots ?? current?.total_slots ?? current?.totalSlots ?? 1);
  const matchType = body.match_type || body.matchType || current?.match_type || current?.matchType || 'solo';
  const squadSize = Number(body.squad_size ?? body.squadSize ?? current?.squad_size ?? current?.squadSize ?? (matchType === 'squad' ? 4 : 1));

  if (Number.isNaN(entryFee) || entryFee < 0) {
    throw new Error('Entry fee must be a valid positive number');
  }
  if (Number.isNaN(basePrize) || basePrize < 0) {
    throw new Error('Base prize must be a valid positive number');
  }
  if (matchType === 'squad' && (Number.isNaN(firstPrizePercentage) || firstPrizePercentage < 1 || firstPrizePercentage > 100)) {
    throw new Error('First prize percentage must be between 1 and 100');
  }
  const soloDistributionTotal = soloFirstPlacePercentage + soloSecondPlacePercentage + soloThirdPlacePercentage;
  if (matchType === 'solo') {
    if ([soloFirstPlacePercentage, soloSecondPlacePercentage, soloThirdPlacePercentage].some((value) => Number.isNaN(value) || value < 0 || value > 100)) {
      throw new Error('Solo prize percentages must be between 0 and 100');
    }
    if (soloDistributionTotal !== 100) {
      throw new Error('Total prize distribution must equal 100%');
    }
  }
  if (Number.isNaN(totalSlots) || totalSlots < 1) {
    throw new Error('Total slots must be at least 1');
  }
  if (!['solo', 'squad'].includes(matchType)) {
    throw new Error('Match type must be solo or squad');
  }
  if (Number.isNaN(squadSize) || squadSize < 1) {
    throw new Error('Squad size must be at least 1');
  }

  const startTime = body.match_start_time || body.startTime || current?.match_start_time || current?.startTime || null;
  const roomId = body.room_id ?? body.roomId ?? current?.room_id ?? current?.roomId ?? '';
  const roomPassword = body.room_password ?? body.roomPassword ?? current?.room_password ?? current?.roomPassword ?? '';
  const roomDetailsSetAt = body.room_details_set_at || body.roomDetailsSetAt || current?.room_details_set_at || null;
  const finishedAt = body.finished_at || body.finishedAt || current?.finished_at || null;

  return {
    name: gameName,
    game_type: gameName,
    gameType: gameName,
    title: body.title || current?.title || `${gameName} Showdown`,
    description: body.description ?? current?.description ?? '',
    match_type: matchType,
    matchType,
    squad_size: matchType === 'solo' ? 1 : squadSize,
    squadSize: matchType === 'solo' ? 1 : squadSize,
    entry_fee: entryFee,
    entryFee,
    base_prize: basePrize,
    basePrize,
    prizePool: basePrize,
    first_prize_percentage: matchType === 'squad' ? firstPrizePercentage : 100,
    firstPrizePercentage: matchType === 'squad' ? firstPrizePercentage : 100,
    solo_first_place_percentage: matchType === 'solo' ? soloFirstPlacePercentage : 60,
    solo_second_place_percentage: matchType === 'solo' ? soloSecondPlacePercentage : 30,
    solo_third_place_percentage: matchType === 'solo' ? soloThirdPlacePercentage : 10,
    total_slots: totalSlots,
    totalSlots,
    status: normalizeStatus(body.status || current?.status),
    match_start_time: startTime || undefined,
    startTime: startTime || undefined,
    room_id: roomId,
    roomId,
    room_password: roomPassword,
    roomPassword,
    room_details_set_at: roomDetailsSetAt || undefined,
    finished_at: finishedAt || undefined
  };
};

const getTournamentById = async (id) => (
  Tournament.findById(id).populate(tournamentPopulate)
);

const getOfflineTournament = (store, id) => (
  store.tournaments.find(t => t._id === id || t.id === id)
);

const getOfflineUser = (store, id) => (
  store.users.find(u => u._id === id || u.id === id)
);

const getUserId = (user) => user?._id?.toString?.() || user?.id?.toString?.() || user?.toString?.();

const isUserInPlayers = (players = [], userId) => players.some((player) => getUserId(player) === userId);

const isUserInAnySquad = (squads = [], userId) => squads.some((squad) => isUserInPlayers(squad.members || [], userId));

const buildLegacySquadPassword = (squad = {}, index = 0) => {
  const explicitPassword = normalizeSquadPassword(
    squad?.squad_password || squad?.squadPassword || squad?.password
  );
  if (explicitPassword) {
    return explicitPassword;
  }

  const baseName = String(squad?.name || `Squad ${index + 1}`)
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 24);

  return baseName || `Squad${index + 1}`;
};

const normalizeSquadsForOffline = (tournament) => {
  if (!Array.isArray(tournament.squads)) {
    tournament.squads = [];
  }

  tournament.squads = tournament.squads.map((squad, index) => {
    const existingSquad = squad || {};
    const normalizedCode = getSquadCode(existingSquad) || generateInternalSquadCode(tournament.squads);
    const normalizedPassword = buildLegacySquadPassword(existingSquad, index) || normalizedCode;
    const memberCount = Number(existingSquad.members?.length || 0);
    const isComplete = memberCount >= getSquadSize(tournament);

    return {
      ...existingSquad,
      _id: existingSquad._id || existingSquad.id || `offline_squad_${Date.now()}_${index}`,
      squad_code: normalizedCode,
      squad_password: normalizedPassword,
      total_entry_fee: Number(existingSquad.total_entry_fee ?? existingSquad.totalEntryFee ?? getSquadEntryFee(tournament)),
      entry_paid: existingSquad.entry_paid ?? existingSquad.entryPaid ?? true,
      status: isComplete ? 'complete' : 'forming',
      locked_at: existingSquad.locked_at || existingSquad.lockedAt || (isComplete ? new Date().toISOString() : undefined)
    };
  });

  return tournament.squads;
};

const normalizeParticipantProfilesForOffline = (tournament) => {
  if (!Array.isArray(tournament.participant_profiles)) {
    tournament.participant_profiles = [];
  }
  return tournament.participant_profiles;
};

const normalizeUserGameProfiles = (user) => {
  if (!user) return [];

  const existingProfiles = user.game_profiles || user.gameProfiles;
  if (!Array.isArray(existingProfiles)) {
    user.game_profiles = [];
    user.gameProfiles = user.game_profiles;
    return user.game_profiles;
  }

  user.game_profiles = existingProfiles;
  user.gameProfiles = existingProfiles;
  return existingProfiles;
};

const getTournamentGameName = (tournament) => (
  tournament?.game_type || tournament?.gameType || tournament?.name || 'BGMI'
);

const getUserFreeEntryState = (user) => {
  const stats = ensureReferralStats(user) || {};
  const earned = Number(stats.free_entries_earned || stats.freeEntriesEarned || 0);
  const used = Number(stats.free_entries_used || stats.freeEntriesUsed || 0);
  const available = Math.max(0, earned - used);
  stats.free_entries_used = used;
  stats.freeEntriesUsed = used;
  user.referral_stats = stats;
  user.referralStats = stats;
  return { stats, earned, used, available };
};

const normalizeJoinMethod = (body) => (
  String(body?.joinMethod || body?.join_method || 'wallet').trim().toLowerCase() === 'free_entry'
    ? 'free_entry'
    : 'wallet'
);

const normalizeSquadCode = (value) => String(value || '').trim().toUpperCase();

const normalizeSquadPassword = (value) => String(value || '').trim();

const getSquadCode = (squad) => normalizeSquadCode(squad?.squad_code || squad?.squadCode);

const getSquadPassword = (squad) => normalizeSquadPassword(squad?.squad_password || squad?.squadPassword);

const findSquadByPassword = (squads = [], squadPassword) => (
  squads.find((squad) => getSquadPassword(squad) === normalizeSquadPassword(squadPassword)) || null
);

const getSquadSize = (tournament) => Number(tournament?.squad_size || tournament?.squadSize || 4);

const getSquadEntryFee = (tournament) => Number(tournament?.entry_fee || tournament?.entryFee || 0) * getSquadSize(tournament);

const getReservedSquadSlots = (tournament) => (
  (tournament?.squads || []).length * getSquadSize(tournament)
);

const getRemainingSquadSlots = (tournament, squad) => Math.max(0, getSquadSize(tournament) - Number(squad?.members?.length || 0));

const getSquadId = (squad) => squad?._id?.toString?.() || squad?.id?.toString?.() || '';

const syncSquadStatus = (tournament, squad) => {
  if (!squad) return squad;
  const isComplete = getRemainingSquadSlots(tournament, squad) === 0;
  squad.status = isComplete ? 'complete' : 'forming';
  if (isComplete && !squad.locked_at && !squad.lockedAt) {
    squad.locked_at = new Date();
  }
  return squad;
};

const generateInternalSquadCode = (squads = []) => {
  let nextCode = '';
  do {
    nextCode = `VEX${Math.floor(1000 + Math.random() * 9000)}`;
  } while (findSquadByCode(squads, nextCode));
  return nextCode;
};

const buildSquadPayload = (body, squads = []) => {
  const squadName = String(body?.squadName || body?.name || '').trim();
  const requestedCode = normalizeSquadCode(body?.squadCode || body?.squad_code);
  const squadCode = requestedCode || generateInternalSquadCode(squads);

  if (!squadName) {
    throw new Error('Squad name is required');
  }
  if (findSquadByCode(squads, squadCode)) {
    throw new Error('Squad code already exists');
  }

  return {
    squadName,
    squadCode,
    squadPassword: squadCode
  };
};

const findSquadByCode = (squads = [], squadCode) => squads.find((squad) => getSquadCode(squad) === normalizeSquadCode(squadCode)) || null;

const applyJoinCharge = (user, tournament, body, amountOverride = null) => {
  const joinMethod = normalizeJoinMethod(body);
  const freeEntryState = getUserFreeEntryState(user);
  const amount = Number(amountOverride ?? tournament.entry_fee ?? tournament.entryFee ?? 0);

  if (joinMethod === 'free_entry' && amountOverride === null) {
    if (freeEntryState.available < 1) {
      throw new Error('No free entries available');
    }
    freeEntryState.stats.free_entries_used = Number(freeEntryState.stats.free_entries_used || 0) + 1;
    freeEntryState.stats.freeEntriesUsed = freeEntryState.stats.free_entries_used;
    user.referral_stats = freeEntryState.stats;
    user.referralStats = freeEntryState.stats;
    return { joinMethod, usedFreeEntry: true };
  }

  if ((user.walletBalance || 0) < amount) {
    throw new Error('Insufficient balance');
  }
  user.walletBalance -= amount;
  return { joinMethod, usedFreeEntry: false };
};

const buildRefundMessage = (tournament) => `Refund for dismissed tournament ${tournament.title || tournament.name || 'match'}`;

const buildJoinProfilePayload = (body, tournament) => {
  const gameUid = String(body.gameUid || body.game_uid || '').trim();
  const inGameName = String(body.inGameName || body.in_game_name || body.gameName || '').trim();
  const gameName = getTournamentGameName(tournament);

  if (!gameUid) {
    throw new Error(`${gameName} UID is required`);
  }
  if (!inGameName) {
    throw new Error('In-game name is required');
  }

  return {
    game_uid: gameUid,
    in_game_name: inGameName,
    game_name: gameName,
    join_method: normalizeJoinMethod(body)
  };
};

const saveUserGameProfile = (user, tournament, profile) => {
  if (!user || !profile) return null;

  const profiles = normalizeUserGameProfiles(user);
  const gameName = String(profile.game_name || getTournamentGameName(tournament)).trim();
  const existing = profiles.find((item) => String(item.game_name || item.gameName || '').toLowerCase() === gameName.toLowerCase());
  const nextProfile = {
    ...(existing || {}),
    game_name: gameName,
    in_game_name: String(profile.in_game_name || profile.inGameName || '').trim(),
    game_uid: String(profile.game_uid || profile.gameUid || '').trim(),
    updated_at: new Date()
  };

  if (existing) {
    Object.assign(existing, nextProfile);
    return existing;
  }

  profiles.push(nextProfile);
  return nextProfile;
};

const getUserGameProfileForTournament = (user, tournament) => {
  if (!user) return null;

  const profiles = normalizeUserGameProfiles(user);
  const gameName = getTournamentGameName(tournament).toLowerCase();
  return profiles.find((item) => String(item.game_name || item.gameName || '').toLowerCase() === gameName) || null;
};

const upsertParticipantProfile = (tournament, userId, profile, extra = {}) => {
  tournament.participant_profiles = Array.isArray(tournament.participant_profiles) ? tournament.participant_profiles : [];
  const existing = tournament.participant_profiles.find((item) => getUserId(item.user || item.userId) === userId);
  const nextProfile = {
    ...(existing || {}),
    ...(profile || {}),
    ...extra,
    user: existing?.user || userId,
    joined_at: existing?.joined_at || existing?.joinedAt || new Date()
  };

  if (existing) {
    Object.assign(existing, nextProfile);
  } else {
    tournament.participant_profiles.push(nextProfile);
  }
};

const ensureTournamentParticipantProfiles = (tournament, resolveUser) => {
  const profiles = Array.isArray(tournament?.participant_profiles) ? tournament.participant_profiles : [];
  const players = Array.isArray(tournament?.currentPlayers) ? tournament.currentPlayers : [];
  let changed = false;

  for (const player of players) {
    const userId = getUserId(player);
    if (!userId) continue;

    const existing = profiles.find((item) => getUserId(item.user || item.userId) === userId);
    if (existing?.in_game_name && existing?.game_uid) {
      continue;
    }

    const user = resolveUser(userId, player);
    const savedProfile = getUserGameProfileForTournament(user, tournament);
    if (!savedProfile?.in_game_name || !savedProfile?.game_uid) {
      continue;
    }

    upsertParticipantProfile(tournament, userId, {
      game_name: savedProfile.game_name || getTournamentGameName(tournament),
      in_game_name: savedProfile.in_game_name,
      game_uid: savedProfile.game_uid,
      join_method: existing?.join_method || existing?.joinMethod || 'wallet'
    }, {
      user: user?._id || userId,
      joined_at: existing?.joined_at || existing?.joinedAt || savedProfile.updated_at || new Date()
    });
    changed = true;
  }

  return changed;
};

const pushNotification = (user, payload) => {
  user.notifications = user.notifications || [];
  user.notifications.push({
    message: payload.message,
    type: payload.type || 'info',
    tournamentId: payload.tournamentId || '',
    link: payload.link || '',
    read: false,
    createdAt: new Date()
  });
};

const pushOfflineNotification = (user, payload) => {
  user.notifications = user.notifications || [];
  user.notifications.push({
    _id: `offline_note_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    message: payload.message,
    type: payload.type || 'info',
    tournamentId: payload.tournamentId || '',
    link: payload.link || '',
    read: false,
    createdAt: new Date().toISOString()
  });
};

const buildJoinedUserRecord = (user, tournament, profile, squad = null) => {
  const resolvedProfile = profile || getUserGameProfileForTournament(user, tournament) || null;
  const joinMethod = resolvedProfile?.join_method || resolvedProfile?.joinMethod || 'wallet';
  const captainId = squad ? getUserId(squad.captain) : '';
  const paymentStatusMap = {
    free_entry: 'Referral Reward Entry',
    squad_captain: 'Captain Paid Full Squad Fee',
    squad_invite: 'Covered by Captain',
    wallet: 'Paid via Wallet'
  };

  return {
    ...serializeUser(user),
    inGameName: resolvedProfile?.inGameName || resolvedProfile?.in_game_name || '',
    gameUID: resolvedProfile?.gameUid || resolvedProfile?.game_uid || '',
    joinedAt: resolvedProfile?.joinedAt || resolvedProfile?.joined_at || null,
    matchType: tournament?.match_type || tournament?.matchType || 'solo',
    joinMethod,
    paymentStatus: paymentStatusMap[joinMethod] || 'Paid via Wallet',
    squadInfo: squad ? {
      id: squad._id?.toString?.() || squad.id || '',
      name: squad.name || '',
      code: getSquadCode(squad),
      captainId,
      captainName: squad.captain?.name || squad.captain?.email || '',
      isLeader: captainId === getUserId(user),
      memberCount: squad.memberCount || squad.members?.length || 0,
      waitingCount: getRemainingSquadSlots(tournament, squad),
      status: getRemainingSquadSlots(tournament, squad) === 0 ? 'complete' : 'forming',
      totalEntryFee: Number(squad.total_entry_fee || squad.totalEntryFee || getSquadEntryFee(tournament))
    } : null,
    tournamentProfile: resolvedProfile || null
  };
};

const canRevealRoomDetails = (tournament) => {
  const startTime = tournament?.match_start_time || tournament?.startTime;
  const hasStarted = startTime ? new Date(startTime).getTime() <= Date.now() : false;
  return Boolean(tournament?.room_id || tournament?.roomId) && (
    hasStarted
    || tournament?.status === 'completed'
    || tournament?.status === 'dismissed'
  );
};

const buildSquadLobbyResponse = (tournament, squad, joinedUsers, currentUserId) => {
  const squadComplete = getRemainingSquadSlots(tournament, squad) === 0;
  const roomVisible = squadComplete && canRevealRoomDetails(tournament);
  const roomId = roomVisible ? (tournament?.room_id || tournament?.roomId || '') : '';
  const roomPassword = roomVisible ? (tournament?.room_password || tournament?.roomPassword || '') : '';
  const captainId = getUserId(squad?.captain);
  const currentUserIsCaptain = captainId === currentUserId;
  const captainRecord = joinedUsers.find((user) => (user._id || user.id) === captainId) || null;
  const visibleUsers = captainRecord ? [captainRecord] : [];

  return {
    tournamentId: tournament?._id?.toString?.() || tournament?.id || '',
    tournamentTitle: tournament?.title || tournament?.name || 'Tournament',
    matchType: tournament?.match_type || tournament?.matchType || 'squad',
    gameName: getTournamentGameName(tournament),
    squadSize: getSquadSize(tournament),
    squad: {
      id: squad?._id?.toString?.() || squad?.id || '',
      name: squad?.name || '',
      code: currentUserIsCaptain ? getSquadCode(squad) : '',
      inviteCode: currentUserIsCaptain ? getSquadCode(squad) : '',
      password: currentUserIsCaptain ? getSquadCode(squad) : '',
      canShareInvite: currentUserIsCaptain,
      captainId,
      memberCount: squad?.memberCount || squad?.members?.length || 0,
      remainingSlots: getRemainingSquadSlots(tournament, squad),
      isComplete: squadComplete,
      status: squadComplete ? 'complete' : 'forming',
      totalEntryFee: Number(squad?.total_entry_fee || squad?.totalEntryFee || getSquadEntryFee(tournament)),
      members: visibleUsers.map((user) => ({
        id: user._id || user.id,
        name: user.name || user.email || 'Unknown Player',
        avatarId: user.avatarId || user.avatar_id || 'vanguard-01',
        inGameName: user.inGameName || '',
        gameUID: user.gameUID || '',
        paymentStatus: user.paymentStatus || 'Paid',
        joinMethod: user.joinMethod || 'wallet',
        joinedAt: user.joinedAt || null,
        isLeader: user._id === getUserId(squad?.captain) || user.id === getUserId(squad?.captain),
        isCurrentUser: (user._id || user.id) === currentUserId
      }))
    },
    roomDetails: {
      visible: roomVisible,
      roomId,
      roomPassword,
      sharedAt: tournament?.room_details_set_at || null,
      availableAt: tournament?.match_start_time || tournament?.startTime || null
    }
  };
};

const notifyUsersForTournament = async (users, tournament, payload) => {
  for (const user of users) {
    pushNotification(user, {
      ...payload,
      tournamentId: tournament?._id?.toString?.() || tournament?.id || '',
      link: `/tournament/${tournament?._id?.toString?.() || tournament?.id || ''}`
    });
    await user.save();
  }
};

const hydrateOfflineTournament = (store, tournament) => {
  if (!tournament) return null;
  ensureTournamentParticipantProfiles(tournament, (userId) => getOfflineUser(store, userId));
  const hydratedCurrentPlayers = (tournament.currentPlayers || [])
    .map((userId) => getOfflineUser(store, userId))
    .filter(Boolean);
  const hydratedWinner = tournament.winner ? getOfflineUser(store, tournament.winner) || tournament.winner : null;
  const hydratedSecondWinner = tournament.second_winner ? getOfflineUser(store, tournament.second_winner) || tournament.second_winner : null;
  const hydratedThirdWinner = tournament.third_winner ? getOfflineUser(store, tournament.third_winner) || tournament.third_winner : null;
  const participantProfiles = normalizeParticipantProfilesForOffline(tournament).map((profile) => ({
    ...profile,
    user: getOfflineUser(store, profile.user || profile.userId) || profile.user || profile.userId
  }));
  const squads = normalizeSquadsForOffline(tournament).map((squad) => ({
    ...squad,
    captain: getOfflineUser(store, squad.captain) || squad.captain,
    members: (squad.members || []).map((memberId) => getOfflineUser(store, memberId) || memberId)
  }));

  return {
    ...tournament,
    currentPlayers: hydratedCurrentPlayers,
    participant_profiles: participantProfiles,
    winner: hydratedWinner,
    second_winner: hydratedSecondWinner,
    third_winner: hydratedThirdWinner,
    squads
  };
};

const getQueryOptions = (req) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const perPage = Math.max(1, Number(req.query.perPage || req.query.limit) || 50);
  const skip = (page - 1) * perPage;
  const filter = {};

  const statusFromFilter = req.query.filter?.match(/status\s*=\s*"([^"]+)"/)?.[1];
  const statusValue = req.query.status || statusFromFilter;
  if (statusValue) {
    filter.status = { $in: statusValue.split(',').map(normalizeStatus) };
  }

  if (req.query.gameType) {
    filter.game_type = { $in: req.query.gameType.split(',') };
  }

  if (req.query.search) {
    filter.$or = [
      { name: { $regex: req.query.search, $options: 'i' } },
      { game_type: { $regex: req.query.search, $options: 'i' } },
      { title: { $regex: req.query.search, $options: 'i' } }
    ];
  }

  if (req.query.joinedUserId) {
    filter.currentPlayers = req.query.joinedUserId;
  }

  const sortMap = {
    '-created': '-createdAt',
    created: 'createdAt',
    '-prize_pool': '-base_prize',
    prize_pool: 'base_prize',
    '-joined_count': '-joined_count',
    joined_count: 'joined_count',
    entry_fee: 'entry_fee',
    '-entry_fee': '-entry_fee'
  };
  const rawSort = req.query.sortBy || req.query.sort || '-createdAt';
  const sort = sortMap[rawSort] || rawSort;

  return { page, perPage, skip, filter, sort };
};

router.get('/', async (req, res) => {
  try {
    const { page, perPage, skip, filter, sort } = getQueryOptions(req);

    if (isDBConnected()) {
      const [totalItems, tournaments] = await Promise.all([
        Tournament.countDocuments(filter),
        Tournament.find(filter).sort(sort).skip(skip).limit(perPage).populate(tournamentPopulate)
      ]);
      const items = tournaments.map(serializeTournament);
      return res.json({
        items,
        tournaments: items,
        page,
        perPage,
        totalItems,
        totalPages: Math.ceil(totalItems / perPage) || 1
      });
    }

    const store = await getStore();
    let items = store.tournaments.map((tournament) => serializeTournament(hydrateOfflineTournament(store, tournament)));
    if (filter.status?.$in) {
      items = items.filter(t => filter.status.$in.includes(normalizeStatus(t.status)));
    }
    if (filter.game_type?.$in) {
      items = items.filter(t => filter.game_type.$in.includes(t.game_type));
    }
    if (req.query.joinedUserId) {
      items = items.filter(t => (t.currentPlayers || []).some(player => getUserId(player) === req.query.joinedUserId));
    }
    if (req.query.search) {
      const searchValue = req.query.search.toLowerCase();
      items = items.filter(t => [t.name, t.game_type, t.title].some(value => value?.toLowerCase().includes(searchValue)));
    }
    items.sort((left, right) => new Date(right.created || 0) - new Date(left.created || 0));
    const totalItems = items.length;
    items = items.slice(skip, skip + perPage);
    return res.json({ items, tournaments: items, page, perPage, totalItems, totalPages: Math.ceil(totalItems / perPage) || 1 });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    if (isDBConnected()) {
      const tournament = await getTournamentById(req.params.id);
      if (!tournament) {
        return res.status(404).json({ error: 'Tournament not found' });
      }
      return res.json(serializeTournament(tournament));
    }

    const store = await getStore();
    const tournament = getOfflineTournament(store, req.params.id);
    if (!tournament) {
      return res.status(404).json({ error: 'Tournament not found' });
    }
    return res.json(serializeTournament(hydrateOfflineTournament(store, tournament)));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id/squad-lobby', async (req, res) => {
  try {
    const currentUserId = String(req.query.userId || '').trim();
    if (!currentUserId) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    if (isDBConnected()) {
      const tournament = await Tournament.findById(req.params.id)
        .populate('currentPlayers', 'name email walletBalance game_profiles gameProfiles avatar_id avatar_rarity')
        .populate('participant_profiles.user', 'name email walletBalance game_profiles gameProfiles avatar_id avatar_rarity')
        .populate('squads.captain', 'name email walletBalance avatar_id avatar_rarity')
        .populate('squads.members', 'name email walletBalance avatar_id avatar_rarity');
      if (!tournament) {
        return res.status(404).json({ error: 'Tournament not found' });
      }
      const squad = (tournament.squads || []).find((item) => (item.members || []).some((member) => getUserId(member) === currentUserId)) || null;
      if (!squad) {
        return res.status(403).json({ error: 'You are not part of any squad in this tournament' });
      }

      const participantProfiles = tournament.participant_profiles || [];
      const joinedUsers = (squad.members || []).map((member) => {
        const memberId = getUserId(member);
        const profile = participantProfiles.find((item) => getUserId(item.user) === memberId) || null;
        return buildJoinedUserRecord(member, tournament, profile, squad);
      });

      return res.json(buildSquadLobbyResponse(tournament, squad, joinedUsers, currentUserId));
    }

    const store = await getStore();
    const tournament = getOfflineTournament(store, req.params.id);
    if (!tournament) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    const hydratedTournament = hydrateOfflineTournament(store, tournament);
    const squad = (hydratedTournament.squads || []).find((item) => (item.members || []).some((member) => getUserId(member) === currentUserId)) || null;
    if (!squad) {
      return res.status(403).json({ error: 'You are not part of any squad in this tournament' });
    }

    const participantProfiles = hydratedTournament.participant_profiles || [];
    const joinedUsers = (squad.members || []).map((member) => {
      const memberId = getUserId(member);
      const profile = participantProfiles.find((item) => getUserId(item.user) === memberId) || null;
      return buildJoinedUserRecord(member, hydratedTournament, profile, squad);
    });

    return res.json(buildSquadLobbyResponse(hydratedTournament, squad, joinedUsers, currentUserId));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const payload = normalizeTournamentPayload(req.body);

    if (isDBConnected()) {
      const tournament = await Tournament.create(payload);
      const created = await getTournamentById(tournament._id);
      const users = await User.find().select('notifications');
      await notifyUsersForTournament(users, created, {
        type: 'tournament',
        message: `New ${created.game_type} tournament added: ${created.title}`
      });
      return res.status(201).json(serializeTournament(created));
    }

    const store = await getStore();
    const tournament = {
      _id: `offline_t${store.nextIds.tournament++}`,
      ...payload,
      currentPlayers: [],
      participant_profiles: [],
      squads: [],
      joined_count: 0,
      createdAt: new Date().toISOString()
    };
    store.tournaments.push(tournament);
    for (const user of store.users) {
      pushOfflineNotification(user, {
        type: 'tournament',
        tournamentId: tournament._id,
        link: `/tournament/${tournament._id}`,
        message: `New ${tournament.game_type || tournament.name} tournament added: ${tournament.title}`
      });
    }
    await persistStore();
    return res.status(201).json(serializeTournament(tournament));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    if (isDBConnected()) {
      const tournament = await Tournament.findById(req.params.id);
      if (!tournament) {
        return res.status(404).json({ error: 'Tournament not found' });
      }
      const payload = normalizeTournamentPayload(req.body, tournament);
      Object.assign(tournament, payload);
      if (payload.match_type === 'solo') {
        tournament.squads = [];
      }
      await tournament.save();
      const updated = await getTournamentById(tournament._id);
      return res.json(serializeTournament(updated));
    }

    const store = await getStore();
    const index = store.tournaments.findIndex(t => t._id === req.params.id || t.id === req.params.id);
    if (index === -1) {
      return res.status(404).json({ error: 'Tournament not found' });
    }
    const payload = normalizeTournamentPayload(req.body, store.tournaments[index]);
    store.tournaments[index] = { ...store.tournaments[index], ...payload, updatedAt: new Date().toISOString() };
    if (payload.match_type === 'solo') {
      store.tournaments[index].squads = [];
    }
    await persistStore();
    return res.json(serializeTournament(store.tournaments[index]));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    if (isDBConnected()) {
      const deleted = await Tournament.findByIdAndDelete(req.params.id);
      if (!deleted) {
        return res.status(404).json({ error: 'Tournament not found' });
      }
      return res.json({ message: 'Tournament deleted' });
    }

    const store = await getStore();
    const before = store.tournaments.length;
    store.tournaments = store.tournaments.filter(t => t._id !== req.params.id && t.id !== req.params.id);
    if (store.tournaments.length === before) {
      return res.status(404).json({ error: 'Tournament not found' });
    }
    await persistStore();
    return res.json({ message: 'Tournament deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id/joins', async (req, res) => {
  try {
    if (isDBConnected()) {
      const tournament = await Tournament.findById(req.params.id)
        .populate('currentPlayers', 'name email walletBalance game_profiles gameProfiles avatar_id avatar_rarity')
        .populate('participant_profiles.user', 'name email walletBalance game_profiles gameProfiles avatar_id avatar_rarity')
        .populate('squads.captain', 'name email walletBalance avatar_id avatar_rarity')
        .populate('squads.members', 'name email walletBalance avatar_id avatar_rarity');
      if (!tournament) {
        return res.status(404).json({ error: 'Tournament not found' });
      }
      const repaired = ensureTournamentParticipantProfiles(
        tournament,
        (userId) => (tournament.currentPlayers || []).find((user) => user?._id?.toString?.() === userId) || null
      );
      if (repaired) {
        await tournament.save();
      }
      const participantProfiles = tournament.participant_profiles || [];
      const squads = tournament.squads || [];
      return res.json((tournament.currentPlayers || []).map((user) => {
        const profile = participantProfiles.find((item) => getUserId(item.user) === user._id.toString()) || null;
        const squad = squads.find((item) => (item.members || []).some((member) => getUserId(member) === user._id.toString())) || null;
        return buildJoinedUserRecord(user, tournament, profile, squad);
      }));
    }

    const store = await getStore();
    const tournament = getOfflineTournament(store, req.params.id);
    if (!tournament) {
      return res.status(404).json({ error: 'Tournament not found' });
    }
    const repaired = ensureTournamentParticipantProfiles(tournament, (userId) => getOfflineUser(store, userId));
    if (repaired) {
      await persistStore();
    }
    const profiles = normalizeParticipantProfilesForOffline(tournament || {});
    const squads = normalizeSquadsForOffline(tournament || {});
    const users = (tournament?.currentPlayers || [])
      .map(userId => {
        const user = getOfflineUser(store, userId);
        if (!user) return null;
        const profile = profiles.find((item) => getUserId(item.user || item.userId) === getUserId(userId)) || null;
        const squad = squads.find((item) => (item.members || []).some((member) => getUserId(member) === getUserId(userId))) || null;
        return buildJoinedUserRecord(user, tournament, profile, squad);
      })
      .filter(Boolean);
    return res.json(users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/:id/join', async (req, res) => {
  try {
    const userId = req.body.userId || req.body._id || req.body.id;
    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    if (isDBConnected()) {
      const tournament = await Tournament.findById(req.params.id);
      if (!tournament) {
        return res.status(404).json({ error: 'Tournament not found' });
      }

      if (normalizeStatus(tournament.status) !== 'active') {
        return res.status(400).json({ error: 'Tournament is not open for joining' });
      }
      if ((tournament.match_type || tournament.matchType || 'solo') === 'squad') {
        return res.status(400).json({ error: 'Create or join a squad for this tournament' });
      }

      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      const joinProfile = buildJoinProfilePayload(req.body, tournament);

      const alreadyJoined = isUserInPlayers(tournament.currentPlayers || [], user._id.toString());
      if (alreadyJoined) {
        return res.status(400).json({ error: 'You already joined this tournament' });
      }

      if ((tournament.currentPlayers || []).length >= tournament.total_slots) {
        return res.status(400).json({ error: 'Tournament is full' });
      }

      applyJoinCharge(user, tournament, req.body);
      tournament.currentPlayers.push(user._id);
      tournament.joined_count = tournament.currentPlayers.length;
      upsertParticipantProfile(tournament, user._id.toString(), joinProfile);
      saveUserGameProfile(user, tournament, joinProfile);

      await Promise.all([tournament.save(), user.save()]);

      const updatedTournament = await getTournamentById(tournament._id);
      return res.json(serializeTournament(updatedTournament));
    }

    const store = await getStore();
    const tournament = getOfflineTournament(store, req.params.id);
    const user = getOfflineUser(store, userId);
    if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
    if (!user) return res.status(404).json({ error: 'User not found' });
    const joinProfile = buildJoinProfilePayload(req.body, tournament);
    if (normalizeStatus(tournament.status) !== 'active') return res.status(400).json({ error: 'Tournament is not open for joining' });
    if ((tournament.match_type || tournament.matchType || 'solo') === 'squad') return res.status(400).json({ error: 'Create or join a squad for this tournament' });
    if (!tournament.currentPlayers) tournament.currentPlayers = [];
    if (isUserInPlayers(tournament.currentPlayers, userId)) return res.status(400).json({ error: 'You already joined this tournament' });
    if (tournament.currentPlayers.length >= tournament.total_slots) return res.status(400).json({ error: 'Tournament is full' });
    applyJoinCharge(user, tournament, req.body);
    tournament.currentPlayers.push(userId);
    tournament.joined_count = tournament.currentPlayers.length;
    upsertParticipantProfile(tournament, userId, joinProfile, { user: userId });
    saveUserGameProfile(user, tournament, joinProfile);
    await persistStore();
    return res.json(serializeTournament(tournament));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/:id/squads', async (req, res) => {
  try {
    const userId = req.body.userId || req.body._id || req.body.id;

    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    if (isDBConnected()) {
      const [tournament, user] = await Promise.all([
        Tournament.findById(req.params.id),
        User.findById(userId)
      ]);
      if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
      if (!user) return res.status(404).json({ error: 'User not found' });
      const { squadName, squadCode, squadPassword } = buildSquadPayload(req.body, tournament.squads || []);
      const joinProfile = buildJoinProfilePayload(req.body, tournament);
      if ((tournament.match_type || tournament.matchType || 'solo') !== 'squad') {
        return res.status(400).json({ error: 'This tournament does not support squads' });
      }
      if (normalizeStatus(tournament.status) !== 'active') {
        return res.status(400).json({ error: 'Tournament is not open for joining' });
      }
      if (isUserInPlayers(tournament.currentPlayers || [], user._id.toString())) {
        return res.status(400).json({ error: 'You already joined this tournament' });
      }
      if (getReservedSquadSlots(tournament) + getSquadSize(tournament) > Number(tournament.total_slots || tournament.totalSlots || 0)) {
        return res.status(400).json({ error: 'Tournament is full' });
      }
      if ((tournament.squads || []).some((squad) => squad.name.toLowerCase() === squadName.toLowerCase())) {
        return res.status(400).json({ error: 'Squad name already exists' });
      }
      const totalEntryFee = getSquadEntryFee(tournament);
      applyJoinCharge(user, tournament, { joinMethod: 'wallet' }, totalEntryFee);
      tournament.squads.push({
        name: squadName,
        squad_code: squadCode,
        squad_password: squadPassword,
        captain: user._id,
        members: [user._id],
        total_entry_fee: totalEntryFee,
        entry_paid: true,
        status: getSquadSize(tournament) === 1 ? 'complete' : 'forming',
        locked_at: getSquadSize(tournament) === 1 ? new Date() : undefined
      });
      const squad = tournament.squads[tournament.squads.length - 1];
      tournament.currentPlayers.push(user._id);
      tournament.joined_count = tournament.currentPlayers.length;
      upsertParticipantProfile(tournament, user._id.toString(), { ...joinProfile, join_method: 'squad_captain' }, { squad_id: squad?._id?.toString?.() || '' });
      saveUserGameProfile(user, tournament, joinProfile);
      await Promise.all([tournament.save(), user.save()]);

      const updatedTournament = await getTournamentById(tournament._id);
      return res.status(201).json(serializeTournament(updatedTournament));
    }

    const store = await getStore();
    const tournament = getOfflineTournament(store, req.params.id);
    const user = getOfflineUser(store, userId);
    if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
    if (!user) return res.status(404).json({ error: 'User not found' });
    const squads = normalizeSquadsForOffline(tournament);
    const { squadName, squadCode, squadPassword } = buildSquadPayload(req.body, squads);
    const joinProfile = buildJoinProfilePayload(req.body, tournament);
    if ((tournament.match_type || tournament.matchType || 'solo') !== 'squad') return res.status(400).json({ error: 'This tournament does not support squads' });
    if (normalizeStatus(tournament.status) !== 'active') return res.status(400).json({ error: 'Tournament is not open for joining' });
    if (!tournament.currentPlayers) tournament.currentPlayers = [];
    if (isUserInPlayers(tournament.currentPlayers, userId)) return res.status(400).json({ error: 'You already joined this tournament' });
    if (getReservedSquadSlots(tournament) + getSquadSize(tournament) > Number(tournament.total_slots || tournament.totalSlots || 0)) return res.status(400).json({ error: 'Tournament is full' });
    if (squads.some((squad) => squad.name?.toLowerCase() === squadName.toLowerCase())) return res.status(400).json({ error: 'Squad name already exists' });

    const totalEntryFee = getSquadEntryFee(tournament);
    applyJoinCharge(user, tournament, { joinMethod: 'wallet' }, totalEntryFee);
    squads.push({
      _id: `offline_squad_${Date.now()}`,
      name: squadName,
      squad_code: squadCode,
      squad_password: squadPassword,
      captain: userId,
      members: [userId],
      total_entry_fee: totalEntryFee,
      entry_paid: true,
      status: getSquadSize(tournament) === 1 ? 'complete' : 'forming',
      locked_at: getSquadSize(tournament) === 1 ? new Date().toISOString() : undefined,
      createdAt: new Date().toISOString()
    });
    const squad = squads[squads.length - 1];
    tournament.currentPlayers.push(userId);
    tournament.joined_count = tournament.currentPlayers.length;
    upsertParticipantProfile(tournament, userId, { ...joinProfile, join_method: 'squad_captain' }, { user: userId, squad_id: squad._id });
    saveUserGameProfile(user, tournament, joinProfile);
    await persistStore();
    return res.status(201).json(serializeTournament(tournament));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

const handleJoinSquadByPassword = async (req, res) => {
  try {
    const userId = req.body.userId || req.body._id || req.body.id;
    const squadCode = normalizeSquadCode(req.body.squadCode || req.body.squad_code || req.body.squadPassword || req.body.squad_password);

    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }
    if (!squadCode) {
      return res.status(400).json({ error: 'Squad code is required' });
    }

    if (isDBConnected()) {
      const [tournament, user] = await Promise.all([
        Tournament.findById(req.params.id),
        User.findById(userId)
      ]);
      if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
      if (!user) return res.status(404).json({ error: 'User not found' });
      const joinProfile = buildJoinProfilePayload(req.body, tournament);
      if ((tournament.match_type || tournament.matchType || 'solo') !== 'squad') {
        return res.status(400).json({ error: 'This tournament does not support squads' });
      }
      if (normalizeStatus(tournament.status) !== 'active') {
        return res.status(400).json({ error: 'Tournament is not open for joining' });
      }
      if (isUserInPlayers(tournament.currentPlayers || [], user._id.toString()) || isUserInAnySquad(tournament.squads || [], user._id.toString())) {
        return res.status(400).json({ error: 'You already joined this tournament' });
      }
      const squad = findSquadByCode(tournament.squads || [], squadCode) || findSquadByPassword(tournament.squads || [], squadCode);
      if (!squad) {
        return res.status(404).json({ error: 'Squad code is invalid' });
      }
      if ((squad.members || []).some((member) => getUserId(member) === user._id.toString())) {
        return res.status(400).json({ error: 'You already joined this squad' });
      }
      if (getRemainingSquadSlots(tournament, squad) <= 0) {
        return res.status(400).json({ error: 'Squad is already full' });
      }

      squad.members.push(user._id);
      syncSquadStatus(tournament, squad);
      tournament.currentPlayers.push(user._id);
      tournament.joined_count = tournament.currentPlayers.length;
      upsertParticipantProfile(tournament, user._id.toString(), { ...joinProfile, join_method: 'squad_invite' }, { squad_id: squad._id.toString() });
      saveUserGameProfile(user, tournament, joinProfile);
      await Promise.all([tournament.save(), user.save()]);

      const updatedTournament = await getTournamentById(tournament._id);
      return res.json(serializeTournament(updatedTournament));
    }

    const store = await getStore();
    const tournament = getOfflineTournament(store, req.params.id);
    const user = getOfflineUser(store, userId);
    if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
    if (!user) return res.status(404).json({ error: 'User not found' });
    const joinProfile = buildJoinProfilePayload(req.body, tournament);
    if ((tournament.match_type || tournament.matchType || 'solo') !== 'squad') return res.status(400).json({ error: 'This tournament does not support squads' });
    if (normalizeStatus(tournament.status) !== 'active') return res.status(400).json({ error: 'Tournament is not open for joining' });
    if (!tournament.currentPlayers) tournament.currentPlayers = [];
    const squads = normalizeSquadsForOffline(tournament);
    if (isUserInPlayers(tournament.currentPlayers, userId) || isUserInAnySquad(squads, userId)) return res.status(400).json({ error: 'You already joined this tournament' });

    const squad = findSquadByCode(squads, squadCode) || findSquadByPassword(squads, squadCode);
    if (!squad) return res.status(404).json({ error: 'Squad code is invalid' });
    if ((squad.members || []).some((member) => getUserId(member) === userId)) return res.status(400).json({ error: 'You already joined this squad' });
    if (getRemainingSquadSlots(tournament, squad) <= 0) return res.status(400).json({ error: 'Squad is already full' });

    squad.members = [...(squad.members || []), userId];
    syncSquadStatus(tournament, squad);
    tournament.currentPlayers.push(userId);
    tournament.joined_count = tournament.currentPlayers.length;
    upsertParticipantProfile(tournament, userId, { ...joinProfile, join_method: 'squad_invite' }, { user: userId, squad_id: squad._id || squad.id || '' });
    saveUserGameProfile(user, tournament, joinProfile);
    await persistStore();
    return res.json(serializeTournament(tournament));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

router.post('/:id/squads/join-by-password', handleJoinSquadByPassword);
router.post('/:id/squads/join-by-code', handleJoinSquadByPassword);

router.post('/:id/squads/:squadId/join', async (req, res) => {
  try {
    const userId = req.body.userId || req.body._id || req.body.id;
    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    if (isDBConnected()) {
      const [tournament, user] = await Promise.all([
        Tournament.findById(req.params.id),
        User.findById(userId)
      ]);
      if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
      if (!user) return res.status(404).json({ error: 'User not found' });
      const joinProfile = buildJoinProfilePayload(req.body, tournament);
      if ((tournament.match_type || tournament.matchType || 'solo') !== 'squad') {
        return res.status(400).json({ error: 'This tournament does not support squads' });
      }
      if (normalizeStatus(tournament.status) !== 'active') {
        return res.status(400).json({ error: 'Tournament is not open for joining' });
      }
      if (isUserInPlayers(tournament.currentPlayers || [], user._id.toString()) || isUserInAnySquad(tournament.squads || [], user._id.toString())) {
        return res.status(400).json({ error: 'You already joined this tournament' });
      }
      const squad = tournament.squads.id(req.params.squadId);
      if (!squad) {
        return res.status(404).json({ error: 'Squad not found' });
      }
      if (getRemainingSquadSlots(tournament, squad) <= 0) {
        return res.status(400).json({ error: 'Squad is already full' });
      }

      squad.members.push(user._id);
      syncSquadStatus(tournament, squad);
      tournament.currentPlayers.push(user._id);
      tournament.joined_count = tournament.currentPlayers.length;
      upsertParticipantProfile(tournament, user._id.toString(), { ...joinProfile, join_method: 'squad_invite' }, { squad_id: squad._id.toString() });
      saveUserGameProfile(user, tournament, joinProfile);
      await Promise.all([tournament.save(), user.save()]);

      const updatedTournament = await getTournamentById(tournament._id);
      return res.json(serializeTournament(updatedTournament));
    }

    const store = await getStore();
    const tournament = getOfflineTournament(store, req.params.id);
    const user = getOfflineUser(store, userId);
    if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
    if (!user) return res.status(404).json({ error: 'User not found' });
    const joinProfile = buildJoinProfilePayload(req.body, tournament);
    if ((tournament.match_type || tournament.matchType || 'solo') !== 'squad') return res.status(400).json({ error: 'This tournament does not support squads' });
    if (normalizeStatus(tournament.status) !== 'active') return res.status(400).json({ error: 'Tournament is not open for joining' });
    if (!tournament.currentPlayers) tournament.currentPlayers = [];
    const squads = normalizeSquadsForOffline(tournament);
    if (isUserInPlayers(tournament.currentPlayers, userId) || isUserInAnySquad(squads, userId)) return res.status(400).json({ error: 'You already joined this tournament' });
    const squad = squads.find((item) => item._id === req.params.squadId || item.id === req.params.squadId);
    if (!squad) return res.status(404).json({ error: 'Squad not found' });
    if (getRemainingSquadSlots(tournament, squad) <= 0) return res.status(400).json({ error: 'Squad is already full' });

    squad.members = [...(squad.members || []), userId];
    syncSquadStatus(tournament, squad);
    tournament.currentPlayers.push(userId);
    tournament.joined_count = tournament.currentPlayers.length;
    upsertParticipantProfile(tournament, userId, { ...joinProfile, join_method: 'squad_invite' }, { user: userId, squad_id: squad._id || squad.id || '' });
    saveUserGameProfile(user, tournament, joinProfile);
    await persistStore();
    return res.json(serializeTournament(tournament));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.delete('/:id/squads/:squadId', async (req, res) => {
  try {
    if (isDBConnected()) {
      const tournament = await Tournament.findById(req.params.id);
      if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
      const squad = (tournament.squads || []).find((item) => getSquadId(item) === req.params.squadId);
      if (!squad) return res.status(404).json({ error: 'Squad not found' });
      const memberIds = new Set((squad.members || []).map((member) => getUserId(member)).filter(Boolean));
      tournament.squads = (tournament.squads || []).filter((item) => getSquadId(item) !== req.params.squadId);
      tournament.currentPlayers = (tournament.currentPlayers || []).filter((playerId) => !memberIds.has(getUserId(playerId)));
      tournament.participant_profiles = (tournament.participant_profiles || []).filter((profile) => !memberIds.has(getUserId(profile.user || profile.userId)));
      tournament.joined_count = tournament.currentPlayers.length;
      await tournament.save();
      const updatedTournament = await getTournamentById(tournament._id);
      return res.json({ message: 'Squad removed', tournament: serializeTournament(updatedTournament) });
    }

    const store = await getStore();
    const tournament = getOfflineTournament(store, req.params.id);
    if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
    const squads = normalizeSquadsForOffline(tournament);
    const squad = squads.find((item) => getSquadId(item) === req.params.squadId);
    if (!squad) return res.status(404).json({ error: 'Squad not found' });
    const memberIds = new Set((squad.members || []).map(getUserId).filter(Boolean));
    tournament.squads = squads.filter((item) => getSquadId(item) !== req.params.squadId);
    tournament.currentPlayers = (tournament.currentPlayers || []).filter((playerId) => !memberIds.has(getUserId(playerId)));
    tournament.participant_profiles = (tournament.participant_profiles || []).filter((profile) => !memberIds.has(getUserId(profile.user || profile.userId)));
    tournament.joined_count = tournament.currentPlayers.length;
    await persistStore();
    return res.json({ message: 'Squad removed', tournament: serializeTournament(hydrateOfflineTournament(store, tournament)) });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/:id/declare-winner', async (req, res) => {
  try {
    const { userId, squadId } = req.body;
    const firstPlaceUserId = req.body.firstPlaceUserId || req.body.first_place_user_id || userId;
    const secondPlaceUserId = req.body.secondPlaceUserId || req.body.second_place_user_id;
    const thirdPlaceUserId = req.body.thirdPlaceUserId || req.body.third_place_user_id;

    if (isDBConnected()) {
      const tournament = await Tournament.findById(req.params.id);
      if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
      if (tournament.winner_declared_at) return res.status(400).json({ error: 'Winner already declared for this tournament' });

      if (isSquadTournament(tournament)) {
        if (!squadId) return res.status(400).json({ error: 'Winning squad is required' });
        const winningSquad = (tournament.squads || []).find((squad) => getSquadId(squad) === squadId);
        if (!winningSquad) return res.status(404).json({ error: 'Winning squad not found' });
        const memberIds = (winningSquad.members || []).map((member) => member.toString());
        if (memberIds.length === 0) return res.status(400).json({ error: 'Winning squad has no members' });
        if (memberIds.length < getSquadSize(tournament)) return res.status(400).json({ error: 'Only completed squads can be declared winners' });

        const prizeBreakdown = calculatePrizeBreakdown(tournament);
        const firstPrize = prizeBreakdown.firstPrize;
        if (firstPrize <= 0) return res.status(400).json({ error: 'First prize amount is zero' });
        const rewardPerMember = Math.floor(firstPrize / memberIds.length);
        if (rewardPerMember <= 0) return res.status(400).json({ error: 'Reward per member is zero' });

        const members = await User.find({ _id: { $in: memberIds } });
        await Promise.all(members.map(async (member) => {
          member.walletBalance = (member.walletBalance || 0) + rewardPerMember;
          pushNotification(member, {
            type: 'winner',
            tournamentId: tournament._id.toString(),
            link: `/tournament/${tournament._id}`,
            message: `You won ${tournament.title || tournament.name} with ${winningSquad.name}! Rs.${rewardPerMember} credited to your wallet.`
          });
          await member.save();
          await WalletTransaction.create({
            userId: member._id,
            tournamentId: tournament._id,
            amount: rewardPerMember,
            type: 'reward',
            description: 'Squad Tournament Winning Reward',
            status: 'approved',
            metadata: {
              squadId,
              squadName: winningSquad.name,
              firstPrize,
              totalCollection: prizeBreakdown.totalCollection,
              platformEarnings: prizeBreakdown.platformEarnings
            }
          });
        }));

        tournament.winner = winningSquad.captain || memberIds[0];
        tournament.winner_squad = squadId;
        tournament.winner_squad_name = winningSquad.name;
        tournament.status = 'completed';
        tournament.winner_prize = firstPrize;
        tournament.total_collection = prizeBreakdown.totalCollection;
        tournament.platform_earnings = prizeBreakdown.platformEarnings;
        tournament.reward_per_member = rewardPerMember;
        tournament.winner_declared_at = new Date();
        tournament.finished_at = tournament.finished_at || new Date();
        await tournament.save();

        const joinedUsers = await User.find({ _id: { $in: tournament.currentPlayers || [] } });
        await notifyUsersForTournament(joinedUsers.filter((user) => !memberIds.includes(user._id.toString())), tournament, {
          type: 'winner',
          message: `Winner declared for ${tournament.title}: ${winningSquad.name}`
        });
        const updatedTournament = await getTournamentById(tournament._id);
        return res.json({ message: 'Winning squad declared and rewards credited', tournament: serializeTournament(updatedTournament) });
      }

      if (!firstPlaceUserId || !secondPlaceUserId || !thirdPlaceUserId) {
        return res.status(400).json({ error: '1st, 2nd, and 3rd place winners are required' });
      }
      const winnerIds = [firstPlaceUserId, secondPlaceUserId, thirdPlaceUserId].map(String);
      if (new Set(winnerIds).size !== 3) {
        return res.status(400).json({ error: 'Each winning position must be a different player' });
      }
      const joinedIds = (tournament.currentPlayers || []).map((playerId) => playerId.toString());
      if (!winnerIds.every((winnerId) => joinedIds.includes(winnerId))) {
        return res.status(400).json({ error: 'Winners must be selected from joined users' });
      }
      const prizeBreakdown = calculatePrizeBreakdown(tournament);
      const prizeEntries = [
        { userId: firstPlaceUserId, amount: prizeBreakdown.firstPrize, place: 1 },
        { userId: secondPlaceUserId, amount: prizeBreakdown.secondPrize, place: 2 },
        { userId: thirdPlaceUserId, amount: prizeBreakdown.thirdPrize, place: 3 }
      ];
      const winners = await User.find({ _id: { $in: winnerIds } });
      const winnersById = new Map(winners.map((winner) => [winner._id.toString(), winner]));
      for (const prizeEntry of prizeEntries) {
        const winner = winnersById.get(String(prizeEntry.userId));
        if (!winner) return res.status(404).json({ error: 'Winner not found' });
        winner.walletBalance = (winner.walletBalance || 0) + prizeEntry.amount;
        pushNotification(winner, {
          type: 'winner',
          tournamentId: tournament._id.toString(),
          link: `/tournament/${tournament._id}`,
          message: `You won ${tournament.title || tournament.name}! #${prizeEntry.place} prize Rs.${prizeEntry.amount} credited to your wallet.`
        });
        await winner.save();
        await WalletTransaction.create({
          userId: winner._id,
          tournamentId: tournament._id,
          amount: prizeEntry.amount,
          type: 'reward',
          description: 'Solo Tournament Winning Reward',
          status: 'approved',
          metadata: {
            place: prizeEntry.place,
            rewardPool: prizeBreakdown.rewardPool,
            totalCollection: prizeBreakdown.totalCollection,
            platformEarnings: prizeBreakdown.platformEarnings
          }
        });
      }

      tournament.winner = firstPlaceUserId;
      tournament.second_winner = secondPlaceUserId;
      tournament.third_winner = thirdPlaceUserId;
      tournament.status = 'completed';
      tournament.winner_prize = prizeBreakdown.firstPrize;
      tournament.first_place_prize = prizeBreakdown.firstPrize;
      tournament.second_place_prize = prizeBreakdown.secondPrize;
      tournament.third_place_prize = prizeBreakdown.thirdPrize;
      tournament.total_collection = prizeBreakdown.totalCollection;
      tournament.reward_pool = prizeBreakdown.rewardPool;
      tournament.platform_earnings = prizeBreakdown.platformEarnings;
      tournament.reward_per_member = 0;
      tournament.winner_declared_at = new Date();
      tournament.finished_at = tournament.finished_at || new Date();
      await tournament.save();
      const joinedUsers = await User.find({ _id: { $in: tournament.currentPlayers || [] } });
      await notifyUsersForTournament(joinedUsers.filter((user) => !winnerIds.includes(user._id.toString())), tournament, {
        type: 'winner',
        message: `Winners declared for ${tournament.title}`
      });
      const updatedTournament = await getTournamentById(tournament._id);
      return res.json({ message: 'Solo winners declared and rewards credited', tournament: serializeTournament(updatedTournament) });
    }

    const store = await getStore();
    const tournament = getOfflineTournament(store, req.params.id);
    if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
    if (tournament.winner_declared_at) return res.status(400).json({ error: 'Winner already declared for this tournament' });

    if (isSquadTournament(tournament)) {
      if (!squadId) return res.status(400).json({ error: 'Winning squad is required' });
      const squad = normalizeSquadsForOffline(tournament).find((item) => getSquadId(item) === squadId);
      if (!squad) return res.status(404).json({ error: 'Winning squad not found' });
      const memberIds = (squad.members || []).map(getUserId).filter(Boolean);
      if (memberIds.length === 0) return res.status(400).json({ error: 'Winning squad has no members' });
      if (memberIds.length < getSquadSize(tournament)) return res.status(400).json({ error: 'Only completed squads can be declared winners' });
      const prizeBreakdown = calculatePrizeBreakdown(tournament);
      const rewardPerMember = Math.floor(prizeBreakdown.firstPrize / memberIds.length);
      if (rewardPerMember <= 0) return res.status(400).json({ error: 'Reward per member is zero' });

      for (const memberId of memberIds) {
        const member = getOfflineUser(store, memberId);
        if (!member) continue;
        member.walletBalance = (member.walletBalance || 0) + rewardPerMember;
        pushOfflineNotification(member, {
          type: 'winner',
          tournamentId: tournament._id,
          link: `/tournament/${tournament._id}`,
          message: `You won ${tournament.title || tournament.name} with ${squad.name}! Rs.${rewardPerMember} credited to your wallet.`
        });
        store.walletTransactions = store.walletTransactions || [];
        store.walletTransactions.push({
          _id: `offline_wallet_tx_${store.nextIds.walletTransaction++}`,
          userId: memberId,
          tournamentId: tournament._id,
          amount: rewardPerMember,
          type: 'reward',
          description: 'Squad Tournament Winning Reward',
          status: 'approved',
          metadata: {
            squadId,
            squadName: squad.name,
            firstPrize: prizeBreakdown.firstPrize,
            totalCollection: prizeBreakdown.totalCollection,
            platformEarnings: prizeBreakdown.platformEarnings
          },
          createdAt: new Date().toISOString()
        });
      }

      tournament.winner = getUserId(squad.captain) || memberIds[0];
      tournament.winner_squad = squadId;
      tournament.winner_squad_name = squad.name;
      tournament.status = 'completed';
      tournament.winner_prize = prizeBreakdown.firstPrize;
      tournament.total_collection = prizeBreakdown.totalCollection;
      tournament.platform_earnings = prizeBreakdown.platformEarnings;
      tournament.reward_per_member = rewardPerMember;
      tournament.winner_declared_at = new Date().toISOString();
      tournament.finished_at = tournament.finished_at || new Date().toISOString();
      await persistStore();
      return res.json({ message: 'Winning squad declared and rewards credited', tournament: serializeTournament(hydrateOfflineTournament(store, tournament)) });
    }

    if (!firstPlaceUserId || !secondPlaceUserId || !thirdPlaceUserId) {
      return res.status(400).json({ error: '1st, 2nd, and 3rd place winners are required' });
    }
    const winnerIds = [firstPlaceUserId, secondPlaceUserId, thirdPlaceUserId].map(String);
    if (new Set(winnerIds).size !== 3) return res.status(400).json({ error: 'Each winning position must be a different player' });
    if (!winnerIds.every((winnerId) => isUserInPlayers(tournament.currentPlayers || [], winnerId))) {
      return res.status(400).json({ error: 'Winners must be selected from joined users' });
    }
    const prizeBreakdown = calculatePrizeBreakdown(tournament);
    const prizeEntries = [
      { userId: firstPlaceUserId, amount: prizeBreakdown.firstPrize, place: 1 },
      { userId: secondPlaceUserId, amount: prizeBreakdown.secondPrize, place: 2 },
      { userId: thirdPlaceUserId, amount: prizeBreakdown.thirdPrize, place: 3 }
    ];
    for (const prizeEntry of prizeEntries) {
      const winner = getOfflineUser(store, prizeEntry.userId);
      if (!winner) return res.status(404).json({ error: 'Winner not found' });
      winner.walletBalance = (winner.walletBalance || 0) + prizeEntry.amount;
      pushOfflineNotification(winner, {
        type: 'winner',
        tournamentId: tournament._id,
        link: `/tournament/${tournament._id}`,
        message: `You won ${tournament.title || tournament.name}! #${prizeEntry.place} prize Rs.${prizeEntry.amount} credited to your wallet.`
      });
      store.walletTransactions = store.walletTransactions || [];
      store.walletTransactions.push({
        _id: `offline_wallet_tx_${store.nextIds.walletTransaction++}`,
        userId: prizeEntry.userId,
        tournamentId: tournament._id,
        amount: prizeEntry.amount,
        type: 'reward',
        description: 'Solo Tournament Winning Reward',
        status: 'approved',
        metadata: {
          place: prizeEntry.place,
          rewardPool: prizeBreakdown.rewardPool,
          totalCollection: prizeBreakdown.totalCollection,
          platformEarnings: prizeBreakdown.platformEarnings
        },
        createdAt: new Date().toISOString()
      });
    }
    tournament.winner = firstPlaceUserId;
    tournament.second_winner = secondPlaceUserId;
    tournament.third_winner = thirdPlaceUserId;
    tournament.status = 'completed';
    tournament.winner_prize = prizeBreakdown.firstPrize;
    tournament.first_place_prize = prizeBreakdown.firstPrize;
    tournament.second_place_prize = prizeBreakdown.secondPrize;
    tournament.third_place_prize = prizeBreakdown.thirdPrize;
    tournament.total_collection = prizeBreakdown.totalCollection;
    tournament.reward_pool = prizeBreakdown.rewardPool;
    tournament.platform_earnings = prizeBreakdown.platformEarnings;
    tournament.reward_per_member = 0;
    tournament.winner_declared_at = new Date().toISOString();
    tournament.finished_at = tournament.finished_at || new Date().toISOString();
    for (const playerId of tournament.currentPlayers || []) {
      const joinedUserId = getUserId(playerId);
      if (winnerIds.includes(joinedUserId)) continue;
      const joinedUser = getOfflineUser(store, joinedUserId);
      if (!joinedUser) continue;
      pushOfflineNotification(joinedUser, {
        type: 'winner',
        tournamentId: tournament._id,
        link: `/tournament/${tournament._id}`,
        message: `Winners declared for ${tournament.title}`
      });
    }
    await persistStore();
    return res.json({ message: 'Solo winners declared and rewards credited', tournament: serializeTournament(hydrateOfflineTournament(store, tournament)) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/:id/room-details', async (req, res) => {
  try {
    const roomId = req.body.room_id ?? req.body.roomId ?? '';
    const roomPassword = req.body.room_password ?? req.body.roomPassword ?? '';

    if (!roomId || !roomPassword) {
      return res.status(400).json({ error: 'Room ID and password are required' });
    }

    if (isDBConnected()) {
      const tournament = await Tournament.findById(req.params.id);
      if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
      tournament.room_id = roomId;
      tournament.room_password = roomPassword;
      tournament.room_details_set_at = new Date();
      await tournament.save();
      const joinedUsers = await User.find({ _id: { $in: tournament.currentPlayers || [] } });
      await notifyUsersForTournament(joinedUsers, tournament, {
        type: 'tournament',
        message: `Room ID and password are now available for ${tournament.title}`
      });
      const updatedTournament = await getTournamentById(tournament._id);
      return res.json({ message: 'Room details updated', tournament: serializeTournament(updatedTournament) });
    }

    const store = await getStore();
    const tournament = getOfflineTournament(store, req.params.id);
    if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
    tournament.room_id = roomId;
    tournament.room_password = roomPassword;
    tournament.room_details_set_at = new Date().toISOString();
    for (const playerId of tournament.currentPlayers || []) {
      const joinedUser = getOfflineUser(store, getUserId(playerId));
      if (!joinedUser) continue;
      pushOfflineNotification(joinedUser, {
        type: 'tournament',
        tournamentId: tournament._id,
        link: `/tournament/${tournament._id}`,
        message: `Room ID and password are now available for ${tournament.title}`
      });
    }
    await persistStore();
    return res.json({ message: 'Room details updated', tournament: serializeTournament(tournament) });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/:id/finish', async (req, res) => {
  try {
    if (isDBConnected()) {
      const tournament = await Tournament.findById(req.params.id);
      if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
      tournament.status = 'completed';
      tournament.finished_at = new Date();
      await tournament.save();
      const updatedTournament = await getTournamentById(tournament._id);
      return res.json({ message: 'Tournament finished', tournament: serializeTournament(updatedTournament) });
    }

    const store = await getStore();
    const tournament = getOfflineTournament(store, req.params.id);
    if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
    tournament.status = 'completed';
    tournament.finished_at = new Date().toISOString();
    await persistStore();
    return res.json({ message: 'Tournament finished', tournament: serializeTournament(tournament) });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/:id/dismiss', async (req, res) => {
  try {
    if (isDBConnected()) {
      const tournament = await Tournament.findById(req.params.id);
      if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
      tournament.status = 'dismissed';
      tournament.dismissed_at = new Date();
      await tournament.save();
      const updatedTournament = await getTournamentById(tournament._id);
      return res.json({ message: 'Tournament dismissed', tournament: serializeTournament(updatedTournament) });
    }

    const store = await getStore();
    const tournament = getOfflineTournament(store, req.params.id);
    if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
    tournament.status = 'dismissed';
    tournament.dismissed_at = new Date().toISOString();
    await persistStore();
    return res.json({ message: 'Tournament dismissed', tournament: serializeTournament(hydrateOfflineTournament(store, tournament)) });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/:id/refund', async (req, res) => {
  try {
    if (isDBConnected()) {
      const tournament = await Tournament.findById(req.params.id);
      if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
      if (tournament.refund_processed) return res.status(400).json({ error: 'Refund already processed for this tournament' });

      const squadMatch = isSquadTournament(tournament);
      const refundTargets = squadMatch
        ? (tournament.squads || []).map((squad) => ({
          userId: getUserId(squad.captain),
          amount: Number(squad.total_entry_fee || getSquadEntryFee(tournament))
        })).filter((item) => item.userId && item.amount > 0)
        : (tournament.currentPlayers || []).map((playerId) => ({
          userId: playerId.toString(),
          amount: Number(tournament.entry_fee || 0)
        })).filter((item) => item.userId && item.amount > 0);

      if (refundTargets.length > 0) {
        const users = await User.find({ _id: { $in: refundTargets.map((item) => item.userId) } });
        const refundByUserId = new Map(refundTargets.map((item) => [item.userId, item.amount]));
        await Promise.all(users.map(async (user) => {
          const refundAmount = refundByUserId.get(user._id.toString()) || 0;
          user.walletBalance = (user.walletBalance || 0) + refundAmount;
          user.notifications.push({
            message: `${squadMatch ? 'Squad captain refund' : 'Tournament refund'} added Rs.${refundAmount} for ${tournament.title || tournament.name || 'dismissed match'}`,
            type: 'wallet',
            link: '/wallet',
            read: false,
            createdAt: new Date()
          });
          return user.save();
        }));

        await Refund.insertMany(users.map((user) => ({
          userId: user._id,
          tournamentId: tournament._id,
          amount: refundByUserId.get(user._id.toString()) || 0,
          reason: buildRefundMessage(tournament),
          status: 'approved'
        })));
      }

      tournament.status = 'dismissed';
      tournament.dismissed_at = tournament.dismissed_at || new Date();
      tournament.refund_processed = true;
      tournament.refundProcessed = true;
      tournament.refunded_at = new Date();
      await tournament.save();
      const updatedTournament = await getTournamentById(tournament._id);
      return res.json({ message: squadMatch ? 'Squad captain refunds processed' : 'All joined users refunded', tournament: serializeTournament(updatedTournament) });
    }

    const store = await getStore();
    const tournament = getOfflineTournament(store, req.params.id);
    if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
    if (tournament.refund_processed) return res.status(400).json({ error: 'Refund already processed for this tournament' });

    const squadMatch = isSquadTournament(tournament);
    const refundTargets = squadMatch
      ? normalizeSquadsForOffline(tournament).map((squad) => ({
        userId: getUserId(squad.captain),
        amount: Number(squad.total_entry_fee || getSquadEntryFee(tournament))
      })).filter((item) => item.userId && item.amount > 0)
      : (tournament.currentPlayers || []).map((playerId) => ({
        userId: getUserId(playerId),
        amount: Number(tournament.entry_fee || 0)
      })).filter((item) => item.userId && item.amount > 0);

    for (const refundTarget of refundTargets) {
      const user = getOfflineUser(store, refundTarget.userId);
      if (!user) continue;
      user.walletBalance = (user.walletBalance || 0) + refundTarget.amount;
      user.notifications = user.notifications || [];
      user.notifications.push({
        _id: `offline_note_${Date.now()}_${refundTarget.userId}`,
        message: `${squadMatch ? 'Squad captain refund' : 'Tournament refund'} added Rs.${refundTarget.amount} for ${tournament.title || tournament.name || 'dismissed match'}`,
        read: false,
        createdAt: new Date().toISOString()
      });
      store.refunds = store.refunds || [];
      store.refunds.push({
        _id: `offline_ref_${store.nextIds.refund++}`,
        userId: refundTarget.userId,
        tournamentId: tournament._id,
        amount: refundTarget.amount,
        reason: buildRefundMessage(tournament),
        status: 'approved',
        createdAt: new Date().toISOString()
      });
    }

    tournament.status = 'dismissed';
    tournament.dismissed_at = tournament.dismissed_at || new Date().toISOString();
    tournament.refund_processed = true;
    tournament.refundProcessed = true;
    tournament.refunded_at = new Date().toISOString();
    await persistStore();
    return res.json({ message: squadMatch ? 'Squad captain refunds processed' : 'All joined users refunded', tournament: serializeTournament(hydrateOfflineTournament(store, tournament)) });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

export default router;
