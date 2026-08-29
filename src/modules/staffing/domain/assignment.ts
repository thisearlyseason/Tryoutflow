export type EvaluationScope =
  | { kind: 'tryout'; tryoutId: string }
  | { kind: 'division'; tryoutId: string; divisionId: string }
  | { kind: 'session'; tryoutId: string; sessionId: string; divisionId?: string }
  | {
      kind: 'group';
      tryoutId: string;
      sessionId: string;
      groupId: string;
      divisionId?: string;
    };

export type RegistrationPlacement = {
  registrationId: string;
  tryoutId: string;
  divisionId: string;
  sessionId?: string;
  groupId?: string;
};

export type AssignedAthleteSummary = {
  registrationId: string;
  displayName: string;
  divisionName: string;
  sessionName: string | null;
  groupName: string | null;
  tryoutNumber: number | null;
  identityMode: 'blind' | 'full';
};

export function scopeMatchesRegistration(
  scope: EvaluationScope,
  registration: RegistrationPlacement,
): boolean {
  if (scope.tryoutId !== registration.tryoutId) return false;
  switch (scope.kind) {
    case 'tryout':
      return true;
    case 'division':
      return scope.divisionId === registration.divisionId;
    case 'session':
      return scope.sessionId === registration.sessionId;
    case 'group':
      return scope.sessionId === registration.sessionId && scope.groupId === registration.groupId;
  }
}

export function resolveAssignedRegistrations(
  scope: EvaluationScope,
  registrations: readonly RegistrationPlacement[],
): string[] {
  return registrations
    .filter((registration) => scopeMatchesRegistration(scope, registration))
    .map(({ registrationId }) => registrationId);
}
