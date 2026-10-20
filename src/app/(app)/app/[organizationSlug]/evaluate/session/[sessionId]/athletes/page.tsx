import { EvaluatorWorkspace } from '@/modules/evaluations/ui/evaluator-workspace';
import { loadEvaluatorSession } from '@/modules/evaluations/infrastructure/evaluator-session-loader';
import { EvaluationRouteMessage } from '@/modules/evaluations/ui/session-state';

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
  const stationResult = await loaded.value.current.client
    .from('tryout_stations')
    .select('id,name,location,instructions,group_label')
    .eq('organization_id', loaded.value.current.organization.id)
    .eq('tryout_id', loaded.value.session.tryoutId)
    .eq('session_id', sessionId)
    .eq('evaluator_user_id', loaded.value.current.userId)
    .eq('status', 'active');
  return (
    <section aria-labelledby="assigned-athletes-heading" className="grid min-w-0 gap-5">
      <header>
        <p className="eyebrow">{loaded.value.session.name}</p>
        <h2 id="assigned-athletes-heading">Assigned athletes</h2>
        <p className="mt-2 text-[var(--color-text-muted)]">
          Only athletes in your active evaluator assignment are shown.
        </p>
      </header>
      <EvaluatorWorkspace
        stationsUnavailable={Boolean(stationResult.error)}
        stations={(stationResult.data ?? []).map((station) => ({
          id: station.id,
          name: station.name,
          location: station.location,
          instructions: station.instructions,
          groupLabel: station.group_label,
        }))}
        athletes={loaded.value.athletes}
        basePath={basePath}
        evaluations={loaded.value.evaluations}
      />
    </section>
  );
}
