import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

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
    expect(screen.queryByRole('link', { name: 'Evaluator team' })).not.toBeInTheDocument();

    rerender(
      <OrganizationNavigation
        authorization={{ ...scopedDirector, organizationRole: 'owner', assignments: [] }}
        organizationSlug="badlands"
      />,
    );
    expect(screen.getByRole('link', { name: 'Evaluator team' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Integrations' })).toHaveAttribute(
      'href',
      '/app/badlands/organization/integrations',
    );
    expect(screen.queryByRole('link', { name: /Staff for tryout/ })).not.toBeInTheDocument();
  });

  it('gives an actively assigned evaluator a discoverable scoring destination only', () => {
    render(<OrganizationNavigation authorization={scopedEvaluator} organizationSlug="badlands" />);
    expect(screen.getByRole('link', { name: 'My scoring' })).toHaveAttribute(
      'href',
      '/app/badlands/evaluate',
    );
    expect(screen.queryByRole('link', { name: 'Athletes' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Staff for tryout/ })).not.toBeInTheDocument();
  });

  it('gives an actively assigned reviewer the exact tryout report destination without organization reports', () => {
    render(<OrganizationNavigation authorization={scopedReviewer} organizationSlug="badlands" />);
    expect(
      screen.getByRole('link', { name: `Share Results for tryout ${tryoutId}` }),
    ).toHaveAttribute('href', `/app/badlands/tryouts/${tryoutId}/reports`);
    expect(screen.queryByRole('link', { name: 'Reports' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Athletes' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'My scoring' })).not.toBeInTheDocument();
  });
});

describe('concurrent shell branding and fresh authority', () => {
  const organization = { id: organizationId, name: 'Fictional QA', slug: 'fictional-qa' };
  const logoUrl = '/api/organizations/fictional-qa/logo?v=2026-10-29T12%3A00%3A00Z';
  it('starts both reads together but exposes nothing until authority completes', async () => {
    let authorize!: (value: AuthorizationContext | null) => void;
    const findAuthorizationContext = vi.fn(
      () =>
        new Promise<AuthorizationContext | null>((resolve) => {
          authorize = resolve;
        }),
    );
    const loadOrganizationLogoUrl = vi.fn(async () => logoUrl);
    let completed = false;
    const pending = resolveOrganizationRouteContext(organization.slug, userId, {
      findOrganizationShellBySlug: async () => organization,
      findAuthorizationContext,
      loadOrganizationLogoUrl,
    }).then((result) => {
      completed = true;
      return result;
    });
    await vi.waitFor(() => expect(findAuthorizationContext).toHaveBeenCalledOnce());
    expect(loadOrganizationLogoUrl).toHaveBeenCalledExactlyOnceWith(organization);
    expect(completed).toBe(false);
    authorize(scopedDirector);
    expect(await pending).toEqual({
      organization: { ...organization, logoUrl },
      authorization: scopedDirector,
      userId,
    });
  });
  it.each([
    null,
    { ...scopedDirector, organizationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' as OrganizationId },
  ])('does not expose branding for denied or foreign authority', async (authorization) => {
    await expect(
      resolveOrganizationRouteContext(organization.slug, userId, {
        findOrganizationShellBySlug: async () => organization,
        findAuthorizationContext: async () => authorization,
        loadOrganizationLogoUrl: async () => logoUrl,
      }),
    ).resolves.toBeNull();
  });
  it('reads authority again after revocation instead of reusing the previous result', async () => {
    const findAuthorizationContext = vi
      .fn()
      .mockResolvedValueOnce(scopedDirector)
      .mockResolvedValueOnce(null);
    const gateway = {
      findOrganizationShellBySlug: async () => organization,
      findAuthorizationContext,
      loadOrganizationLogoUrl: async () => logoUrl,
    };
    expect(
      await resolveOrganizationRouteContext(organization.slug, userId, gateway),
    ).not.toBeNull();
    expect(await resolveOrganizationRouteContext(organization.slug, userId, gateway)).toBeNull();
    expect(findAuthorizationContext).toHaveBeenCalledTimes(2);
  });
  it('does not request branding or authority for an unavailable organization', async () => {
    const findAuthorizationContext = vi.fn(async () => scopedDirector);
    const loadOrganizationLogoUrl = vi.fn(async () => logoUrl);
    expect(
      await resolveOrganizationRouteContext(organization.slug, userId, {
        findOrganizationShellBySlug: async () => null,
        findAuthorizationContext,
        loadOrganizationLogoUrl,
      }),
    ).toBeNull();
    expect(findAuthorizationContext).not.toHaveBeenCalled();
    expect(loadOrganizationLogoUrl).not.toHaveBeenCalled();
  });
  it('does not turn an authorization outage into access when branding succeeds', async () => {
    await expect(
      resolveOrganizationRouteContext(organization.slug, userId, {
        findOrganizationShellBySlug: async () => organization,
        findAuthorizationContext: async () => {
          throw new Error('authority unavailable');
        },
        loadOrganizationLogoUrl: async () => logoUrl,
      }),
    ).rejects.toThrow('authority unavailable');
  });
});
