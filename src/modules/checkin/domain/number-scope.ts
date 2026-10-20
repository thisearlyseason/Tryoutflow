export type NumberScope =
  | { kind: 'tryout'; tryoutId: string }
  | { kind: 'division'; tryoutId: string; divisionId: string }
  | { kind: 'session'; tryoutId: string; sessionId: string }
  | { kind: 'group'; tryoutId: string; sessionId: string; groupId: string };

export function numberScopeKey(scope: NumberScope): string {
  switch (scope.kind) {
    case 'tryout':
      return `tryout:${scope.tryoutId}`;
    case 'division':
      return `division:${scope.tryoutId}:${scope.divisionId}`;
    case 'session':
      return `session:${scope.tryoutId}:${scope.sessionId}`;
    case 'group':
      return `group:${scope.tryoutId}:${scope.sessionId}:${scope.groupId}`;
  }
}

export function scopeMatchesPlacement(
  scope: NumberScope,
  placement: { tryoutId: string; divisionId: string; sessionId?: string; groupId?: string },
): boolean {
  if (scope.tryoutId !== placement.tryoutId) return false;
  if (scope.kind === 'tryout') return true;
  if (scope.kind === 'division') return scope.divisionId === placement.divisionId;
  if (scope.kind === 'session') return scope.sessionId === placement.sessionId;
  return scope.sessionId === placement.sessionId && scope.groupId === placement.groupId;
}
