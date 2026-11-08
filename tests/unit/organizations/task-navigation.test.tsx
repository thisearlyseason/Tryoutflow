import { describe, expect, it } from 'vitest';
import type { OrganizationId, UserId } from '@/lib/ids';
import type { AuthorizationContext } from '@/modules/organizations/application/capabilities';
import {
  buildAppNavigation,
  flattenNavigation,
  selectMobileNavigation,
} from '@/modules/organizations/components/app-navigation-model';

const id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const base = '/app/fixture';
function build(role = 'owner', tasks: string[] = [], talent = false, team = false) {
  return buildAppNavigation({
    authorization: {
      organizationId: 'org' as OrganizationId,
      userId: 'user' as UserId,
      membershipStatus: 'active',
      organizationRole: role,
      assignments: tasks.map((role) => ({ role, scope: { kind: 'tryout', tryoutId: id } })),
    } as AuthorizationContext,
    organizationSlug: 'fixture',
    hasScoutingAccess: talent,
    isTeamWorkspace: team,
  });
}
describe('task area navigation policy', () => {
  it('keeps distinct task shortcuts when check-in is assigned across multiple tryouts', () => {
    const groups = buildAppNavigation({
      organizationSlug: 'fixture',
      authorization: {
        organizationRole: 'member',
        assignments: [
          { role: 'evaluator', scope: { kind: 'tryout', tryoutId: id } },
          { role: 'checkin', scope: { kind: 'tryout', tryoutId: id } },
          {
            role: 'checkin',
            scope: { kind: 'tryout', tryoutId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' },
          },
          { role: 'director', scope: { kind: 'tryout', tryoutId: id } },
        ],
      } as AuthorizationContext,
    });
    expect(selectMobileNavigation(groups).map((i) => i.label)).toEqual([
      'My scoring',
      'Check-in',
      'Run Tryout',
    ]);
    expect(flattenNavigation(groups).filter((i) => i.label === 'Check-in')).toHaveLength(2);
  });

  it('presents five manager areas and retains every previous owner destination', () => {
    const groups = build();
    expect(
      groups.filter((g) => !g.presentation).flatMap((g) => g.items.map((i) => i.label)),
    ).toEqual(['Home', 'Tryouts', 'Athletes', 'People', 'Reports']);
    expect(
      flattenNavigation(groups)
        .map((i) => i.href)
        .sort(),
    ).toEqual(
      [
        'home',
        'tryouts',
        'athletes',
        'scouting',
        'performance',
        'evaluators',
        'reports',
        'participants',
        'organization/teams',
        'organization/members',
        'organization/integrations',
        'organization/audit',
        'organization/settings',
        'organization/billing',
        'people',
      ]
        .map((p) => `${base}/${p}`)
        .sort(),
    );
    expect(groups.find((g) => g.label === 'Workspace tools')?.presentation).toBe('disclosure');
    expect(
      groups.find((g) => g.parentHref === `${base}/athletes`)?.items.map((i) => i.label),
    ).toEqual(['Scouting', 'Performance']);
    expect(
      groups.find((g) => g.parentHref === `${base}/people`)?.items.map((i) => i.label),
    ).toEqual(['Evaluators', 'Members', 'Participant access']);
  });
  it('does not add billing for administrators or organization teams in a team workspace', () => {
    expect(flattenNavigation(build('administrator')).some((i) => i.href.endsWith('/billing'))).toBe(
      false,
    );
    expect(
      flattenNavigation(build('owner', [], false, true)).some((i) => i.href.endsWith('/teams')),
    ).toBe(false);
  });
  it.each([
    [[], false, []],
    [['evaluator'], false, ['My scoring']],
    [['checkin'], false, ['Check-in']],
    [['director'], false, ['Run Tryout', 'Rankings', 'Staff']],
    [['reviewer'], false, ['Official roster', 'Reports']],
    [[], true, ['Scouting', 'Performance', 'Search athletes']],
    [['evaluator', 'checkin', 'director'], true, ['My scoring', 'Check-in', 'Run Tryout']],
  ] as const)(
    'selects authorized mobile tasks for grants %j talent=%s',
    (roles, talent, labels) => {
      const groups = build('member', [...roles], talent);
      expect(selectMobileNavigation(groups).map((i) => i.label)).toEqual(labels);
      expect(
        selectMobileNavigation(
          [...groups].reverse().map((group) => ({ ...group, items: [...group.items].reverse() })),
        ).map((i) => i.label),
      ).toEqual(labels);
      const allowed = new Set(flattenNavigation(groups).map((i) => i.href));
      expect(selectMobileNavigation(groups).every((i) => allowed.has(i.href))).toBe(true);
      expect(
        flattenNavigation(groups).some((i) => /\/(people|members|billing|settings)$/.test(i.href)),
      ).toBe(false);
    },
  );
  it('prioritizes evaluation over directory when a manager is also an evaluator', () => {
    expect(selectMobileNavigation(build()).map((i) => i.label)).toEqual([
      'Home',
      'Tryouts',
      'Athletes',
    ]);
    expect(selectMobileNavigation(build('owner', ['evaluator'])).map((i) => i.label)).toEqual([
      'Home',
      'Tryouts',
      'My scoring',
    ]);
  });
  it('preserves exact scope and deduplicates overlapping reviewer/director entries', () => {
    const items = flattenNavigation(build('member', ['director', 'reviewer', 'checkin']));
    expect(items.every((i) => i.href.startsWith(`${base}/tryouts/${id}/`))).toBe(true);
    expect(new Set(items.map((i) => i.href)).size).toBe(items.length);
  });
});
