import { afterEach, expect, test, vi } from 'vitest';
const session = vi.hoisted(() => vi.fn());
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { getSession: session } }),
}));
vi.mock('expo-secure-store', () => ({}));
vi.mock('react-native-url-polyfill/auto', () => ({}));
import { api } from '../src/client';
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
test('an account switch cannot submit a deletion request for the newly signed-in identity', async () => {
  session.mockResolvedValue({
    data: { session: { user: { id: 'new-user' }, access_token: 'new-token' } },
  });
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  await expect(api('/api/account/deletion', { confirm: true }, 'original-user')).rejects.toThrow(
    'Your account changed',
  );
  expect(fetcher).not.toHaveBeenCalled();
});
test('the verified expected identity token is used for the request', async () => {
  session.mockResolvedValue({
    data: { session: { user: { id: 'original-user' }, access_token: 'original-token' } },
  });
  vi.stubEnv('EXPO_PUBLIC_API_URL', 'https://www.tryout.agency');
  const fetcher = vi
    .fn()
    .mockResolvedValue({ ok: true, json: async () => ({ request: { id: 'request-test' } }) });
  vi.stubGlobal('fetch', fetcher);
  await api('/api/account/deletion', { confirm: true }, 'original-user');
  expect(fetcher).toHaveBeenCalledWith(
    'https://www.tryout.agency/api/account/deletion',
    expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer original-token' }),
    }),
  );
});
