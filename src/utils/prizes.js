export const isSquadTournament = (tournament) => (
  (tournament?.match_type || tournament?.matchType) === 'squad'
);

export const getJoinedCount = (tournament) => Number(
  Array.isArray(tournament?.currentPlayers)
    ? tournament.currentPlayers.length
    : tournament?.joined_count
  ?? tournament?.joinedCount
  ?? 0
);

export const getTotalCollection = (tournament) => {
  const entryFee = Number(tournament?.entry_fee ?? tournament?.entryFee ?? 0);
  const squadMatch = isSquadTournament(tournament);
  if (!squadMatch) {
    return entryFee * getJoinedCount(tournament);
  }

  const squadSize = Number(tournament?.squad_size ?? tournament?.squadSize ?? 4);
  const squads = Array.isArray(tournament?.squads) ? tournament.squads : [];
  return squads.reduce((sum, squad) => (
    sum + Number(squad?.total_entry_fee ?? squad?.totalEntryFee ?? entryFee * squadSize)
  ), 0);
};

export const calculatePrizeBreakdown = (tournament) => {
  const entryFee = Number(tournament?.entry_fee ?? tournament?.entryFee ?? 0);
  const joinedCount = getJoinedCount(tournament);
  const totalCollection = getTotalCollection(tournament);
  const basePrize = Number(tournament?.base_prize ?? tournament?.basePrize ?? tournament?.prizePool ?? 0);
  const totalPrizePool = basePrize + totalCollection;
  const squadMatch = isSquadTournament(tournament);
  const soloMatch = !squadMatch;
  const firstPrizePercentage = Math.min(100, Math.max(1, Number(
    tournament?.first_prize_percentage
    ?? tournament?.firstPrizePercentage
    ?? tournament?.prize_percentage
    ?? tournament?.prizePercentage
    ?? 50
  )));
  const soloFirstPercentage = Number(tournament?.solo_first_place_percentage ?? tournament?.soloFirstPlacePercentage ?? 60);
  const soloSecondPercentage = Number(tournament?.solo_second_place_percentage ?? tournament?.soloSecondPlacePercentage ?? 30);
  const soloThirdPercentage = Number(tournament?.solo_third_place_percentage ?? tournament?.soloThirdPlacePercentage ?? 10);
  const prizePool = totalPrizePool;
  const rewardPool = soloMatch ? Math.floor(totalPrizePool * 0.5) : Math.floor((totalPrizePool * firstPrizePercentage) / 100);
  const firstPrize = soloMatch ? Math.floor((rewardPool * soloFirstPercentage) / 100) : rewardPool;
  const secondPrize = soloMatch ? Math.floor((rewardPool * soloSecondPercentage) / 100) : 0;
  const thirdPrize = soloMatch ? Math.max(0, rewardPool - firstPrize - secondPrize) : 0;
  const platformEarnings = Math.max(0, totalPrizePool - rewardPool);

  return {
    totalCollection,
    basePrize,
    prizePool,
    rewardPool,
    firstPrize,
    secondPrize,
    thirdPrize,
    firstPrizePercentage,
    soloFirstPercentage,
    soloSecondPercentage,
    soloThirdPercentage,
    soloTotalPercentage: soloFirstPercentage + soloSecondPercentage + soloThirdPercentage,
    platformEarnings,
    joinedCount,
    entryFee,
    squadSize: Number(tournament?.squad_size ?? tournament?.squadSize ?? (squadMatch ? 4 : 1))
  };
};
