import type { AuthorizationContext } from './capabilities';
import { can } from './capabilities';
import type { SelectedEventOption } from '../components/selected-event';

export function eventNavigationOptions(
  authorization: AuthorizationContext,
  organizationSlug: string,
  rows: readonly { id: string; name: string }[],
): SelectedEventOption[] {
  const manager = ['owner', 'administrator'].includes(authorization.organizationRole);
  if (authorization.membershipStatus !== 'active') return [];
  return rows.flatMap(({ id, name }) => {
    const resource = { organizationId: authorization.organizationId, tryoutId: id };
    const assigned = authorization.assignments.filter((a) => a.scope.tryoutId === id);
    if (!manager && !assigned.length) return [];
    const segment = can(authorization, 'tryout:read', resource)
      ? 'overview'
      : can(authorization, 'checkin:read', resource)
        ? 'check-in'
        : can(authorization, 'report:read', { ...resource, finalized: true })
          ? 'reports'
          : null;
    // Narrow evaluator scopes enter their existing assignment-filtered workspace.
    const evaluator = assigned.some(({ role }) => role === 'evaluator');
    const href = segment
      ? `/app/${organizationSlug}/tryouts/${id}/${segment}`
      : evaluator
        ? `/app/${organizationSlug}/evaluate?tryout=${id}`
        : null;
    return href ? [{ id, name, href }] : [];
  });
}
