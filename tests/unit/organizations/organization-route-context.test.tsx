import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { OrganizationId, UserId } from '../../../src/lib/ids';
import type { AuthorizationContext } from '../../../src/modules/organizations/application/capabilities';
import {
  canManageTryoutStaffing,
  resolveOrganizationRouteContext,
} from '../../../src/modules/organizations/application/organization-route-context';
import { OrganizationNavigation } from '../../../src/modules/organizations/components/organization-navigation';

const organizationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' as OrganizationId;
const userId = '11111111-1111-4111-8111-111111111111' as UserId;
const tryoutId = '33333333-3333-4333-8333-333333333333';
const sessionId = '55555555-5555-4555-8555-555555555555';

const scopedDirector: AuthorizationContext = {
  userId,
  organizationId,
  organizationRole: 'member',
  membershipStatus: 'active',
  assignments: [{ role: 'director', scope: { kind: 'session', tryoutId, sessionId } }],
};

const scopedEvaluator: AuthorizationContext = {
  userId,
  organizationId,
  organizationRole: 'member',
  membershipStatus: 'active',
  assignments: [{ role: 'evaluator', scope: { kind: 'session', tryoutId, sessionId } }],
};

const scopedReviewer: AuthorizationContext = {
  userId,
  organizationId,
  organizationRole: 'member',
  membershipStatus: 'active',
  assignments: [{ role: 'reviewer', scope: { kind: 'session', tryoutId, sessionId } }],
};

describe('least-privileged organization route context', () => {
  it('loads only safe shell fields for an active scoped director with a known slug', async () => {
    const result = await resolveOrganizationRouteContext('badlands', userId, {
      findOrganizationShellBySlug: async () => ({
        id: organizationId,
        name: 'Badlands Hockey',
        slug: 'badlands',
      }),
      findAuthorizationContext: async () => scopedDirector,
    });

    expect(result).toEqual({
      organization: { id: organizationId, name: 'Badlands Hockey', slug: 'badlands' },
      authorization: scopedDirector,
      userId,
    });
    expect(result).not.toHaveProperty('organization.timezone');
    expect(canManageTryoutStaffing(scopedDirector, tryoutId)).toBe(true);
  });

  it('rejects a known cross-tenant slug, inactive membership, and revoked assignment context', async () => {
    const missing = {
      findOrganizationShellBySlug: async () => null,
      findAuthorizationContext: async () => null,
    };
    await expect(
      resolveOrganizationRouteContext('other-tenant', userId, missing),
    ).resolves.toBeNull();

    await expect(
      resolveOrganizationRouteContext('badlands', userId, {
        findOrganizationShellBySlug: async () => ({
          id: organizationId,
          name: 'Badlands',
          slug: 'badlands',
        }),
        findAuthorizationContext: async () => null,
      }),
    ).resolves.toBeNull();

    expect(canManageTryoutStaffing({ ...scopedDirector, assignments: [] }, tryoutId)).toBe(false);
  });

  it('shows restricted directors only exact staff destinations and owners the evaluator directory', () => {
    const { rerender } = render(
      <OrganizationNavigation authorization={scopedDirector} organizationSlug="badlands" />,
    );
    expect(screen.getByRole('link', { name: `Staff for tryout ${tryoutId}` })).toHaveAttribute(
      'href',
      `/app/badlands/tryouts/${tryoutId}/staff`,
    );
    expect(screen.queryByRole('link', { name: 'Athletes' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Evaluators' })).not.toBeInTheDocument();

    rerender(
      <OrganizationNavigation
        authorization={{ ...scopedDirector, organizationRole: 'owner', assignments: [] }}
        organizationSlug="badlands"
      />,
    );
    expect(screen.getByRole('link', { name: 'Evaluators' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Integrations' })).toHaveAttribute(
      'href',
      '/app/badlands/organization/integrations',
    );
    expect(screen.queryByRole('link', { name: /Staff for tryout/ })).not.toBeInTheDocument();
  });

  it('gives an actively assigned evaluator a discoverable scoring destination only', () => {
    render(<OrganizationNavigation authorization={scopedEvaluator} organizationSlug="badlands" />);
    expect(screen.getByRole('link', { name: 'Evaluate' })).toHaveAttribute(
      'href',
      '/app/badlands/evaluate',
    );
    expect(screen.queryByRole('link', { name: 'Athletes' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Staff for tryout/ })).not.toBeInTheDocument();
  });

  it('gives an actively assigned reviewer the exact tryout report destination without organization reports', () => {
    render(<OrganizationNavigation authorization={scopedReviewer} organizationSlug="badlands" />);
    expect(screen.getByRole('link', { name: `Reports for tryout ${tryoutId}` })).toHaveAttribute(
      'href',
      `/app/badlands/tryouts/${tryoutId}/reports`,
    );
    expect(screen.queryByRole('link', { name: 'Reports' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Athletes' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Evaluate' })).not.toBeInTheDocument();
  });
});
