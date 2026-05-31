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
  const entryType = tournament?.entry_type || tournament?.entryType || (entryFee > 0 ? 'paid' : 'free');
  const distributionType = tournament?.prize_distribution_type || tournament?.prizeDistributionType || (entryType === 'free' ? 'fixed' : 'percentage');
  const configuredDistribution = Array.isArray(tournament?.prize_distribution || tournament?.prizeDistribution)
    ? (tournament.prize_distribution || tournament.prizeDistribution)
    : [];
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
  const legacyDistribution = soloMatch
    ? [
      { place: 1, label: '1st Prize', percentage: soloFirstPercentage, amount: 0 },
      { place: 2, label: '2nd Prize', percentage: soloSecondPercentage, amount: 0 },
      { place: 3, label: '3rd Prize', percentage: soloThirdPercentage, amount: 0 }
    ]
    : [{ place: 1, label: 'Winning Squad', percentage: firstPrizePercentage, amount: 0 }];
  const sourceDistribution = configuredDistribution.length ? configuredDistribution : legacyDistribution;
  const percentageRewardBase = entryType === 'paid' && distributionType === 'percentage'
    ? Math.floor(totalPrizePool * 0.5)
    : totalPrizePool;
  const prizeEntries = sourceDistribution.map((item, index) => {
    const place = Number(item.place || index + 1);
    const percentage = Number(item.percentage || 0);
    const fixedAmount = Number(item.amount || 0);
    const amount = distributionType === 'fixed'
      ? Math.max(0, Math.floor(fixedAmount))
      : Math.max(0, Math.floor((percentageRewardBase * percentage) / 100));
    return {
      place,
      label: item.label || `${place}${place === 1 ? 'st' : place === 2 ? 'nd' : place === 3 ? 'rd' : 'th'} Prize`,
      percentage,
      amount
    };
  }).filter((item) => item.amount > 0 || distributionType === 'percentage');
  const prizePool = distributionType === 'fixed'
    ? prizeEntries.reduce((sum, item) => sum + item.amount, 0)
    : totalPrizePool;
  const rewardPool = prizeEntries.reduce((sum, item) => sum + item.amount, 0);
  const firstPrize = prizeEntries[0]?.amount || 0;
  const secondPrize = prizeEntries[1]?.amount || 0;
  const thirdPrize = prizeEntries[2]?.amount || 0;
  const platformEarnings = Math.max(0, totalPrizePool - rewardPool);

  return {
    entryType,
    distributionType,
    prizeEntries,
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
