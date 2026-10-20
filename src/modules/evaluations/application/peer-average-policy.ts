/** Presentation preflight only. The database RPC independently enforces this policy. */
export function hasSubmittedOwnProfile(
  evaluations: readonly {
    registrationId: string;
    rubricVersionId: string;
    state: string;
  }[],
  registrationId: string,
  rubricVersionId: string,
): boolean {
  return evaluations.some(
    (evaluation) =>
      evaluation.registrationId === registrationId &&
      evaluation.rubricVersionId === rubricVersionId &&
      (evaluation.state === 'completed' || evaluation.state === 'locked'),
  );
}
