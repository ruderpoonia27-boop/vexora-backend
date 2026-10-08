// Strips what a non-admin viewer must not see from tournament API responses:
// other players' emails and balances, room credentials unless they joined, and squad invite codes
// unless they are in that squad.

const PRIVATE_KEYS = new Set(['email', 'walletBalance', 'wallet_balance', 'squad_password', 'squadPassword']);
const ROOM_KEYS = ['room_id', 'roomId', 'room_password', 'roomPassword'];
const SQUAD_CODE_KEYS = ['squad_code', 'squadCode', 'inviteCode'];

const idOf = (value) => String(value?._id ?? value?.id ?? value ?? '');

const isTournament = (value) => value && typeof value === 'object' && 'room_password' in value && Array.isArray(value.currentPlayers);

const scrubTournament = (tournament, viewerId) => {
  const players = (tournament.currentPlayers || []).map(idOf);
  const squads = Array.isArray(tournament.squads) ? tournament.squads : [];
  const inSquad = (squad) => [squad.captain, squad.captainId, ...(squad.members || [])].some((member) => idOf(member) === viewerId);
  const joined = Boolean(viewerId) && (players.includes(viewerId) || squads.some(inSquad));

  const result = { ...tournament };
  if (!joined) {
    for (const key of ROOM_KEYS) {
      if (key in result) result[key] = '';
    }
  }
  if (squads.length) {
    result.squads = squads.map((squad) => {
      if (viewerId && inSquad(squad)) return squad;
      const copy = { ...squad };
      for (const key of SQUAD_CODE_KEYS) {
        if (key in copy) copy[key] = '';
      }
      return copy;
    });
  }
  return result;
};

const scrub = (value, viewerId) => {
  if (Array.isArray(value)) return value.map((item) => scrub(item, viewerId));
  // Leave class instances (ObjectId, Date, Buffer) alone; only plain data objects are scrubbed.
  const proto = value && typeof value === 'object' ? Object.getPrototypeOf(value) : undefined;
  if (proto !== Object.prototype && proto !== null) return value;

  const source = isTournament(value) ? scrubTournament(value, viewerId) : value;
  const result = {};
  for (const [key, child] of Object.entries(source)) {
    if (PRIVATE_KEYS.has(key)) continue;
    result[key] = scrub(child, viewerId);
  }
  return result;
};

// Express middleware: wraps res.json for non-admin requests (run after optionalAuth).
export const hideTournamentPrivateData = (req, res, next) => {
  if (req.user?.isAdmin) return next();
  const viewerId = req.user ? idOf(req.user) : '';
  const json = res.json.bind(res);
  res.json = (body) => json(scrub(body, viewerId));
  return next();
};
