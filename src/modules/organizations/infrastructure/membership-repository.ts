import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../../../infrastructure/supabase/database.types';
import type { OrganizationId, UserId } from '../../../lib/ids';
import type { AuthorizationContext } from '../application/capabilities';
import {
  isOrganizationRole,
  isScopedRole,
  type OrganizationRole,
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
  tryoutId: string;
  sessionId?: string | null;
  groupId?: string | null;
  athleteId?: string | null;
  revokedAt: string | null;
  expiresAt: string | null;
};

function activeAssignment(record: AssignmentRecord, now: Date): StaffAssignment | null {
  if (
    record.revokedAt !== null ||
    (record.expiresAt !== null && new Date(record.expiresAt).getTime() <= now.getTime()) ||
    !isScopedRole(record.role)
  ) {
    return null;
  }

  return {
    role: record.role,
    tryoutId: record.tryoutId,
    ...(record.sessionId ? { sessionId: record.sessionId } : {}),
    ...(record.groupId ? { groupId: record.groupId } : {}),
    ...(record.athleteId ? { athleteId: record.athleteId } : {}),
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
      .select('role, tryout_id, session_id, group_id, athlete_id, revoked_at, expires_at')
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
        tryoutId: assignment.tryout_id,
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
