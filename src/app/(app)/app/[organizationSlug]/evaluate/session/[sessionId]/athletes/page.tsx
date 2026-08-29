import { loadEvaluatorSession } from '@/modules/evaluations/infrastructure/evaluator-session-loader';
import {
  AssignedAthleteList,
  EvaluationRouteMessage,
} from '@/modules/evaluations/ui/session-state';

export default async function AssignedAthletesPage({
  params,
}: {
  params: Promise<{ organizationSlug: string; sessionId: string }>;
}) {
  const { organizationSlug, sessionId } = await params;
  const loaded = await loadEvaluatorSession(organizationSlug, sessionId);
  if (loaded.outcome !== 'ready') return <EvaluationRouteMessage outcome={loaded.outcome} />;
  if (loaded.value.athletes.length === 0) return <EvaluationRouteMessage outcome="empty" />;
  const basePath = `/app/${organizationSlug}/evaluate/session/${sessionId}`;
  return (
    <section aria-labelledby="assigned-athletes-heading" className="grid min-w-0 gap-5">
      <header>
        <p className="eyebrow">{loaded.value.session.name}</p>
        <h2 id="assigned-athletes-heading">Assigned athletes</h2>
        <p className="mt-2 text-[var(--color-text-muted)]">
          Only athletes in your active evaluator assignment are shown.
        </p>
      </header>
      <AssignedAthleteList
        athletes={loaded.value.athletes}
        basePath={basePath}
        evaluations={loaded.value.evaluations}
      />
    </section>
  );
}
