import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  createTeamWorkspaceSchema,
  summarizeTeamWorkspaces,
  workspaceNavigationSchema,
} from '@/modules/organizations/application/team-workspaces';
import { WorkspaceSwitcher } from '@/modules/organizations/components/workspace-switcher';
import { buildAppNavigation } from '@/modules/organizations/components/app-navigation-model';
import type { AuthorizationContext } from '@/modules/organizations/application/capabilities';
const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
const a = 'e1550000-0000-4000-8000-000000000001';
const b = 'e1550000-0000-4000-8000-000000000002';

describe('team workspaces', () => {
  it('rejects unsafe workspace routes and empty names', () => {
    for (const slug of ['../admin', '//host', 'team?role=owner', 'UPPER', 'a', 'a'.repeat(64)])
      expect(createTeamWorkspaceSchema.safeParse({ name: 'Falcons', slug }).success).toBe(false);
    expect(createTeamWorkspaceSchema.safeParse({ name: ' ', slug: 'falcons-u13' }).success).toBe(
      false,
    );
    expect(
      createTeamWorkspaceSchema.parse({ name: ' U13 Falcons ', slug: 'falcons-u13' }).name,
    ).toBe('U13 Falcons');
  });
  it('sums team records without claiming athletes are deduplicated across teams', () => {
    expect(
      summarizeTeamWorkspaces([
        {
          id: a,
          name: 'U13',
          slug: 'u13',
          tryouts: 2,
          athletes: 12,
          completedEvaluations: 23,
          coaches: 2,
        },
        {
          id: b,
          name: 'U15',
          slug: 'u15',
          tryouts: 1,
          athletes: 10,
          completedEvaluations: 9,
          coaches: 1,
        },
      ]),
    ).toEqual({ teams: 2, tryouts: 3, athletes: 22, completedEvaluations: 32 });
  });
  it('rejects malformed workspace authority responses', () => {
    expect(
      workspaceNavigationSchema.safeParse({
        isTeam: true,
        parent: { canManage: 'true' },
        workspaces: [],
      }).success,
    ).toBe(false);
  });
  it('switches using only authorized workspace entries', async () => {
    render(
      <WorkspaceSwitcher
        currentId={a}
        navigation={{
          isTeam: true,
          parent: { id: b, name: 'Falcons Club', slug: 'falcons', canManage: true },
          workspaces: [
            { id: a, name: 'U13', slug: 'falcons-u13', isTeam: true },
            { id: b, name: 'Falcons Club', slug: 'falcons', isTeam: false },
          ],
        }}
      />,
    );
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Switch workspace' }), b);
    expect(push).toHaveBeenCalledWith('/app/falcons/home');
  });
  it('does not render an unassigned sibling or parent navigation option', () => {
    render(
      <WorkspaceSwitcher
        currentId={a}
        navigation={{
          isTeam: true,
          parent: { id: b, name: 'Falcons Club', slug: 'falcons', canManage: false },
          workspaces: [{ id: a, name: 'U13', slug: 'falcons-u13', isTeam: true }],
        }}
      />,
    );
    expect(screen.getAllByRole('option')).toHaveLength(1);
    expect(screen.queryByRole('option', { name: /organization/i })).toBeNull();
  });
  it('does not offer team creation navigation inside a team', () => {
    const authorization = {
      organizationRole: 'administrator',
      assignments: [],
    } as unknown as AuthorizationContext;
    const root = buildAppNavigation({ authorization, organizationSlug: 'falcons' }).flatMap(
      (g) => g.items,
    );
    const child = buildAppNavigation({
      authorization,
      organizationSlug: 'falcons-u13',
      isTeamWorkspace: true,
    }).flatMap((g) => g.items);
    expect(root.some((i) => i.label === 'Team workspaces')).toBe(true);
    expect(child.some((i) => i.label === 'Team workspaces')).toBe(false);
  });
});
