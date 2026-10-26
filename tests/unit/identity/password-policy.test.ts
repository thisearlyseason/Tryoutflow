import { beforeEach, describe, expect, it, vi } from 'vitest';
const auth = vi.hoisted(() => ({ signUp: vi.fn(), updateUser: vi.fn() }));
vi.mock('../../../src/infrastructure/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(async () => ({ auth })),
}));
import { createOwnerAccount } from '../../../src/modules/identity/application/create-account';
import { resetPassword } from '../../../src/modules/identity/application/reset-password';
describe('signup and reset enforce the same approved policy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.signUp.mockResolvedValue({ error: null });
    auth.updateUser.mockResolvedValue({ error: null });
  });
  it.each([
    ['Abc12!x', false],
    ['Abc12!xy', true],
    ['ABC12!XY', false],
    ['abc12!xy', false],
    ['Abcde!xy', false],
    ['Abc123xy', false],
    ['Abc123 x', false],
    ['LongerSyntheticPassword12!', true],
    ['Aa1!' + 'X'.repeat(124), true],
    ['Aa1!' + 'X'.repeat(125), false],
  ])('validates synthetic value %s at both server boundaries', async (password, accepted) => {
    const signup = await createOwnerAccount({
      email: 'dummy@example.com',
      password,
      emailRedirectTo: 'https://example.com/auth/callback',
    });
    const reset = await resetPassword({ password });
    expect(signup.ok).toBe(accepted);
    expect(reset.ok).toBe(accepted);
    expect(auth.signUp).toHaveBeenCalledTimes(accepted ? 1 : 0);
    expect(auth.updateUser).toHaveBeenCalledTimes(accepted ? 1 : 0);
  });
});
