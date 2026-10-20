import type { AuthorizationContext } from '../../organizations/application/capabilities';

export type EvaluatorDestination = {
  tryoutId: string;
  tryoutName: string;
  sessionId: string;
  sessionName: string;
};

type TryoutRow = {
  organizationId: string;
  id: string;
  name: string;
  status: string;
};

type SessionRow = {
  organizationId: string;
  id: string;
  tryoutId: string;
  divisionId: string;
  name: string;
};

function assignmentIncludesSession(
  assignment: AuthorizationContext['assignments'][number],
  session: SessionRow,
): boolean {
  if (assignment.role !== 'evaluator' || assignment.scope.tryoutId !== session.tryoutId) {
    return false;
  }
  switch (assignment.scope.kind) {
    case 'tryout':
      return true;
    case 'division':
      return assignment.scope.divisionId === session.divisionId;
    case 'session':
    case 'group':
      return assignment.scope.sessionId === session.id;
    case 'athlete':
      return false;
  }
}

/** Builds a contact-free evaluator route projection from already-live membership assignments. */
export function resolveEvaluatorDestinations(
  actor: AuthorizationContext,
  tryouts: readonly TryoutRow[],
  sessions: readonly SessionRow[],
): EvaluatorDestination[] {
  const activeTryouts = new Map(
    tryouts
      .filter(
        (tryout) =>
          tryout.organizationId === actor.organizationId &&
          (tryout.status === 'published' || tryout.status === 'finalized'),
      )
      .map((tryout) => [tryout.id, tryout]),
  );
  const seen = new Set<string>();
  const result: EvaluatorDestination[] = [];
  for (const session of sessions) {
    if (session.organizationId !== actor.organizationId || seen.has(session.id)) continue;
    const tryout = activeTryouts.get(session.tryoutId);
    if (!tryout) continue;
    if (!actor.assignments.some((assignment) => assignmentIncludesSession(assignment, session))) {
      continue;
    }
    seen.add(session.id);
    result.push({
      tryoutId: tryout.id,
      tryoutName: tryout.name,
      sessionId: session.id,
      sessionName: session.name,
    });
  }
  return result.sort(
    (left, right) =>
      left.tryoutName.localeCompare(right.tryoutName) ||
      left.sessionName.localeCompare(right.sessionName) ||
      left.sessionId.localeCompare(right.sessionId),
  );
}

export function firstIncompleteAssignedAthlete(
  athletes: readonly { registrationId: string }[],
  evaluations: readonly {
    registrationId: string;
    state: 'draft' | 'completed' | 'locked' | 'reopened';
  }[],
): string | null {
  const completed = new Set(
    evaluations
      .filter((evaluation) => evaluation.state === 'completed' || evaluation.state === 'locked')
      .map((evaluation) => evaluation.registrationId),
  );
  return athletes.find((athlete) => !completed.has(athlete.registrationId))?.registrationId ?? null;
}
