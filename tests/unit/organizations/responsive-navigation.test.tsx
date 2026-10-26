import '../../stubs/navigation-browser';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from '../../../src/components/layout/app-shell';
import { AppNavigation } from '../../../src/components/layout/app-navigation';
import { MobileNav } from '../../../src/components/layout/mobile-nav';
import {
  buildAppNavigation,
  flattenNavigation,
  type NavigationGroup,
} from '../../../src/modules/organizations/components/app-navigation-model';
import type { AuthorizationContext } from '../../../src/modules/organizations/application/capabilities';
import type { OrganizationId, UserId } from '../../../src/lib/ids';

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/app/fixture/home',
}));
const groups: NavigationGroup[] = [
  {
    id: 'overview',
    label: 'Overview',
    items: [{ href: '/app/fixture/home', label: 'Home', icon: 'home' }],
  },
];
const organization = { name: 'Fixture organization', slug: 'fixture' };
const props = { groups, organization, roleLabel: 'Evaluator' };
afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});
describe('responsive workspace navigation', () => {
  it('collapses, restores keyboard focus, and persists the desktop preference', async () => {
    const view = render(<AppNavigation {...props} />);
    await userEvent.click(screen.getByRole('button', { name: 'Collapse navigation' }));
    expect(document.querySelector('.app-sidebar')).toHaveAttribute('data-collapsed', 'true');
    expect(screen.getByRole('button', { name: 'Expand navigation' })).toHaveFocus();
    expect(localStorage.getItem('tryoutflow.navigation.collapsed')).toBe('true');
    view.unmount();
    render(<AppNavigation {...props} />);
    await userEvent.click(screen.getByRole('button', { name: 'Expand navigation' }));
    expect(document.querySelector('.app-sidebar')).toHaveAttribute('data-collapsed', 'false');
    expect(screen.getByRole('button', { name: 'Collapse navigation' })).toHaveFocus();
  });
  it('works when local storage is blocked', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw Error('blocked');
    });
    render(<AppNavigation {...props} />);
    await userEvent.click(screen.getByRole('button', { name: 'Collapse navigation' }));
    expect(screen.getByRole('button', { name: 'Expand navigation' })).toHaveFocus();
  });
  it('opens all authorized links even for a single-link role and restores focus on Escape', async () => {
    render(<MobileNav {...props} pathname="/app/fixture/home" />);
    const trigger = screen.getByRole('button', { name: 'More navigation' });
    await userEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Workspace navigation' });
    expect(dialog).toHaveAttribute('open');
    expect(screen.getByRole('button', { name: 'Close navigation' })).toHaveFocus();
    expect(document.body.style.overflow).toBe('hidden');
    expect(dialog.querySelector('a[href="/app/fixture/home"]')).not.toBeNull();
    expect(dialog.textContent).not.toContain('Billing');
    fireEvent(dialog, new Event('cancel', { bubbles: false, cancelable: true }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(trigger).toHaveFocus();
    expect(document.body.style.overflow).toBe('');
  });
  it('closes on route change and orientation change', async () => {
    const view = render(<MobileNav {...props} pathname="/app/fixture/home" />);
    await userEvent.click(screen.getByRole('button', { name: 'More navigation' }));
    view.rerender(<MobileNav {...props} pathname="/app/fixture/evaluate" />);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await userEvent.click(screen.getByRole('button', { name: 'More navigation' }));
    fireEvent(window, new Event('orientationchange'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
  it.each([true, false])(
    'closes at the desktop breakpoint and focuses the visible control (collapsed=%s)',
    async (collapsed) => {
      let desktop = false;
      let onChange: (() => void) | undefined;
      vi.spyOn(window, 'matchMedia').mockImplementation(
        (query) =>
          ({
            get matches() {
              return desktop;
            },
            media: query,
            addEventListener: (_type: string, callback: EventListenerOrEventListenerObject) => {
              onChange = callback as () => void;
            },
            removeEventListener: vi.fn(),
          }) as unknown as MediaQueryList,
      );
      localStorage.setItem('tryoutflow.navigation.collapsed', String(collapsed));
      render(<AppNavigation {...props} />);
      const trigger = screen.getByRole('button', { name: 'More navigation' });
      await userEvent.click(trigger);
      desktop = true;
      act(() => onChange?.());
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(trigger).not.toHaveFocus();
      expect(
        screen.getByRole('button', {
          name: collapsed ? 'Expand navigation' : 'Collapse navigation',
        }),
      ).toHaveFocus();
      expect(document.body.style.overflow).toBe('');
    },
  );
  it('keeps account and sign-out available to members without navigation permissions', async () => {
    render(<MobileNav {...props} groups={[]} pathname="/app/fixture/home" />);
    await userEvent.click(screen.getByRole('button', { name: 'More navigation' }));
    expect(screen.getByRole('link', { name: 'Account' })).toHaveAttribute(
      'href',
      '/app/fixture/account',
    );
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Home' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Billing' })).toBeNull();
  });
  it('does not add a sidebar to shells without grouped navigation or hide game controls', () => {
    render(
      <AppShell mode="game-day">
        <button>Record score</button>
      </AppShell>,
    );
    expect(document.querySelector('.app-sidebar')).toBeNull();
    expect(screen.getByRole('button', { name: 'Record score' })).toBeVisible();
  });
});

const scopedAuthorization: AuthorizationContext = {
  userId: 'user' as UserId,
  organizationId: 'org' as OrganizationId,
  organizationRole: 'member',
  membershipStatus: 'active',
  assignments: [
    { role: 'director', scope: { kind: 'session', tryoutId: 'one', sessionId: 'session' } },
  ],
};
function namedGroups(name: string) {
  return buildAppNavigation({
    authorization: scopedAuthorization,
    organizationSlug: 'fixture',
    tryoutNames: { one: name },
  });
}
describe('mobile compact actions preserve full identity', () => {
  it.each(['Z'.repeat(160), 'National Selection Camp Under Fifteen Final Assessment'])(
    'uses compact primary text with full accessible names and More destinations: %s',
    async (name) => {
      const scoped = namedGroups(name);
      const items = flattenNavigation(scoped);
      render(
        <MobileNav {...props} groups={scoped} roleLabel="Director" pathname={items[0]!.href} />,
      );
      const navigation = screen.getByRole('navigation', { name: 'Mobile navigation' });
      const primary = within(navigation).getAllByRole('link');
      expect(primary.map((link) => link.textContent?.trim())).toEqual([
        'Run Tryout',
        'Staff',
        'Review Results',
      ]);
      expect(primary.map((link) => link.getAttribute('href'))).toEqual(
        items.slice(0, 3).map((item) => item.href),
      );
      items
        .slice(0, 3)
        .forEach((item) =>
          expect(
            within(navigation).getByRole('link', { name: item.accessibleLabel }),
          ).toHaveAttribute('href', item.href),
        );
      expect(primary[0]).toHaveAttribute('aria-current', 'page');
      expect(within(navigation).getByText(organization.name)).toBeVisible();
      expect(within(navigation).getByText('Director')).toBeVisible();
      await userEvent.click(within(navigation).getByRole('button', { name: 'More navigation' }));
      const dialog = screen.getByRole('dialog', { name: 'Workspace navigation' });
      for (const item of items) {
        const link = within(dialog).getByRole('link', { name: item.accessibleLabel });
        expect(link).toHaveTextContent(item.label);
        expect(link).toHaveAttribute('href', item.href);
      }
      expect(within(dialog).queryByRole('link', { name: 'Billing' })).toBeNull();
    },
  );
  it('falls back to full visual and accessible identity when compactLabel is undefined', () => {
    const label = 'Full custom workspace identity';
    render(
      <MobileNav
        {...props}
        groups={[
          {
            id: 'custom',
            label: 'Custom',
            items: [{ label, href: '/app/fixture/custom', icon: 'reports' }],
          },
        ]}
        pathname="/app/fixture/custom"
      />,
    );
    const link = screen.getByRole('link', { name: label });
    expect(link).toHaveTextContent(label);
    expect(link).toHaveAttribute('href', '/app/fixture/custom');
  });
  it('keeps owner primary actions, organization identity and billing route unchanged', () => {
    const owner = buildAppNavigation({
      authorization: { ...scopedAuthorization, organizationRole: 'owner', assignments: [] },
      organizationSlug: 'fixture',
      tryoutNames: { one: 'Z'.repeat(160) },
    });
    render(<MobileNav {...props} groups={owner} roleLabel="Owner" pathname="/app/fixture/home" />);
    const navigation = screen.getByRole('navigation', { name: 'Mobile navigation' });
    const primary = within(navigation)
      .getAllByRole('link')
      .filter((link) => !link.getAttribute('href')?.endsWith('/organization/billing'));
    expect(primary.map((link) => link.textContent?.trim())).toEqual([
      'Home',
      'Tryouts',
      'Athletes',
    ]);
    expect(primary.map((link) => link.getAttribute('href'))).toEqual([
      '/app/fixture/home',
      '/app/fixture/tryouts',
      '/app/fixture/athletes',
    ]);
    expect(within(navigation).getByText(organization.name)).toBeVisible();
    expect(within(navigation).getByText('Owner')).toBeVisible();
    expect(within(navigation).getByRole('link', { name: 'Billing' })).toHaveAttribute(
      'href',
      '/app/fixture/organization/billing',
    );
  });
  it('keeps full scoped names in the sidebar', () => {
    const scoped = namedGroups('Long Named Regional Selection Tryout');
    render(<AppNavigation {...props} groups={scoped} roleLabel="Director" />);
    const sidebar = screen.getByRole('navigation', { name: 'Primary navigation' });
    for (const item of flattenNavigation(scoped)) {
      const link = within(sidebar).getByRole('link', { name: item.accessibleLabel });
      expect(link).toHaveTextContent(item.label);
      expect(link).toHaveAttribute('href', item.href);
    }
  });
});
