import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../../../infrastructure/supabase/database.types';
import type { OrganizationId, UserId } from '../../../lib/ids';
import type { AuthorizationContext } from '../application/capabilities';
import {
  isOrganizationRole,
  isScopedRole,
  isStaffScopeKind,
  type OrganizationRole,
  type StaffScope,
  type StaffAssignment,
} from '../domain/roles';

type MembershipRecord = {
  organizationId: OrganizationId;
  userId: UserId;
  role: string;
  status: string;
};

type AssignmentRecord = {
  role: string;
  scopeKind: string;
  tryoutId: string;
  divisionId?: string | null;
  sessionId?: string | null;
  groupId?: string | null;
  athleteId?: string | null;
  revokedAt: string | null;
  expiresAt: string | null;
};

function parseScope(record: AssignmentRecord): StaffScope | null {
  if (!record.tryoutId || !isStaffScopeKind(record.scopeKind)) {
    return null;
  }

  const hasNoDivision = record.divisionId === null || record.divisionId === undefined;
  const hasNoSession = record.sessionId === null || record.sessionId === undefined;
  const hasNoGroup = record.groupId === null || record.groupId === undefined;
  const hasNoAthlete = record.athleteId === null || record.athleteId === undefined;

  switch (record.scopeKind) {
    case 'tryout':
      return hasNoDivision && hasNoSession && hasNoGroup && hasNoAthlete
        ? { kind: 'tryout', tryoutId: record.tryoutId }
        : null;
    case 'division':
      return record.divisionId && hasNoSession && hasNoGroup && hasNoAthlete
        ? { kind: 'division', tryoutId: record.tryoutId, divisionId: record.divisionId }
        : null;
    case 'session':
      return hasNoDivision && record.sessionId && hasNoGroup && hasNoAthlete
        ? { kind: 'session', tryoutId: record.tryoutId, sessionId: record.sessionId }
        : null;
    case 'group':
      return hasNoDivision && record.sessionId && record.groupId && hasNoAthlete
        ? {
            kind: 'group',
            tryoutId: record.tryoutId,
            sessionId: record.sessionId,
            groupId: record.groupId,
          }
        : null;
    case 'athlete':
      return hasNoDivision && hasNoSession && hasNoGroup && record.athleteId
        ? { kind: 'athlete', tryoutId: record.tryoutId, athleteId: record.athleteId }
        : null;
  }
}

function activeAssignment(record: AssignmentRecord, now: Date): StaffAssignment | null {
  const scope = parseScope(record);
  if (
    record.revokedAt !== null ||
    (record.expiresAt !== null && new Date(record.expiresAt).getTime() <= now.getTime()) ||
    !isScopedRole(record.role) ||
    scope === null
  ) {
    return null;
  }

  return {
    role: record.role,
    scope,
  };
}

export function buildAuthorizationContext(
  membership: MembershipRecord,
  assignments: AssignmentRecord[],
  now: Date,
): AuthorizationContext | null {
  if (membership.status !== 'active' || !isOrganizationRole(membership.role)) {
    return null;
  }

  return {
    userId: membership.userId,
    organizationId: membership.organizationId,
    organizationRole: membership.role as OrganizationRole,
    membershipStatus: 'active',
    assignments: assignments
      .map((assignment) => activeAssignment(assignment, now))
      .filter((assignment): assignment is StaffAssignment => assignment !== null),
  };
}

/**
 * Reads the current database records that authorize an actor. Callers supply a
 * caller-scoped Supabase client; this repository never reads JWT role metadata.
 */
export class SupabaseMembershipRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async findAuthorizationContext(
    userId: UserId,
    organizationId: OrganizationId,
    now = new Date(),
  ): Promise<AuthorizationContext | null> {
    const membershipResult = await this.client
      .from('organization_members')
      .select('organization_id, user_id, role, status')
      .eq('organization_id', organizationId)
      .eq('user_id', userId)
      .maybeSingle();

    if (membershipResult.error) {
      throw membershipResult.error;
    }

    if (!membershipResult.data) {
      return null;
    }

    const assignmentResult = await this.client
      .from('tryout_staff_assignments')
      .select(
        'role, scope_kind, tryout_id, division_id, session_id, group_id, athlete_id, revoked_at, expires_at',
      )
      .eq('organization_id', organizationId)
      .eq('user_id', userId)
      .is('revoked_at', null);

    if (assignmentResult.error) {
      throw assignmentResult.error;
    }

    return buildAuthorizationContext(
      {
        organizationId: membershipResult.data.organization_id as OrganizationId,
        userId: membershipResult.data.user_id as UserId,
        role: membershipResult.data.role,
        status: membershipResult.data.status,
      },
      assignmentResult.data.map((assignment) => ({
        role: assignment.role,
        scopeKind: assignment.scope_kind,
        tryoutId: assignment.tryout_id,
        divisionId: assignment.division_id,
        sessionId: assignment.session_id,
        groupId: assignment.group_id,
        athleteId: assignment.athlete_id,
        revokedAt: assignment.revoked_at,
        expiresAt: assignment.expires_at,
      })),
      now,
    );
  }
}
