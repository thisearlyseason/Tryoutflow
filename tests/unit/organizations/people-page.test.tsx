import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import PeoplePage from '@/app/(app)/app/[organizationSlug]/people/page';
const mocks = vi.hoisted(() => ({ current: vi.fn() }));
vi.mock('@/modules/organizations/application/current-organization', () => ({
  requireCurrentOrganization: mocks.current,
}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
}));
describe('People discovery page', () => {
  it.each(['owner', 'administrator'])(
    'shows only existing staff and participant destinations for %s',
    async (role) => {
      mocks.current.mockResolvedValue({
        organization: { slug: 'fixture' },
        authorization: { organizationRole: role },
      });
      render(await PeoplePage({ params: Promise.resolve({ organizationSlug: 'fixture' }) }));
      expect(screen.getByRole('heading', { name: 'People', level: 1 })).toBeVisible();
      expect(
        screen
          .getAllByRole('link')
          .map((e) => e.getAttribute('href'))
          .sort(),
      ).toEqual(
        [
          '/app/fixture/evaluators',
          '/app/fixture/organization/members',
          '/app/fixture/participants',
        ].sort(),
      );
      expect(screen.getByText(/Invite staff first/i)).toBeVisible();
    },
  );
  it.each(['member', 'director', 'reviewer'])(
    'rejects a direct entry for nonmanager %s',
    async (role) => {
      mocks.current.mockResolvedValue({
        authorization: {
          organizationRole: 'member',
          assignments:
            role === 'member' ? [] : [{ role, scope: { kind: 'tryout', tryoutId: 'fixture' } }],
        },
      });
      await expect(
        PeoplePage({ params: Promise.resolve({ organizationSlug: 'fixture' }) }),
      ).rejects.toThrow('NOT_FOUND');
    },
  );
});
