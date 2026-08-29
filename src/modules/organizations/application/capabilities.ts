import type { OrganizationId, UserId } from '../../../lib/ids';

import {
  isOrganizationRole,
  type OrganizationRole,
  type ScopedRole,
  type StaffAssignment,
} from '../domain/roles';

export type Capability =
  | 'organization:read'
  | 'organization:update'
  | 'membership:manage'
  | 'athlete:read'
  | 'athlete:write'
  | 'tryout:read'
  | 'tryout:write'
  | 'tryout:publish'
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
  organizationRole: OrganizationRole;
  membershipStatus: 'active';
  assignments: StaffAssignment[];
};

export type AuthorizationResource = {
  organizationId: OrganizationId;
  tryoutId?: string;
  divisionId?: string;
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
  'tryout:publish',
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
  'tryout:publish',
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
  if (resource.tryoutId !== assignment.scope.tryoutId) {
    return false;
  }

  switch (assignment.scope.kind) {
    case 'tryout':
      return true;
    case 'division':
      return resource.divisionId === assignment.scope.divisionId;
    case 'session':
      return resource.sessionId === assignment.scope.sessionId;
    case 'group':
      return (
        (resource.sessionId === undefined || resource.sessionId === assignment.scope.sessionId) &&
        resource.groupId === assignment.scope.groupId
      );
    case 'athlete':
      return resource.athleteId === assignment.scope.athleteId;
  }
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

  if (!isOrganizationRole(context.organizationRole) || context.membershipStatus !== 'active') {
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
      'tryout:publish',
      'checkin:read',
      'checkin:write',
      'evaluation:read',
      'ranking:read',
      'roster:read',
      'roster:write',
      'report:read',
    ].includes(capability);
  }

  if (capability === 'evaluation:update-own' || capability === 'evaluation:read') {
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
