import '../../stubs/navigation-browser';
import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFictionalState } from '../../fixtures/full-routes/lib/state';
import { ids, readOnlyFictionalClient, type FixtureState } from './fictional-route-client';
const state = vi.hoisted(() => ({}) as FixtureState);
vi.mock('@/infrastructure/supabase/server', () => ({
  createServerSupabaseClient: async () => readOnlyFictionalClient(state),
}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('FIXTURE_NOT_FOUND');
  },
  redirect: (href: string) => {
    throw new Error(`FIXTURE_REDIRECT:${href}`);
  },
  usePathname: () => '/app/fictional/evaluate',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
import Session from '../../../src/app/(app)/app/[organizationSlug]/evaluate/session/[sessionId]/page';
import Staff from '../../../src/app/(app)/app/[organizationSlug]/tryouts/[tryoutId]/staff/page';
import PlatformHealth from '../../../src/app/(platform)/platform/health/page';
import { organizationRoutePreflight } from '../../../src/modules/organizations/application/organization-route-preflight';
beforeEach(() => Object.assign(state, createFictionalState('evaluator')));
afterEach(cleanup);
describe('actual route boundaries with synthetic durable membership', () => {
  it('opens only the assigned session and reads only current evaluator draft summaries', async () => {
    render(
      await Session({
        params: Promise.resolve({ organizationSlug: 'fictional', sessionId: ids.session }),
      }),
    );
    expect(screen.getByText('Fictional Assigned Athlete')).toBeVisible();
    expect(state.calls).toContainEqual(
      expect.objectContaining({
        table: 'evaluations',
        operation: 'eq',
        args: ['evaluator_user_id', ids.user],
      }),
    );
    expect(state.calls).toContainEqual(
      expect.objectContaining({
        table: 'evaluations',
        operation: 'eq',
        args: ['organization_id', ids.organization],
      }),
    );
  });
  it('does not turn organization ownership into a scoring assignment', async () => {
    Object.assign(state, createFictionalState('owner'));
    render(
      await Session({
        params: Promise.resolve({ organizationSlug: 'fictional', sessionId: ids.session }),
      }),
    );
    expect(screen.queryByText('Fictional Assigned Athlete')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Session unavailable' })).toBeVisible();
  });
  it('rejects cross-organization paths before the shell and rejects evaluator staffing management', async () => {
    const client = readOnlyFictionalClient(state);
    expect(
      await organizationRoutePreflight(
        client as never,
        ids.user,
        new URL('http://127.0.0.1:3201/app/foreign/home'),
      ),
    ).toBe(false);
    await expect(
      Staff({ params: Promise.resolve({ organizationSlug: 'fictional', tryoutId: ids.tryout }) }),
    ).rejects.toThrow('FIXTURE_NOT_FOUND');
  });
  it('rejects non-platform users using the original platform authority gateway', async () => {
    await expect(PlatformHealth()).rejects.toThrow('FIXTURE_NOT_FOUND');
  });
  it('gives scoped directors their permitted staffing page without organization membership controls', async () => {
    Object.assign(state, createFictionalState('director'));
    render(
      await Staff({
        params: Promise.resolve({ organizationSlug: 'fictional', tryoutId: ids.tryout }),
      }),
    );
    expect(
      screen.getByRole('heading', { name: 'Fictional U14 Tryout evaluators', level: 1 }),
    ).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Invite evaluator' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Assign evaluator' })).toBeVisible();
  });
});
