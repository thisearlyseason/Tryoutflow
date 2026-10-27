import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  user: { id: 'fictional-user' } as { id: string } | null,
  memberships: { data: [{ organization_id: 'fictional-org' }], error: null as object | null },
  organizations: {
    data: [{ id: 'fictional-org', slug: 'fictional', name: 'Fictional Club' }],
    error: null as object | null,
  },
  eq: vi.fn(),
  in: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  redirect: (href: string) => {
    throw new Error(`redirect:${href}`);
  },
}));
vi.mock('../../../src/infrastructure/supabase/server', () => ({
  createServerSupabaseClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    from: (table: string) => {
      if (table === 'organization_members') {
        const query = {
          select: () => query,
          eq: (...args: unknown[]) => {
            state.eq(...args);
            return query;
          },
          order: () => query,
          then: (resolve: (value: unknown) => void) => resolve(state.memberships),
        };
        return query;
      }
      return {
        select: () => ({
          in: (...args: unknown[]) => {
            state.in(...args);
            return Promise.resolve(state.organizations);
          },
        }),
      };
    },
  }),
}));
import AppLandingPage from '../../../src/app/(app)/app/page';

beforeEach(() => {
  state.user = { id: 'fictional-user' };
  state.memberships = { data: [{ organization_id: 'fictional-org' }], error: null };
  state.organizations = {
    data: [{ id: 'fictional-org', slug: 'fictional', name: 'Fictional Club' }],
    error: null,
  };
  state.eq.mockClear();
  state.in.mockClear();
});
describe('intentional organization entry', () => {
  it('requires authentication and constrains lookup to active own memberships', async () => {
    await expect(AppLandingPage()).rejects.toThrow('redirect:/app/fictional/home');
    expect(state.eq).toHaveBeenCalledWith('user_id', 'fictional-user');
    expect(state.eq).toHaveBeenCalledWith('status', 'active');
    expect(state.in).toHaveBeenCalledWith('id', ['fictional-org']);
    state.user = null;
    await expect(AppLandingPage()).rejects.toThrow('redirect:/sign-in');
  });
  it('offers only returned organizations when more than one is available', async () => {
    state.memberships.data.push({ organization_id: 'fictional-org-2' });
    state.organizations.data.push({
      id: 'fictional-org-2',
      slug: 'fictional-two',
      name: 'Fictional Second Club',
    });
    render(await AppLandingPage());
    expect(screen.getByRole('heading', { name: 'Choose your organization' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Open Fictional Second Club' })).toHaveAttribute(
      'href',
      '/app/fictional-two/home',
    );
  });
  it('distinguishes loading failure from no memberships instead of creating an organization', async () => {
    state.memberships.error = { message: 'fictional failure' };
    render(await AppLandingPage());
    expect(
      screen.getByRole('heading', { name: 'We could not load your organizations' }),
    ).toBeVisible();
    expect(state.in).not.toHaveBeenCalled();
    state.memberships.error = null;
    state.memberships.data = [];
    await expect(AppLandingPage()).rejects.toThrow('redirect:/participant');
    expect(state.in).not.toHaveBeenCalled();
  });
});
