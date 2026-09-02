import Link from 'next/link';

import { loadEvaluatorSession } from '@/modules/evaluations/infrastructure/evaluator-session-loader';
import { EvaluationRouteMessage } from '@/modules/evaluations/ui/session-state';

export default async function EvaluationProgressPage({
  params,
}: {
  params: Promise<{ organizationSlug: string; sessionId: string }>;
}) {
  const { organizationSlug, sessionId } = await params;
  const loaded = await loadEvaluatorSession(organizationSlug, sessionId);
  if (loaded.outcome !== 'ready') return <EvaluationRouteMessage outcome={loaded.outcome} />;
  const { athletes, evaluations, session } = loaded.value;
  if (athletes.length === 0) return <EvaluationRouteMessage outcome="empty" />;
  const completed = evaluations.filter(
    (evaluation) => evaluation.state === 'completed' || evaluation.state === 'locked',
  ).length;
  const inProgress = evaluations.filter(
    (evaluation) => evaluation.state === 'draft' || evaluation.state === 'reopened',
  ).length;
  const percentage = Math.round((completed / athletes.length) * 100);
  const basePath = `/app/${organizationSlug}/evaluate/session/${sessionId}`;
  return (
    <section aria-labelledby="evaluation-progress-heading" className="grid min-w-0 gap-6">
      <header>
        <p className="eyebrow">{session.name}</p>
        <h2 id="evaluation-progress-heading">Your evaluation progress</h2>
        <p className="mt-2 text-[var(--color-text-muted)]">
          This view includes only your own evaluation states. Peer scores and notes stay private.
        </p>
      </header>
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
        <p className="font-[var(--font-score)] text-5xl font-bold tabular-nums">{percentage}%</p>
        <div
          aria-label={`${percentage}% complete`}
          aria-valuemax={athletes.length}
          aria-valuemin={0}
          aria-valuenow={completed}
          className="mt-4 h-4 overflow-hidden rounded-full bg-[var(--color-surface-muted)]"
          role="progressbar"
        >
          <div
            className="h-full bg-[var(--color-performance)]"
            style={{ width: `${percentage}%` }}
          />
        </div>
        <dl className="mt-5 grid grid-cols-3 gap-3 text-center">
          <div>
            <dt className="text-sm text-[var(--color-text-muted)]">Complete</dt>
            <dd className="font-[var(--font-score)] text-2xl font-bold">{completed}</dd>
          </div>
          <div>
            <dt className="text-sm text-[var(--color-text-muted)]">In progress</dt>
            <dd className="font-[var(--font-score)] text-2xl font-bold">{inProgress}</dd>
          </div>
          <div>
            <dt className="text-sm text-[var(--color-text-muted)]">Assigned</dt>
            <dd className="font-[var(--font-score)] text-2xl font-bold">{athletes.length}</dd>
          </div>
        </dl>
      </div>
      <Link
        className="min-h-[44px] rounded-lg bg-[var(--color-primary)] px-5 py-3 text-center font-bold text-[var(--color-primary-foreground)]"
        href={`${basePath}/athletes`}
        prefetch={false}
      >
        View assigned athletes
      </Link>
    </section>
  );
}
