import { loadEvaluatorSession } from '@/modules/evaluations/infrastructure/evaluator-session-loader';
import { EvaluationRouteMessage } from '@/modules/evaluations/ui/session-state';
import { AssignedSessionWorkspace } from '@/modules/evaluations/ui/assigned-session-workspace';

export default async function EvaluatorSessionPage({
  params,
}: {
  params: Promise<{ organizationSlug: string; sessionId: string }>;
}) {
  const { organizationSlug, sessionId } = await params;
  const loaded = await loadEvaluatorSession(organizationSlug, sessionId);
  if (loaded.outcome !== 'ready') return <EvaluationRouteMessage outcome={loaded.outcome} />;
  const { athletes, evaluations, session } = loaded.value;
  if (!athletes.length) return <EvaluationRouteMessage outcome="empty" />;
  return (
    <AssignedSessionWorkspace
      athletes={athletes}
      evaluations={evaluations}
      sessionName={session.name}
      basePath={`/app/${organizationSlug}/evaluate/session/${sessionId}`}
    />
  );
}
