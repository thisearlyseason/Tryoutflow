import Link from 'next/link';

import { EmptyState } from '../../../components/feedback/empty-state';
import type {
  ManagerReportSummary,
  ReportPageAccess,
} from '../infrastructure/supabase-report-gateway';

export function ReportsPage({
  organizationId,
  tryoutId,
  summary,
  access,
}: {
  organizationId: string;
  tryoutId?: string;
  summary?: ManagerReportSummary;
  access?: ReportPageAccess;
}) {
  const query = tryoutId ? `?tryoutId=${encodeURIComponent(tryoutId)}` : '';
  const base = `/api/organizations/${organizationId}/exports`;
  const reviewer = access?.kind === 'reviewer_roster' ? access : null;
  const unavailableReviewer = access?.kind === 'reviewer_roster_unavailable';
  const manager = summary ?? (access?.kind === 'manager' ? access.summary : null);
  if (unavailableReviewer) {
    return (
      <section aria-labelledby="reports-heading" className="min-w-0">
        <p className="eyebrow">Approved final report</p>
        <h2 id="reports-heading">Reports</h2>
        <p className="mt-2 max-w-3xl text-[var(--color-text-muted)]" role="status">
          This finalized roster’s verified export snapshot is unavailable. Ask an authorized manager
          to create and finalize a new roster revision.
        </p>
      </section>
    );
  }
  if (reviewer && tryoutId) {
    return (
      <section aria-labelledby="reports-heading" className="min-w-0">
        <p className="eyebrow">Approved final report</p>
        <h2 id="reports-heading">Reports</h2>
        <p className="mt-2 max-w-3xl text-[var(--color-text-muted)]">
          Your reviewer grant permits only this immutable finalized-roster snapshot.
        </p>
        {reviewer.unavailableFinalizedRosterCount ? (
          <p className="mt-4 text-sm text-[var(--color-text-muted)]" role="status">
            Another finalized roster exists, but its verified export snapshot is unavailable.
          </p>
        ) : null}
        <div className="mt-6">
          <Link
            className="button-secondary inline-flex min-h-11 items-center"
            href={`${base}/roster?tryoutId=${encodeURIComponent(tryoutId)}&rosterVersionId=${encodeURIComponent(reviewer.rosterVersionId)}`}
          >
            Download finalized roster CSV
          </Link>
        </div>
      </section>
    );
  }
  if (!manager) return null;
  const empty =
    manager.athleteCount === 0 &&
    manager.completedEvaluationCount === 0 &&
    manager.incompleteEvaluationCount === 0 &&
    manager.finalizedRosterCount === 0;
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
            <dd className="text-xl font-bold">{manager.athleteCount} athletes</dd>
          </div>
          <div className="rounded-[var(--radius-surface)] bg-[var(--color-surface)] p-4">
            <dt>Complete</dt>
            <dd className="text-xl font-bold">
              {manager.completedEvaluationCount} completed evaluations
            </dd>
          </div>
          <div className="rounded-[var(--radius-surface)] bg-[var(--color-surface)] p-4">
            <dt>Incomplete</dt>
            <dd className="text-xl font-bold">
              {manager.incompleteEvaluationCount} incomplete evaluations
            </dd>
          </div>
          <div className="rounded-[var(--radius-surface)] bg-[var(--color-surface)] p-4">
            <dt>Final rosters</dt>
            <dd className="text-xl font-bold">{manager.finalizedRosterCount}</dd>
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
        {tryoutId && manager.latestFinalizedRosterId ? (
          <Link
            className="button-secondary inline-flex min-h-11 items-center"
            href={`${base}/roster?tryoutId=${encodeURIComponent(tryoutId)}&rosterVersionId=${encodeURIComponent(manager.latestFinalizedRosterId)}`}
          >
            Download finalized roster CSV
          </Link>
        ) : null}
      </div>
      {manager.unavailableFinalizedRosterCount ? (
        <p className="mt-4 text-sm text-[var(--color-text-muted)]" role="status">
          {manager.latestFinalizedRosterId
            ? 'Another finalized roster exists, but its verified export snapshot is unavailable.'
            : 'A finalized roster exists, but its verified export snapshot is unavailable. Create and finalize a new roster revision.'}
        </p>
      ) : tryoutId && !manager.latestFinalizedRosterId ? (
        <p className="mt-4 text-sm text-[var(--color-text-muted)]">
          Finalize a roster before downloading its immutable snapshot.
        </p>
      ) : null}
    </section>
  );
}
