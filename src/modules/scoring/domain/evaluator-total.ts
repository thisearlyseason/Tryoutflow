import {
  assertBoundedCollection,
  assertOpaqueId,
  canonicalizeScore,
  MAX_CATEGORY_COUNT,
  parseBoundedDecimal,
  ScoreDecimal,
  type CanonicalScore,
} from './decimal';
import { exactNormalizedScore } from './normalize-score';

export type WeightedCategoryScore = Readonly<{
  categoryId: string;
  score: number | null;
  scaleMax: number;
  weight: string;
  required: boolean;
  isPriority?: boolean;
}>;

export type RubricScoringCategory = Readonly<Omit<WeightedCategoryScore, 'score'>>;
export type EvaluatorScoreValue = Readonly<{ categoryId: string; score: number }>;
export type EvaluatorTotalSnapshot = Readonly<{
  categories: readonly RubricScoringCategory[];
  scores: readonly EvaluatorScoreValue[];
}>;

function bindSnapshotScores(snapshot: EvaluatorTotalSnapshot): readonly WeightedCategoryScore[] {
  if (!Array.isArray(snapshot.categories) || !Array.isArray(snapshot.scores)) {
    throw new TypeError('evaluation snapshot categories and scores must be arrays');
  }
  assertBoundedCollection(snapshot.categories.length, MAX_CATEGORY_COUNT, 'rubric category');
  assertBoundedCollection(snapshot.scores.length, MAX_CATEGORY_COUNT, 'evaluation score', true);
  const categoryIds = new Set<string>();
  for (const category of snapshot.categories) {
    assertOpaqueId(category.categoryId, 'categoryId');
    if (categoryIds.has(category.categoryId)) throw new RangeError('duplicate rubric categoryId');
    categoryIds.add(category.categoryId);
  }
  const scores = new Map<string, number>();
  for (const score of snapshot.scores) {
    assertOpaqueId(score.categoryId, 'score categoryId');
    if (!categoryIds.has(score.categoryId)) throw new RangeError('unknown score categoryId');
    if (scores.has(score.categoryId)) throw new RangeError('duplicate score categoryId');
    scores.set(score.categoryId, score.score);
  }
  return snapshot.categories.map((category) => ({
    ...category,
    score: scores.has(category.categoryId) ? scores.get(category.categoryId)! : null,
  }));
}

export function calculateEvaluatorTotal(
  input: readonly WeightedCategoryScore[] | EvaluatorTotalSnapshot,
): CanonicalScore | null {
  const categories = Array.isArray(input)
    ? (input as readonly WeightedCategoryScore[])
    : bindSnapshotScores(input as EvaluatorTotalSnapshot);
  assertBoundedCollection(categories.length, MAX_CATEGORY_COUNT, 'rubric category');
  const categoryIds = new Set<string>();
  let configuredWeight = new ScoreDecimal(0);
  let completedWeight = new ScoreDecimal(0);
  let weightedNormalizedTotal = new ScoreDecimal(0);
  let requiredScoreMissing = false;

  for (const category of categories) {
    assertOpaqueId(category.categoryId, 'categoryId');
    if (categoryIds.has(category.categoryId)) throw new RangeError('duplicate categoryId');
    categoryIds.add(category.categoryId);
    if (typeof category.required !== 'boolean') throw new TypeError('required must be boolean');
    if (category.isPriority !== undefined && typeof category.isPriority !== 'boolean') {
      throw new TypeError('isPriority must be boolean');
    }
    const weight = parseBoundedDecimal(category.weight, 'category weight');
    if (!weight.greaterThan(0) || weight.greaterThan(100)) {
      throw new RangeError('category weight must be greater than zero and at most one hundred');
    }
    configuredWeight = configuredWeight.plus(weight);
    if (category.score === null) {
      exactNormalizedScore({ score: 1, scaleMax: category.scaleMax });
      if (category.required) requiredScoreMissing = true;
      continue;
    }
    const normalized = exactNormalizedScore({ score: category.score, scaleMax: category.scaleMax });
    completedWeight = completedWeight.plus(weight);
    weightedNormalizedTotal = weightedNormalizedTotal.plus(normalized.times(weight));
  }

  if (!configuredWeight.equals(100))
    throw new RangeError('category weights must total exactly 100');
  if (requiredScoreMissing) return null;
  if (completedWeight.isZero()) return null;
  return canonicalizeScore(weightedNormalizedTotal.dividedBy(completedWeight));
}
