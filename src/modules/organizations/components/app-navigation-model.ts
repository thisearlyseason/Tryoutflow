import type { AuthorizationContext } from '../application/capabilities';

export type NavigationIcon =
  'home' | 'tryouts' | 'athletes' | 'evaluate' | 'reports' | 'organization';

export type NavigationItem = Readonly<{
  href: string;
  label: string;
  accessibleLabel?: string;
  compactLabel?: string;
  icon: NavigationIcon;
  activePaths?: readonly string[];
  mobilePriority?: number;
}>;

export type NavigationGroup = Readonly<{
  id: string;
  label: string;
  items: readonly NavigationItem[];
  presentation?: 'context' | 'disclosure';
  parentHref?: string;
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
    compactLabel: label,
    href: `/app/${organizationSlug}/tryouts/${tryoutId}/${segment}`,
    accessibleLabel: `${label} for tryout ${tryoutId}`,
    icon,
  };
}

export function buildAppNavigation({
  authorization,
  organizationSlug,
  hasScoutingAccess = false,
  isTeamWorkspace = false,
  tryoutNames = {},
}: {
  authorization: AuthorizationContext;
  organizationSlug: string;
  hasScoutingAccess?: boolean;
  isTeamWorkspace?: boolean;
  tryoutNames?: Readonly<Record<string, string>>;
}): NavigationGroup[] {
  const base = `/app/${organizationSlug}`;
  const managesOrganization =
    authorization.organizationRole === 'owner' ||
    authorization.organizationRole === 'administrator';

  if (managesOrganization) {
    return [
      {
        id: 'primary',
        label: 'Workspace',
        items: [
          { href: `${base}/home`, label: 'Home', icon: 'home', mobilePriority: 0 },
          ...(authorization.assignments.some(({ role }) => role === 'evaluator')
            ? [
                {
                  href: `${base}/evaluate`,
                  label: 'My scoring',
                  icon: 'evaluate' as const,
                  mobilePriority: 2,
                },
              ]
            : []),
          { href: `${base}/tryouts`, label: 'Tryouts', icon: 'tryouts', mobilePriority: 1 },
          {
            href: `${base}/athletes`,
            label: 'Athletes',
            icon: 'athletes',
            mobilePriority: 3,
            activePaths: [`${base}/scouting`, `${base}/performance`],
          },
          {
            href: `${base}/people`,
            label: 'People',
            icon: 'organization',
            activePaths: [
              `${base}/evaluators`,
              `${base}/organization/members`,
              `${base}/participants`,
            ],
          },
          { href: `${base}/reports`, label: 'Reports', icon: 'reports' },
        ],
      },
      {
        id: 'athlete-tools',
        label: 'Athlete tools',
        presentation: 'context',
        parentHref: `${base}/athletes`,
        items: [
          { href: `${base}/scouting`, label: 'Scouting', icon: 'evaluate' },
          { href: `${base}/performance`, label: 'Performance', icon: 'reports' },
        ],
      },
      {
        id: 'people-tools',
        label: 'People tools',
        presentation: 'context',
        parentHref: `${base}/people`,
        items: [
          { href: `${base}/evaluators`, label: 'Evaluators', icon: 'evaluate' },
          { href: `${base}/organization/members`, label: 'Members', icon: 'organization' },
          { href: `${base}/participants`, label: 'Participant access', icon: 'athletes' },
        ],
      },
      {
        id: 'workspace-tools',
        label: 'Workspace tools',
        presentation: 'disclosure',
        items: [
          ...(!isTeamWorkspace
            ? [
                {
                  href: `${base}/organization/teams`,
                  label: 'Team workspaces',
                  icon: 'organization' as const,
                },
              ]
            : []),
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
    ...(hasScoutingAccess
      ? [
          { href: `${base}/scouting`, label: 'Scouting', icon: 'evaluate' as const },
          { href: `${base}/performance`, label: 'Performance', icon: 'reports' as const },
          { href: `${base}/search`, label: 'Search athletes', icon: 'athletes' as const },
        ]
      : []),
    ...(evaluator
      ? [{ href: `${base}/evaluate`, label: 'My scoring', icon: 'evaluate' as const }]
      : []),
    ...checkinTryouts.map((tryoutId) =>
      scopedItem(organizationSlug, tryoutId, 'check-in', 'Check-in', 'tryouts'),
    ),
    ...directorTryouts.flatMap((tryoutId) => [
      scopedItem(organizationSlug, tryoutId, 'live', 'Run Tryout', 'home'),
      scopedItem(organizationSlug, tryoutId, 'staff', 'Staff', 'organization'),
      scopedItem(organizationSlug, tryoutId, 'rankings', 'Rankings', 'reports'),
      scopedItem(organizationSlug, tryoutId, 'rosters', 'Official roster', 'athletes'),
      scopedItem(organizationSlug, tryoutId, 'reports', 'Reports', 'reports'),
    ]),
    ...reviewerTryouts.flatMap((tryoutId) => [
      scopedItem(organizationSlug, tryoutId, 'rosters', 'Official roster', 'athletes'),
      scopedItem(organizationSlug, tryoutId, 'reports', 'Reports', 'reports'),
    ]),
  ];
  // Event names disambiguate repeated role-scoped destinations without fetching more data.
  for (const item of items) {
    const eventId = item.href.match(/\/tryouts\/([^/]+)\//)?.[1];
    if (eventId && tryoutNames[eventId]) {
      const index = items.indexOf(item);
      items[index] = {
        ...item,
        label: `${item.label} · ${tryoutNames[eventId]}`,
        accessibleLabel: `${item.label} for ${tryoutNames[eventId]}`,
      };
    }
  }
  const seen = new Set<string>();
  const deduplicated = items.filter(({ href }) => (seen.has(href) ? false : seen.add(href)));
  return deduplicated.length
    ? [
        {
          id: 'workspace',
          label: 'My workspace',
          items: deduplicated.map((item) => ({
            ...item,
            mobilePriority: staffMobilePriority(item.href),
          })),
        },
      ]
    : [];
}

/** Explicit task policy; discovery order must not decide a person's mobile shortcuts. */
function staffMobilePriority(href: string): number | undefined {
  const suffixes = [
    '/evaluate',
    '/check-in',
    '/live',
    '/rankings',
    '/staff',
    '/rosters',
    '/reports',
    '/scouting',
    '/performance',
    '/search',
  ];
  const index = suffixes.findIndex((suffix) => href.endsWith(suffix));
  return index < 0 ? undefined : index;
}

export function selectMobileNavigation(groups: readonly NavigationGroup[]): NavigationItem[] {
  const items = flattenNavigation(groups);
  if (!items.some((item) => item.mobilePriority !== undefined)) return items.slice(0, 3);
  const seenTasks = new Set<number>();
  return items
    .filter((item) => item.mobilePriority !== undefined)
    .sort((a, b) => a.mobilePriority! - b.mobilePriority! || a.href.localeCompare(b.href))
    .filter((item) => {
      const priority = item.mobilePriority!;
      if (seenTasks.has(priority)) return false;
      seenTasks.add(priority);
      return true;
    })
    .slice(0, 3);
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
