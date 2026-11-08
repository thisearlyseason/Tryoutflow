import { beforeEach, describe, expect, it, vi } from 'vitest';
const auth = vi.hoisted(() => ({ getUser: vi.fn(), from: vi.fn() }));
vi.mock('@/infrastructure/supabase/server', () => ({
  createServerSupabaseClient: async () => ({ auth: { getUser: auth.getUser }, from: auth.from }),
}));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
import { requireParticipantContext } from '@/modules/registration/application/participant-context';
beforeEach(() => vi.clearAllMocks());
describe('family session context', () => {
  it('accepts a verified adult identity without querying organization membership', async () => {
    auth.getUser.mockResolvedValue({
      data: { user: { id: 'family-user', email: 'family@example.test' } },
      error: null,
    });
    expect((await requireParticipantContext()).user.id).toBe('family-user');
    expect(auth.from).not.toHaveBeenCalled();
  });
  it.each([
    { data: { user: null }, error: null },
    { data: { user: { id: 'stale' } }, error: { message: 'expired' } },
  ])('rejects a missing or unverified session', async (result) => {
    auth.getUser.mockResolvedValue(result);
    await expect(requireParticipantContext()).rejects.toThrow(
      'REDIRECT:/sign-in?next=/participant',
    );
    expect(auth.from).not.toHaveBeenCalled();
  });
});
