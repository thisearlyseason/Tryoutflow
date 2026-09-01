import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { OrganizationId, UserId } from '../../../src/lib/ids';
import { AppShell } from '../../../src/components/layout/app-shell';
import type { AuthorizationContext } from '../../../src/modules/organizations/application/capabilities';
import {
  buildAppNavigation,
  flattenNavigation,
} from '../../../src/modules/organizations/components/app-navigation-model';
import { MobileNav } from '../../../src/components/layout/mobile-nav';

const organizationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' as OrganizationId;
const userId = '11111111-1111-4111-8111-111111111111' as UserId;
const tryoutId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

vi.mock('next/navigation', () => ({ usePathname: () => '/app/badlands/home' }));

function authorization(
  input: Pick<AuthorizationContext, 'organizationRole' | 'assignments'>,
): AuthorizationContext {
  return {
    userId,
    organizationId,
    membershipStatus: 'active',
    ...input,
  };
}

describe('role-aware application navigation', () => {
  it('groups owner operations and organization controls without duplicating destinations', () => {
    const groups = buildAppNavigation({
      authorization: authorization({ organizationRole: 'owner', assignments: [] }),
      organizationSlug: 'badlands',
    });

    expect(groups.map(({ label }) => label)).toEqual(['Overview', 'Operations', 'Organization']);
    expect(flattenNavigation(groups)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'Home', href: '/app/badlands/home' }),
        expect.objectContaining({ label: 'Tryouts', href: '/app/badlands/tryouts' }),
        expect.objectContaining({ label: 'Billing', href: '/app/badlands/organization/billing' }),
      ]),
    );
    expect(new Set(flattenNavigation(groups).map(({ href }) => href)).size).toBe(
      flattenNavigation(groups).length,
    );
  });

  it('gives evaluators only their authorized evaluation entry point', () => {
    const groups = buildAppNavigation({
      authorization: authorization({
        organizationRole: 'member',
        assignments: [
          {
            role: 'evaluator',
            scope: { kind: 'tryout', tryoutId },
          },
        ],
      }),
      organizationSlug: 'badlands',
    });

    expect(flattenNavigation(groups)).toEqual([
      expect.objectContaining({ label: 'Evaluate', href: '/app/badlands/evaluate' }),
    ]);
  });

  it('keeps check-in links exact and never exposes owner-only billing', () => {
    const groups = buildAppNavigation({
      authorization: authorization({
        organizationRole: 'member',
        assignments: [{ role: 'checkin', scope: { kind: 'tryout', tryoutId } }],
      }),
      organizationSlug: 'badlands',
    });
    const items = flattenNavigation(groups);

    expect(items).toEqual([
      expect.objectContaining({
        label: 'Check-in',
        href: `/app/badlands/tryouts/${tryoutId}/check-in`,
      }),
    ]);
    expect(items).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ label: 'Billing' })]),
    );
  });

  it('renders organization identity, role, grouped desktop navigation, and mobile controls', () => {
    const groups = buildAppNavigation({
      authorization: authorization({ organizationRole: 'owner', assignments: [] }),
      organizationSlug: 'badlands',
    });
    render(
      <AppShell
        navigation={groups}
        organization={{ name: 'Badlands Hockey Academy', slug: 'badlands' }}
        roleLabel="Owner"
      >
        <h1>Operations overview</h1>
      </AppShell>,
    );

    expect(screen.getAllByText('Badlands Hockey Academy').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Owner').length).toBeGreaterThan(0);
    expect(screen.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible();
    expect(screen.getByRole('navigation', { name: 'Mobile navigation' })).toBeVisible();
    expect(screen.getAllByRole('link', { name: 'Home' })[0]).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('groups secondary mobile destinations without presenting category numbers as workflow steps', async () => {
    const groups = buildAppNavigation({
      authorization: authorization({ organizationRole: 'owner', assignments: [] }),
      organizationSlug: 'badlands',
    });
    render(
      <MobileNav
        groups={groups}
        organization={{ name: 'Badlands Hockey Academy', slug: 'badlands' }}
        pathname="/app/badlands/home"
        roleLabel="Owner"
      />,
    );

    const more = screen.getByRole('button', { name: 'More navigation' });
    expect(more).toBeVisible();
    await userEvent.click(more);
    expect(screen.getByRole('heading', { name: 'Operations' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Organization' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Close navigation' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeVisible();
    expect(screen.queryByText('01')).not.toBeInTheDocument();
    expect(screen.queryByText('06')).not.toBeInTheDocument();
  });
});
