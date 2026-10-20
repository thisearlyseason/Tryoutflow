import {
  calculateEvaluatorTotal,
  type RubricScoringCategory,
} from '../../scoring/domain/evaluator-total';
import type { ProfileScore } from './athlete-profile';

/** The profile delegates to the same exact weighted scorer as rankings. */
export function profileTotal(
  categories: readonly { id: string; scaleMax: 5 | 10; weight?: string }[],
  scores: readonly ProfileScore[],
): string | null {
  if (!categories.length || categories.some((category) => category.weight === undefined))
    return null;
  try {
    return calculateEvaluatorTotal({
      categories: categories.map((category): RubricScoringCategory => ({
        categoryId: category.id,
        scaleMax: category.scaleMax,
        weight: category.weight!,
      })),
      scores: scores.map((score) => ({ categoryId: score.categoryId, score: score.value })),
    });
  } catch {
    // Recovery can expose invalid local data. Never alter that data or interrupt
    // the form's validation and recovery flow to produce a prettier chart.
    return null;
  }
}
