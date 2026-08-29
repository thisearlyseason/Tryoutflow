export type EvaluationScope =
  | { kind: 'tryout' }
  | { kind: 'division'; divisionId: string }
  | { kind: 'session'; sessionId: string }
  | { kind: 'group'; groupId: string };

export type EvaluationAssignment = { tryoutId: string; scope: EvaluationScope };

export type RegistrationPlacement = {
  registrationId: string;
  tryoutId: string;
  divisionId: string;
  sessionId?: string;
  groupId?: string;
};

export type AssignedAthleteSummary = {
  registrationId: string;
  divisionId: string;
  sessionId: string | null;
  groupId: string | null;
  displayName: string;
  divisionName: string;
  sessionName: string | null;
  groupName: string | null;
  tryoutNumber: number | null;
  identityMode: 'blind' | 'full';
};

export function scopeMatchesRegistration(
  assignment: EvaluationAssignment,
  registration: RegistrationPlacement,
): boolean {
  if (assignment.tryoutId !== registration.tryoutId) return false;
  switch (assignment.scope.kind) {
    case 'tryout':
      return true;
    case 'division':
      return assignment.scope.divisionId === registration.divisionId;
    case 'session':
      return assignment.scope.sessionId === registration.sessionId;
    case 'group':
      return assignment.scope.groupId === registration.groupId;
  }
}

export function resolveAssignedRegistrations(
  assignment: EvaluationAssignment,
  registrations: readonly RegistrationPlacement[],
): string[] {
  return registrations
    .filter((registration) => scopeMatchesRegistration(assignment, registration))
    .map(({ registrationId }) => registrationId);
}
