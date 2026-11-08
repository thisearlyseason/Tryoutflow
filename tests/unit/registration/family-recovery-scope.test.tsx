import { it, expect, vi, beforeEach } from 'vitest';
const mocks = vi.hoisted(() => ({ user: vi.fn(), rpc: vi.fn() }));
vi.mock('@/infrastructure/supabase/server', () => ({
  createServerSupabaseClient: async () => ({ auth: { getUser: mocks.user }, rpc: mocks.rpc }),
}));
import Page from '@/app/(registration)/register/[tryoutSlug]/page';
const athlete = '22222222-2222-4222-8222-222222222222';
beforeEach(() => vi.clearAllMocks());
it('binds linked recovery context to the freshly verified user and authorized athlete', async () => {
  mocks.user.mockResolvedValue({ data: { user: { id: 'verified-user' } } });
  mocks.rpc.mockResolvedValue({
    data: { givenName: 'Jordan', familyName: 'Lee', birthDate: '2012-01-01' },
    error: null,
  });
  const element = await Page({
    params: Promise.resolve({ tryoutSlug: 'camp' }),
    searchParams: Promise.resolve({ athlete }),
  });
  expect(element.props.recoveryContext).toBe(`linked:verified-user:${athlete}`);
  expect(mocks.rpc).toHaveBeenCalledWith('participant_registration_prefill', {
    p_tryout_slug: 'camp',
    p_athlete_id: athlete,
  });
});
it('uses public context when signed out or linked prefill is not authorized', async () => {
  mocks.user.mockResolvedValue({ data: { user: null } });
  let element = await Page({
    params: Promise.resolve({ tryoutSlug: 'camp' }),
    searchParams: Promise.resolve({ athlete }),
  });
  expect(element.props.recoveryContext).toBe('public');
  expect(element.props.prefill).toBeUndefined();
  expect(mocks.rpc).not.toHaveBeenCalled();
  mocks.user.mockResolvedValue({ data: { user: { id: 'verified-user' } } });
  mocks.rpc.mockResolvedValue({ data: null, error: { code: '42501' } });
  element = await Page({
    params: Promise.resolve({ tryoutSlug: 'camp' }),
    searchParams: Promise.resolve({ athlete }),
  });
  expect(element.props.recoveryContext).toBe('public');
  expect(element.props.prefill).toBeUndefined();
});
