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

type AssignmentRow = Pick<
  Database['public']['Tables']['tryout_staff_assignments']['Row'],
  | 'role'
  | 'scope_kind'
  | 'tryout_id'
  | 'division_id'
  | 'session_id'
  | 'group_id'
  | 'athlete_id'
  | 'revoked_at'
  | 'expires_at'
>;

function assignmentRecord(row: AssignmentRow): AssignmentRecord {
  return {
    role: row.role,
    scopeKind: row.scope_kind,
    tryoutId: row.tryout_id,
    divisionId: row.division_id,
    sessionId: row.session_id,
    groupId: row.group_id,
    athleteId: row.athlete_id,
    revokedAt: row.revoked_at,
    expiresAt: row.expires_at,
  };
}

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

  /** One caller-scoped read; RLS and the existing domain checks still authorize every request. */
  async findOrganizationContext(userId: UserId, slug: string, now = new Date()) {
    const { data, error } = await this.client
      .from('organizations')
      .select(
        'id,name,slug,timezone,terminology,sport_defaults,tag_defaults,members:organization_members(organization_id,user_id,role,status),assignments:tryout_staff_assignments(role,scope_kind,tryout_id,division_id,session_id,group_id,athlete_id,revoked_at,expires_at)',
      )
      .eq('slug', slug)
      .eq('members.user_id', userId)
      .eq('assignments.user_id', userId)
      .is('assignments.revoked_at', null)
      .maybeSingle();
    if (error) throw error;
    if (!data || data.members.length !== 1) return null;
    const membership = data.members[0]!;
    if (membership.user_id !== userId || membership.organization_id !== data.id) return null;
    const authorization = buildAuthorizationContext(
      {
        organizationId: data.id as OrganizationId,
        userId,
        role: membership.role,
        status: membership.status,
      },
      data.assignments.map(assignmentRecord),
      now,
    );
    if (!authorization) return null;
    const { members: _members, assignments: _assignments, ...organization } = data;
    return { organization, authorization };
  }

  async findAuthorizationContext(
    userId: UserId,
    organizationId: OrganizationId,
    now = new Date(),
  ): Promise<AuthorizationContext | null> {
    // Both reads are scoped to this caller and organization and protected by RLS.
    // Run independent I/O together; never cache membership or assignment authority.
    const [membershipResult, assignmentResult] = await Promise.all([
      this.client
        .from('organization_members')
        .select('organization_id, user_id, role, status')
        .eq('organization_id', organizationId)
        .eq('user_id', userId)
        .maybeSingle(),
      this.client
        .from('tryout_staff_assignments')
        .select(
          'role, scope_kind, tryout_id, division_id, session_id, group_id, athlete_id, revoked_at, expires_at',
        )
        .eq('organization_id', organizationId)
        .eq('user_id', userId)
        .is('revoked_at', null),
    ]);

    if (membershipResult.error) {
      throw membershipResult.error;
    }

    if (!membershipResult.data) {
      return null;
    }

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
      assignmentResult.data.map(assignmentRecord),
      now,
    );
  }
}
