import Link from 'next/link';

import { loadEvaluatorSession } from '@/modules/evaluations/infrastructure/evaluator-session-loader';
import { firstIncompleteAssignedAthlete } from '@/modules/evaluations/application/list-evaluator-destinations';
import { EvaluationRouteMessage } from '@/modules/evaluations/ui/session-state';

export default async function EvaluatorSessionPage({
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
  const basePath = `/app/${organizationSlug}/evaluate/session/${sessionId}`;
  const nextIncomplete = firstIncompleteAssignedAthlete(athletes, evaluations);
  return (
    <section aria-labelledby="evaluator-session-heading" className="grid min-w-0 gap-6">
      <header>
        <p className="eyebrow">Evaluator session</p>
        <h2 id="evaluator-session-heading">{session.name}</h2>
        <p className="mt-2 text-[var(--color-text-muted)]">
          {completed} of {athletes.length} evaluations completed by you.
        </p>
      </header>
      <div className="grid gap-3 sm:grid-cols-3">
        <Link
          className="min-h-[44px] rounded-xl bg-[var(--color-primary)] p-5 font-bold text-[var(--color-primary-foreground)]"
          href={nextIncomplete ? `${basePath}/athletes/${nextIncomplete}` : `${basePath}/progress`}
          prefetch={false}
        >
          {nextIncomplete ? 'Continue scoring' : 'Review completed session'}
        </Link>
        <Link
          className="min-h-[44px] rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 font-bold"
          href={`${basePath}/athletes`}
          prefetch={false}
        >
          Assigned athletes
        </Link>
        <Link
          className="min-h-[44px] rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 font-bold"
          href={`${basePath}/progress`}
          prefetch={false}
        >
          Your progress
        </Link>
      </div>
    </section>
  );
}
