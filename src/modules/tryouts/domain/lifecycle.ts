export type TryoutStatus = 'draft' | 'published' | 'finalized';
export type TryoutLifecycleAction = 'publish' | 'finalize';

export type SessionTimeRange = {
  startAt: Date;
  endAt: Date;
};

export function transitionTryout(
  current: TryoutStatus,
  action: TryoutLifecycleAction,
): TryoutStatus {
  if (current === 'draft' && action === 'publish') {
    return 'published';
  }

  if (current === 'published' && action === 'finalize') {
    return 'finalized';
  }

  throw new Error('invalid transition');
}

export function validateSession(
  range: SessionTimeRange,
): { ok: true } | { ok: false; code: 'invalid_time_range' } {
  return range.endAt.getTime() > range.startAt.getTime()
    ? { ok: true }
    : { ok: false, code: 'invalid_time_range' };
}

export function hasValidInstantRange(startsAt: Date | null, endsAt: Date | null): boolean {
  return (
    (startsAt === null && endsAt === null) ||
    (startsAt !== null && endsAt !== null && endsAt.getTime() > startsAt.getTime())
  );
}
