import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AppShell } from '@/components/layout/app-shell';
import { AppNavigation } from '@/components/layout/app-navigation';
import { MobileNav } from '@/components/layout/mobile-nav';
import { buildAppNavigation } from '@/modules/organizations/components/app-navigation-model';
import type { AuthorizationContext } from '@/modules/organizations/application/capabilities';

const location = vi.hoisted(() => ({ path: '/app/fixture/home' }));
vi.mock('next/navigation', () => ({
  usePathname: () => location.path,
  useSearchParams: () => new URLSearchParams(),
}));
const organization = { name: 'Fixture organization', slug: 'fixture' };
const groups = buildAppNavigation({
  authorization: { organizationRole: 'owner', assignments: [] } as unknown as AuthorizationContext,
  organizationSlug: 'fixture',
});
describe('task area shell', () => {
  it('shows five persistent task areas and discloses administration on demand', async () => {
    location.path = '/app/fixture/home';
    render(<AppNavigation groups={groups} organization={organization} roleLabel="Owner" />);
    const nav = screen.getByRole('navigation', { name: 'Primary navigation' });
    expect(nav.querySelector('details')).not.toHaveAttribute('open');
    expect(
      within(within(nav).getByRole('region', { name: 'Workspace' }))
        .getAllByRole('link')
        .map((e) => e.textContent),
    ).toEqual(['Home', 'Tryouts', 'Athletes', 'People', 'Reports']);
    await userEvent.click(within(nav).getByText('Workspace tools'));
    expect(within(nav).getByRole('link', { name: 'Billing' })).toBeVisible();
    expect(within(nav).getByRole('link', { name: 'Settings' })).toBeVisible();
  });
  it('opens administration automatically on a direct tool link', () => {
    location.path = '/app/fixture/organization/settings';
    render(<AppNavigation groups={groups} organization={organization} roleLabel="Owner" />);
    expect(
      within(screen.getByRole('navigation', { name: 'Primary navigation' })).getByRole('link', {
        name: 'Settings',
      }),
    ).toHaveAttribute('aria-current', 'page');
  });
  it.each([
    [
      '/app/fixture/scouting',
      'Athlete tools',
      ['Athletes', 'Scouting', 'Performance'],
      'Scouting',
      'Athletes',
    ],
    [
      '/app/fixture/organization/members',
      'People tools',
      ['People', 'Evaluators', 'Members', 'Participant access'],
      'Members',
      'People',
    ],
  ])('orients direct route %s within its task area', (path, label, links, current, parent) => {
    location.path = path;
    render(
      <AppShell navigation={groups} organization={organization} roleLabel="Owner">
        <h1>Tool</h1>
      </AppShell>,
    );
    const context = screen.getByRole('navigation', { name: label });
    expect(
      within(context)
        .getAllByRole('link')
        .map((e) => e.textContent),
    ).toEqual(links);
    expect(within(context).getByRole('link', { name: current })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(
      within(screen.getByRole('navigation', { name: 'Primary navigation' })).getByRole('link', {
        name: parent,
      }),
    ).not.toHaveAttribute('aria-current', 'page');
  });
  it('keeps contextual tools out of unrelated pages and roles', () => {
    location.path = '/app/fixture/home';
    render(
      <AppShell navigation={groups} organization={organization} roleLabel="Owner">
        Home
      </AppShell>,
    );
    expect(screen.queryByRole('navigation', { name: 'Athlete tools' })).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'People tools' })).toBeNull();
  });
  it('provides direct mobile help and all grouped destinations in More', async () => {
    render(
      <MobileNav
        groups={groups}
        organization={organization}
        roleLabel="Owner"
        pathname="/app/fixture/home"
      />,
    );
    expect(screen.getByRole('link', { name: 'Help and guides' })).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Upgrade & billing' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'More navigation' }));
    const dialog = screen.getByRole('dialog', { name: 'Workspace navigation' });
    for (const label of [
      'People',
      'Scouting',
      'Performance',
      'Members',
      'Participant access',
      'Billing',
    ])
      expect(within(dialog).getByRole('link', { name: label })).toBeVisible();
  });
});
