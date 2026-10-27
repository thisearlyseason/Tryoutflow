/** A continuation hint, never authority to grant athlete or staff access. */
export function familyInvitationPath(value: unknown): string | undefined {
  return typeof value === 'string' && /^\/invite\/family\/[A-Za-z0-9_-]{43}$/.test(value)
    ? value
    : undefined;
}

export function isFamilyDestination(value: unknown): boolean {
  return value === '/participant' || Boolean(familyInvitationPath(value));
}
