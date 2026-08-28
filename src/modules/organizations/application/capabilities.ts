import type { OrganizationId, UserId } from '../../../lib/ids';

import type { OrganizationRole, ScopedRole, StaffAssignment } from '../domain/roles';

export type Capability =
  | 'organization:read'
  | 'organization:update'
  | 'membership:manage'
  | 'athlete:read'
  | 'athlete:write'
  | 'tryout:read'
  | 'tryout:write'
  | 'checkin:read'
  | 'checkin:write'
  | 'evaluation:read'
  | 'evaluation:update-own'
  | 'ranking:read'
  | 'roster:read'
  | 'roster:write'
  | 'report:read'
  | 'audit:read';

export type AuthorizationContext = {
  userId: UserId;
  organizationId: OrganizationId;
  organizationRole: OrganizationRole | null;
  assignments: StaffAssignment[];
};

export type AuthorizationResource = {
  organizationId: OrganizationId;
  tryoutId?: string;
  sessionId?: string;
  groupId?: string;
  athleteId?: string;
  evaluatorUserId?: UserId;
  finalized?: boolean;
};

const ownerCapabilities: ReadonlySet<Capability> = new Set([
  'organization:read',
  'organization:update',
  'membership:manage',
  'athlete:read',
  'athlete:write',
  'tryout:read',
  'tryout:write',
  'checkin:read',
  'checkin:write',
  'evaluation:read',
  'ranking:read',
  'roster:read',
  'roster:write',
  'report:read',
  'audit:read',
]);

const administratorCapabilities: ReadonlySet<Capability> = new Set([
  'organization:read',
  'organization:update',
  'membership:manage',
  'athlete:read',
  'athlete:write',
  'tryout:read',
  'tryout:write',
  'checkin:read',
  'checkin:write',
  'evaluation:read',
  'ranking:read',
  'roster:read',
  'roster:write',
  'report:read',
  'audit:read',
]);

function assignmentMatchesResource(
  assignment: StaffAssignment,
  resource: AuthorizationResource,
): boolean {
  return (
    (!assignment.tryoutId || assignment.tryoutId === resource.tryoutId) &&
    (!assignment.sessionId || assignment.sessionId === resource.sessionId) &&
    (!assignment.groupId || assignment.groupId === resource.groupId) &&
    (!assignment.athleteId || assignment.athleteId === resource.athleteId)
  );
}

function hasScopedRole(
  context: AuthorizationContext,
  role: ScopedRole,
  resource: AuthorizationResource,
): boolean {
  return context.assignments.some(
    (assignment) => assignment.role === role && assignmentMatchesResource(assignment, resource),
  );
}

function hasOrganizationCapability(context: AuthorizationContext, capability: Capability): boolean {
  if (context.organizationRole === 'owner') {
    return ownerCapabilities.has(capability);
  }

  return context.organizationRole === 'administrator' && administratorCapabilities.has(capability);
}

export function can(
  context: AuthorizationContext,
  capability: Capability,
  resource: AuthorizationResource,
): boolean {
  if (context.organizationId !== resource.organizationId) {
    return false;
  }

  if (hasOrganizationCapability(context, capability)) {
    return true;
  }

  if (hasScopedRole(context, 'director', resource)) {
    return [
      'athlete:read',
      'athlete:write',
      'tryout:read',
      'tryout:write',
      'checkin:read',
      'checkin:write',
      'evaluation:read',
      'ranking:read',
      'roster:read',
      'roster:write',
      'report:read',
    ].includes(capability);
  }

  if (capability === 'evaluation:update-own') {
    return (
      resource.evaluatorUserId === context.userId && hasScopedRole(context, 'evaluator', resource)
    );
  }

  if (capability === 'checkin:read' || capability === 'checkin:write') {
    return hasScopedRole(context, 'checkin', resource);
  }

  if ((capability === 'roster:read' || capability === 'report:read') && resource.finalized) {
    return hasScopedRole(context, 'reviewer', resource);
  }

  return false;
}
