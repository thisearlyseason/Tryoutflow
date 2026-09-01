import type { AuthorizationContext } from '../application/capabilities';

export type NavigationIcon =
  'home' | 'tryouts' | 'athletes' | 'evaluate' | 'reports' | 'organization';

export type NavigationItem = Readonly<{
  href: string;
  label: string;
  accessibleLabel?: string;
  icon: NavigationIcon;
}>;

export type NavigationGroup = Readonly<{
  id: string;
  label: string;
  items: readonly NavigationItem[];
}>;

function uniqueTryouts(authorization: AuthorizationContext, roles: readonly string[]) {
  return [
    ...new Set(
      authorization.assignments
        .filter((assignment) => roles.includes(assignment.role))
        .map((assignment) => assignment.scope.tryoutId),
    ),
  ];
}

function scopedItem(
  organizationSlug: string,
  tryoutId: string,
  segment: string,
  label: string,
  icon: NavigationIcon,
): NavigationItem {
  return {
    label,
    href: `/app/${organizationSlug}/tryouts/${tryoutId}/${segment}`,
    accessibleLabel: `${label} for tryout ${tryoutId}`,
    icon,
  };
}

export function buildAppNavigation({
  authorization,
  organizationSlug,
}: {
  authorization: AuthorizationContext;
  organizationSlug: string;
}): NavigationGroup[] {
  const base = `/app/${organizationSlug}`;
  const managesOrganization =
    authorization.organizationRole === 'owner' ||
    authorization.organizationRole === 'administrator';

  if (managesOrganization) {
    return [
      {
        id: 'overview',
        label: 'Overview',
        items: [{ href: `${base}/home`, label: 'Home', icon: 'home' }],
      },
      {
        id: 'operations',
        label: 'Operations',
        items: [
          { href: `${base}/tryouts`, label: 'Tryouts', icon: 'tryouts' },
          { href: `${base}/athletes`, label: 'Athletes', icon: 'athletes' },
          { href: `${base}/evaluators`, label: 'Evaluators', icon: 'evaluate' },
          { href: `${base}/reports`, label: 'Reports', icon: 'reports' },
          ...(authorization.assignments.some(({ role }) => role === 'evaluator')
            ? [{ href: `${base}/evaluate`, label: 'Evaluate', icon: 'evaluate' as const }]
            : []),
        ],
      },
      {
        id: 'organization',
        label: 'Organization',
        items: [
          { href: `${base}/organization/members`, label: 'Members', icon: 'organization' },
          {
            href: `${base}/organization/integrations`,
            label: 'Integrations',
            icon: 'organization',
          },
          { href: `${base}/organization/audit`, label: 'Audit', icon: 'reports' },
          { href: `${base}/organization/settings`, label: 'Settings', icon: 'organization' },
          ...(authorization.organizationRole === 'owner'
            ? [
                {
                  href: `${base}/organization/billing`,
                  label: 'Billing',
                  icon: 'organization' as const,
                },
              ]
            : []),
        ],
      },
    ];
  }

  const evaluator = authorization.assignments.some(({ role }) => role === 'evaluator');
  const directorTryouts = uniqueTryouts(authorization, ['director']);
  const reviewerTryouts = uniqueTryouts(authorization, ['reviewer']);
  const checkinTryouts = uniqueTryouts(authorization, ['checkin']);
  const items: NavigationItem[] = [
    ...(evaluator
      ? [{ href: `${base}/evaluate`, label: 'Evaluate', icon: 'evaluate' as const }]
      : []),
    ...checkinTryouts.map((tryoutId) =>
      scopedItem(organizationSlug, tryoutId, 'check-in', 'Check-in', 'tryouts'),
    ),
    ...directorTryouts.flatMap((tryoutId) => [
      scopedItem(organizationSlug, tryoutId, 'live', 'Live', 'home'),
      scopedItem(organizationSlug, tryoutId, 'staff', 'Staff', 'organization'),
      scopedItem(organizationSlug, tryoutId, 'rankings', 'Rankings', 'reports'),
      scopedItem(organizationSlug, tryoutId, 'rosters', 'Rosters', 'athletes'),
      scopedItem(organizationSlug, tryoutId, 'reports', 'Reports', 'reports'),
    ]),
    ...reviewerTryouts.flatMap((tryoutId) => [
      scopedItem(organizationSlug, tryoutId, 'rankings', 'Rankings', 'reports'),
      scopedItem(organizationSlug, tryoutId, 'rosters', 'Rosters', 'athletes'),
      scopedItem(organizationSlug, tryoutId, 'reports', 'Reports', 'reports'),
    ]),
  ];
  const seen = new Set<string>();
  const deduplicated = items.filter(({ href }) => (seen.has(href) ? false : seen.add(href)));
  return deduplicated.length
    ? [{ id: 'workspace', label: 'My workspace', items: deduplicated }]
    : [];
}

export function flattenNavigation(groups: readonly NavigationGroup[]): NavigationItem[] {
  return groups.flatMap(({ items }) => items);
}

export function describeAppRole(authorization: AuthorizationContext) {
  if (authorization.organizationRole === 'owner') return 'Owner';
  if (authorization.organizationRole === 'administrator') return 'Administrator';
  const roles = [...new Set(authorization.assignments.map(({ role }) => role))];
  return roles.length
    ? roles
        .map((role) =>
          role === 'checkin' ? 'Check-in' : `${role[0]?.toUpperCase()}${role.slice(1)}`,
        )
        .join(' · ')
    : 'Member';
}
