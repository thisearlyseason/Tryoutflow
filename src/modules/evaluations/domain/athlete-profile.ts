/** Visualization only: never used to persist scores or calculate ranking totals. */
export type ProfileScale = { min: number; max: number };
export type ProfileCriterion = {
  id: string;
  name: string;
  scaleMin?: number;
  scaleMax?: number;
};
export type ProfileScore = { categoryId: string; value: number };
export type ProfileAverage = {
  scores: (ProfileScore & { count: number })[];
  evaluationCount: number;
};

export function profileRows(
  criteria: readonly ProfileCriterion[],
  scores: readonly ProfileScore[],
  comparisonScores?: readonly ProfileScore[],
  scale?: ProfileScale,
) {
  const values = new Map(scores.map((score) => [score.categoryId, score.value]));
  const comparison = new Map(comparisonScores?.map((score) => [score.categoryId, score.value]));
  return criteria.map((criterion, index) => {
    const min = criterion.scaleMin ?? scale?.min ?? 1;
    const max = criterion.scaleMax ?? scale?.max ?? 10;
    const valid = (value: number | undefined) =>
      value !== undefined &&
      Number.isFinite(value) &&
      max > 0 &&
      min >= 0 &&
      min < max &&
      value >= min &&
      value <= max
        ? value
        : null;
    const value = valid(values.get(criterion.id));
    const comparisonValue = valid(comparison.get(criterion.id));
    return {
      ...criterion,
      index: index + 1,
      min,
      max,
      value,
      comparisonValue,
      // Matches the existing score / scaleMax convention, including 1–5 and 1–10.
      normalized: value === null ? null : (value / max) * 100,
      comparisonNormalized: comparisonValue === null ? null : (comparisonValue / max) * 100,
    };
  });
}

export function formatProfileScore(value: number | null, max: number): string {
  return value === null ? 'Not scored' : `${Number(value.toFixed(2))} / ${max}`;
}
