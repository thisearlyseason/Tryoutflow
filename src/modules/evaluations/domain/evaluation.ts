import type { Clock } from '../../../lib/clock';
import { failure, success, type AppResult } from '../../../lib/result';

export type EvaluationState = 'draft' | 'completed' | 'locked' | 'reopened';

export type EvaluationCategory = {
  id: string;
  required: boolean;
  scaleMin: 1;
  scaleMax: 5 | 10;
};

export type EvaluationScore = { categoryId: string; value: number };

export type EvaluationDraft = {
  id: string;
  state: EvaluationState;
  version: number;
  categories: readonly EvaluationCategory[];
  scores: readonly EvaluationScore[];
};

export type CompletionError = {
  code: 'required_scores_missing' | 'invalid_score' | 'evaluation_locked';
};

export function validateEvaluationScores(draft: EvaluationDraft): AppResult<true, CompletionError> {
  if (draft.state === 'completed' || draft.state === 'locked') {
    return failure({ code: 'evaluation_locked' });
  }
  const categories = new Map(draft.categories.map((category) => [category.id, category]));
  const seen = new Set<string>();
  for (const score of draft.scores) {
    const category = categories.get(score.categoryId);
    if (
      !category ||
      seen.has(score.categoryId) ||
      !Number.isSafeInteger(score.value) ||
      score.value < category.scaleMin ||
      score.value > category.scaleMax
    ) {
      return failure({ code: 'invalid_score' });
    }
    seen.add(score.categoryId);
  }
  if (draft.categories.some((category) => category.required && !seen.has(category.id))) {
    return failure({ code: 'required_scores_missing' });
  }
  return success(true);
}

export function completeEvaluation(
  draft: EvaluationDraft,
  clock: Clock,
): AppResult<{ state: 'completed'; version: number; completedAt: string }, CompletionError> {
  const valid = validateEvaluationScores(draft);
  if (!valid.ok) return valid;
  return success({
    state: 'completed',
    version: draft.version + 1,
    completedAt: clock.now().toISOString(),
  });
}
