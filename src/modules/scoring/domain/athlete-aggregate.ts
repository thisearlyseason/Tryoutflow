import type Decimal from 'decimal.js';

import {
  assertBoundedCollection,
  assertOpaqueId,
  canonicalizeScore,
  MAX_EVALUATION_COUNT,
  parseCanonicalScore,
  ScoreDecimal,
  type CanonicalScore,
} from './decimal';
import { calculateEvaluatorTotal, type WeightedCategoryScore } from './evaluator-total';
import { exactNormalizedScore } from './normalize-score';

export type ScoringEvaluationState = 'draft' | 'completed' | 'locked' | 'reopened';
export type ScoringAssignmentState = 'active' | 'removed' | 'revoked' | 'invalidated';
export type CompletedEvaluationSnapshot = Readonly<{
  evaluationId: string;
  evaluatorId: string;
  divisionId: string;
  sessionId: string;
  state: ScoringEvaluationState;
  assignmentState: ScoringAssignmentState;
  categories: readonly WeightedCategoryScore[];
}>;
export type ScoreFilters = Readonly<{ divisionId?: string; sessionId?: string }>;
export type ScoreSummary = Readonly<{
  aggregate: CanonicalScore | null;
  completedEvaluatorCount: number;
  scoreRange: readonly [CanonicalScore, CanonicalScore] | null;
  priorityCategoryId: string | null;
  priorityCategoryAggregate: CanonicalScore | null;
}>;

export function calculateAthleteAggregate(
  completedEvaluatorTotals: readonly string[],
): CanonicalScore | null {
  assertBoundedCollection(
    completedEvaluatorTotals.length,
    MAX_EVALUATION_COUNT,
    'completed evaluator total',
    true,
  );
  if (completedEvaluatorTotals.length === 0) return null;
  const total = completedEvaluatorTotals.reduce(
    (sum, value, index) => sum.plus(parseCanonicalScore(value, `evaluator total ${index}`)),
    new ScoreDecimal(0),
  );
  return canonicalizeScore(total.dividedBy(completedEvaluatorTotals.length));
}

function validateSnapshotIdentity(snapshot: CompletedEvaluationSnapshot): void {
  assertOpaqueId(snapshot.evaluationId, 'evaluationId');
  assertOpaqueId(snapshot.evaluatorId, 'evaluatorId');
  assertOpaqueId(snapshot.divisionId, 'divisionId');
  assertOpaqueId(snapshot.sessionId, 'sessionId');
  if (!['draft', 'completed', 'locked', 'reopened'].includes(snapshot.state)) {
    throw new RangeError('unknown evaluation state');
  }
  if (!['active', 'removed', 'revoked', 'invalidated'].includes(snapshot.assignmentState)) {
    throw new RangeError('unknown assignment state');
  }
}

export function summarizeAthleteScores(
  evaluations: readonly CompletedEvaluationSnapshot[],
  filters: ScoreFilters = {},
): ScoreSummary {
  assertBoundedCollection(evaluations.length, MAX_EVALUATION_COUNT, 'evaluation', true);
  if (filters.divisionId !== undefined) assertOpaqueId(filters.divisionId, 'division filter');
  if (filters.sessionId !== undefined) assertOpaqueId(filters.sessionId, 'session filter');
  const evaluationIds = new Set<string>();
  for (const evaluation of evaluations) {
    validateSnapshotIdentity(evaluation);
    if (evaluationIds.has(evaluation.evaluationId)) throw new RangeError('duplicate evaluationId');
    evaluationIds.add(evaluation.evaluationId);
  }

  const included = evaluations.filter(
    (evaluation) =>
      evaluation.assignmentState === 'active' &&
      (evaluation.state === 'completed' || evaluation.state === 'locked') &&
      (filters.divisionId === undefined || evaluation.divisionId === filters.divisionId) &&
      (filters.sessionId === undefined || evaluation.sessionId === filters.sessionId),
  );
  const totals: CanonicalScore[] = [];
  const priorityScores: Decimal[] = [];
  let configuredPriorityCategoryId: string | null | undefined;

  for (const evaluation of included) {
    const priorities = evaluation.categories.filter((category) => category.isPriority === true);
    if (priorities.length > 1) throw new RangeError('only one priority category may be configured');
    const configuredPriorityId = priorities.length === 1 ? priorities[0]!.categoryId : null;
    if (
      configuredPriorityCategoryId !== undefined &&
      configuredPriorityCategoryId !== configuredPriorityId
    ) {
      throw new RangeError('priority category must be consistent across evaluation snapshots');
    }
    configuredPriorityCategoryId = configuredPriorityId;
    const total = calculateEvaluatorTotal(evaluation.categories);
    if (total === null) continue;
    if (priorities.length === 1) {
      const priority = priorities[0]!;
      if (priority.score === null)
        throw new RangeError('completed evaluation is missing its priority score');
      priorityScores.push(
        exactNormalizedScore({ score: priority.score, scaleMax: priority.scaleMax }),
      );
    }
    totals.push(total);
  }

  const aggregate = calculateAthleteAggregate(totals);
  let scoreRange: ScoreSummary['scoreRange'] = null;
  if (totals.length > 0) {
    const ordered = totals
      .map((value) => parseCanonicalScore(value))
      .sort((left, right) => left.comparedTo(right));
    scoreRange = [canonicalizeScore(ordered[0]!), canonicalizeScore(ordered[ordered.length - 1]!)];
  }
  const priorityCategoryAggregate =
    priorityScores.length === 0
      ? null
      : canonicalizeScore(
          priorityScores
            .reduce((sum, score) => sum.plus(score), new ScoreDecimal(0))
            .dividedBy(priorityScores.length),
        );
  const priorityCategoryId =
    priorityCategoryAggregate === null ? null : (configuredPriorityCategoryId ?? null);
  return {
    aggregate,
    completedEvaluatorCount: totals.length,
    scoreRange,
    priorityCategoryId,
    priorityCategoryAggregate,
  };
}
