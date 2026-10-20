export const REPORT_COUNT_CAP = 10_000;
export const REPORT_COUNT_OVERFLOW_SENTINEL = REPORT_COUNT_CAP + 1;

export const evaluationLifecycleCountFields = [
  'completedCount',
  'lockedCount',
  'reopenedCount',
  'draftCount',
  'invalidCount',
  'scoredEvaluatorCount',
] as const;

type EvaluationCounts = Record<(typeof evaluationLifecycleCountFields)[number], number>;

export function exceedsReportCountCap(counts: EvaluationCounts): boolean {
  return evaluationLifecycleCountFields.some((field) => counts[field] > REPORT_COUNT_CAP);
}
