import {
  assertBoundedCollection,
  assertOpaqueId,
  MAX_ATHLETE_COUNT,
  parseCanonicalScore,
  type CanonicalScore,
} from './decimal';

export type RankableScoreSummary = Readonly<{
  aggregate: CanonicalScore | null;
  priorityCategoryId: string | null;
  priorityCategoryAggregate: CanonicalScore | null;
}>;
export type RankableAthlete = Readonly<{
  athleteId: string;
  /** Explicit presentation-only ordering key. It never changes numerical rank. */
  stableOrder: string;
  summary: RankableScoreSummary;
}>;
export type RankedAthlete = RankableAthlete & Readonly<{ rank: number | null; isTied: boolean }>;

function rankingComparison(left: RankableAthlete, right: RankableAthlete): number {
  if (left.summary.aggregate === null || right.summary.aggregate === null) {
    if (left.summary.aggregate === null && right.summary.aggregate === null) return 0;
    return left.summary.aggregate === null ? 1 : -1;
  }
  const aggregate = parseCanonicalScore(right.summary.aggregate).comparedTo(
    parseCanonicalScore(left.summary.aggregate),
  );
  if (aggregate !== 0) return aggregate;
  const leftPriority = left.summary.priorityCategoryAggregate;
  const rightPriority = right.summary.priorityCategoryAggregate;
  if (leftPriority === null || rightPriority === null) {
    if (leftPriority === null && rightPriority === null) return 0;
    return leftPriority === null ? 1 : -1;
  }
  return parseCanonicalScore(rightPriority).comparedTo(parseCanonicalScore(leftPriority));
}

function sameRankKey(left: RankableAthlete, right: RankableAthlete): boolean {
  return rankingComparison(left, right) === 0;
}

function stableTechnicalComparison(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function projectRankedAthlete(
  athlete: RankableAthlete,
  rank: number | null,
  isTied: boolean,
): RankedAthlete {
  return {
    athleteId: athlete.athleteId,
    stableOrder: athlete.stableOrder,
    summary: {
      aggregate: athlete.summary.aggregate,
      priorityCategoryId: athlete.summary.priorityCategoryId,
      priorityCategoryAggregate: athlete.summary.priorityCategoryAggregate,
    },
    rank,
    isTied,
  };
}

export function rankAthletes(athletes: readonly RankableAthlete[]): RankedAthlete[] {
  assertBoundedCollection(athletes.length, MAX_ATHLETE_COUNT, 'athlete', true);
  const athleteIds = new Set<string>();
  const stableOrders = new Set<string>();
  let scoredPriorityCategoryId: string | null | undefined;
  for (const athlete of athletes) {
    assertOpaqueId(athlete.athleteId, 'athleteId');
    assertOpaqueId(athlete.stableOrder, 'stableOrder');
    if (athleteIds.has(athlete.athleteId)) throw new RangeError('duplicate athleteId');
    if (stableOrders.has(athlete.stableOrder)) throw new RangeError('duplicate stableOrder');
    athleteIds.add(athlete.athleteId);
    stableOrders.add(athlete.stableOrder);
    if (athlete.summary.aggregate !== null)
      parseCanonicalScore(athlete.summary.aggregate, 'aggregate');
    const priorityCategoryId = athlete.summary.priorityCategoryId;
    const priorityCategoryAggregate = athlete.summary.priorityCategoryAggregate;
    if (priorityCategoryId !== null) assertOpaqueId(priorityCategoryId, 'priority categoryId');
    if ((priorityCategoryId === null) !== (priorityCategoryAggregate === null)) {
      throw new RangeError('priority category identity and aggregate must be supplied together');
    }
    if (priorityCategoryAggregate !== null) {
      parseCanonicalScore(priorityCategoryAggregate, 'priority aggregate');
      if (athlete.summary.aggregate === null) {
        throw new RangeError('priority aggregate cannot exist without an overall aggregate');
      }
    }
    if (athlete.summary.aggregate === null && priorityCategoryId !== null) {
      throw new RangeError('unscored rows cannot carry priority evidence');
    }
    if (athlete.summary.aggregate !== null) {
      if (
        scoredPriorityCategoryId !== undefined &&
        scoredPriorityCategoryId !== priorityCategoryId
      ) {
        throw new RangeError('priority category configuration must be consistent for scored rows');
      }
      scoredPriorityCategoryId = priorityCategoryId;
    }
  }
  const ordered = [...athletes].sort((left, right) => {
    const ranked = rankingComparison(left, right);
    return ranked === 0 ? stableTechnicalComparison(left.stableOrder, right.stableOrder) : ranked;
  });
  let currentCompetitionRank = 0;
  return ordered.map((athlete, index) => {
    if (athlete.summary.aggregate === null) return projectRankedAthlete(athlete, null, false);
    const previous = index > 0 ? ordered[index - 1]! : null;
    const next = index + 1 < ordered.length ? ordered[index + 1]! : null;
    const tiedWithPrevious = previous !== null && sameRankKey(previous, athlete);
    const tiedWithNext = next !== null && sameRankKey(athlete, next);
    if (!tiedWithPrevious) currentCompetitionRank = index + 1;
    return projectRankedAthlete(athlete, currentCompetitionRank, tiedWithPrevious || tiedWithNext);
  });
}
