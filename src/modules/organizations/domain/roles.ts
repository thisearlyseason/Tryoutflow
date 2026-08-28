export const organizationRoles = ['owner', 'administrator', 'member'] as const;
export type OrganizationRole = (typeof organizationRoles)[number];

export const scopedRoles = ['director', 'evaluator', 'checkin', 'reviewer'] as const;
export type ScopedRole = (typeof scopedRoles)[number];

export type StaffAssignment = {
  role: ScopedRole;
  tryoutId?: string;
  sessionId?: string;
  groupId?: string;
  athleteId?: string;
};

export function isOrganizationRole(value: string): value is OrganizationRole {
  return organizationRoles.some((role) => role === value);
}

export function isScopedRole(value: string): value is ScopedRole {
  return scopedRoles.some((role) => role === value);
}
