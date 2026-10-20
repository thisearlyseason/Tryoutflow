export const organizationRoles = ['owner', 'administrator', 'member'] as const;
export type OrganizationRole = (typeof organizationRoles)[number];

export const scopedRoles = ['director', 'evaluator', 'checkin', 'reviewer'] as const;
export type ScopedRole = (typeof scopedRoles)[number];

export type StaffScope =
  | { kind: 'tryout'; tryoutId: string }
  | { kind: 'division'; tryoutId: string; divisionId: string }
  | { kind: 'session'; tryoutId: string; sessionId: string }
  | { kind: 'group'; tryoutId: string; sessionId: string; groupId: string }
  | { kind: 'athlete'; tryoutId: string; athleteId: string };

export type StaffAssignment = {
  role: ScopedRole;
  scope: StaffScope;
};

export const staffScopeKinds = ['tryout', 'division', 'session', 'group', 'athlete'] as const;
export type StaffScopeKind = (typeof staffScopeKinds)[number];

export function isOrganizationRole(value: string): value is OrganizationRole {
  return organizationRoles.some((role) => role === value);
}

export function isScopedRole(value: string): value is ScopedRole {
  return scopedRoles.some((role) => role === value);
}

export function isStaffScopeKind(value: string): value is StaffScopeKind {
  return staffScopeKinds.some((kind) => kind === value);
}
