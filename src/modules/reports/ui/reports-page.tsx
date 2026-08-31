import Link from 'next/link';

import { EmptyState } from '../../../components/feedback/empty-state';
import type { ReportSummary } from '../infrastructure/supabase-report-gateway';

export function ReportsPage({
  organizationId,
  tryoutId,
  summary,
}: {
  organizationId: string;
  tryoutId?: string;
  summary: ReportSummary;
}) {
  const query = tryoutId ? `?tryoutId=${encodeURIComponent(tryoutId)}` : '';
  const base = `/api/organizations/${organizationId}/exports`;
  const empty =
    summary.athleteCount === 0 &&
    summary.completedEvaluationCount === 0 &&
    summary.incompleteEvaluationCount === 0 &&
    summary.finalizedRosterCount === 0;
  return (
    <section aria-labelledby="reports-heading" className="min-w-0">
      <p className="eyebrow">Authorized snapshots</p>
      <h2 id="reports-heading">Reports</h2>
      <p className="mt-2 max-w-3xl text-[var(--color-text-muted)]">
        Downloads are generated from your current server-authorized scope. Each CSV is limited to
        5,000 rows and 4 MiB and excludes contact details, private notes, and evaluator identity.
      </p>
      {empty ? (
        <div className="mt-6">
          <EmptyState
            description="Set up registration or complete evaluations to populate these reports."
            title="No report data yet"
          />
        </div>
      ) : (
        <dl className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-[var(--radius-surface)] bg-[var(--color-surface)] p-4">
            <dt>Athletes</dt>
            <dd className="text-xl font-bold">{summary.athleteCount} athletes</dd>
          </div>
          <div className="rounded-[var(--radius-surface)] bg-[var(--color-surface)] p-4">
            <dt>Complete</dt>
            <dd className="text-xl font-bold">
              {summary.completedEvaluationCount} completed evaluations
            </dd>
          </div>
          <div className="rounded-[var(--radius-surface)] bg-[var(--color-surface)] p-4">
            <dt>Incomplete</dt>
            <dd className="text-xl font-bold">
              {summary.incompleteEvaluationCount} incomplete evaluations
            </dd>
          </div>
          <div className="rounded-[var(--radius-surface)] bg-[var(--color-surface)] p-4">
            <dt>Final rosters</dt>
            <dd className="text-xl font-bold">{summary.finalizedRosterCount}</dd>
          </div>
        </dl>
      )}
      <div className="mt-6 flex flex-wrap gap-3" aria-label="Report downloads">
        <Link
          className="button-secondary inline-flex min-h-11 items-center"
          href={`${base}/athletes${query}`}
        >
          Download athletes CSV
        </Link>
        {tryoutId ? (
          <Link
            className="button-secondary inline-flex min-h-11 items-center"
            href={`${base}/evaluations${query}`}
          >
            Download evaluations CSV
          </Link>
        ) : null}
        {tryoutId && summary.latestFinalizedRosterId ? (
          <Link
            className="button-secondary inline-flex min-h-11 items-center"
            href={`${base}/roster?tryoutId=${encodeURIComponent(tryoutId)}&rosterVersionId=${encodeURIComponent(summary.latestFinalizedRosterId)}`}
          >
            Download finalized roster CSV
          </Link>
        ) : null}
      </div>
      {tryoutId && !summary.latestFinalizedRosterId ? (
        <p className="mt-4 text-sm text-[var(--color-text-muted)]">
          Finalize a roster before downloading its immutable snapshot.
        </p>
      ) : null}
    </section>
  );
}
