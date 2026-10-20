import Link from 'next/link';
import type { LiveDashboard } from '../../tryouts/application/get-live-dashboard';

/** Snapshot differences are explicitly counts of records, never absence/skipping judgments. */
export function EventActionSummary({
  dashboard,
  base,
}: {
  dashboard: LiveDashboard;
  base: string;
}) {
  const outstanding = Math.max(0, dashboard.expectedEvaluations - dashboard.completedEvaluations);
  return (
    <section aria-label="Event actions" className="workflow-launches">
      <Link href={`${base}/check-in`} prefetch={false}>
        <strong>Check in players →</strong>
        <span>
          {dashboard.checkedIn} checked in · {dashboard.registrations} registrations
        </span>
      </Link>
      <Link href={`${base}/coverage`} prefetch={false}>
        <strong>Review observation coverage →</strong>
        <span>{outstanding} expected scorecards not complete</span>
      </Link>
      <Link href={`${base}/staff`} prefetch={false}>
        <strong>Check evaluator assignments →</strong>
        <span>{dashboard.activeEvaluators} active evaluators</span>
      </Link>
      <Link href={`${base}/rankings?completion=unscored`} prefetch={false}>
        <strong>Find athletes without completed scores →</strong>
        <span>
          Missing work stays separate from zero scores, skipped observations and absences.
        </span>
      </Link>
    </section>
  );
}
