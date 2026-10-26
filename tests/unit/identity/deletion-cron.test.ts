import { afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ client: vi.fn(), send: vi.fn(), provider: vi.fn() }));
vi.mock('@/infrastructure/supabase/admin', () => ({ createAdminSupabaseClient: mocks.client }));
vi.mock('@/infrastructure/email/resend-provider', () => ({
  ResendEmailProvider: class {
    constructor() {
      mocks.provider();
    }
  },
}));
vi.mock('@/modules/identity/application/deletion-notices', () => ({
  sendDeletionNotices: mocks.send,
}));
import { GET } from '@/app/api/cron/account-deletion/route';
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
it.each([undefined, '', 'other'])(
  'rejects unauthorized calls before initializing service credentials: %s',
  async (token) => {
    vi.stubEnv('CRON_SECRET', 'test-secret');
    const result = await GET(
      new Request('https://example.test/api/cron/account-deletion', {
        headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
      }),
    );
    expect(result.status).toBe(401);
    expect(mocks.client).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  },
);
it('fails closed when the secret is missing', async () => {
  vi.stubEnv('CRON_SECRET', '');
  expect((await GET(new Request('https://example.test'))).status).toBe(401);
  expect(mocks.client).not.toHaveBeenCalled();
});
it('runs only the deletion notifier for an authorized scheduler', async () => {
  vi.stubEnv('CRON_SECRET', 'test-secret');
  mocks.send.mockResolvedValueOnce(undefined);
  const result = await GET(
    new Request('https://example.test', { headers: { authorization: 'Bearer test-secret' } }),
  );
  expect(result.status).toBe(200);
  expect(result.headers.get('cache-control')).toBe('no-store');
  expect(mocks.send).toHaveBeenCalledTimes(1);
});
it('reports failure without leaking provider errors or declaring success', async () => {
  vi.stubEnv('CRON_SECRET', 'test-secret');
  mocks.send.mockRejectedValueOnce(new Error('private provider detail'));
  const result = await GET(
    new Request('https://example.test', { headers: { authorization: 'Bearer test-secret' } }),
  );
  expect(result.status).toBe(503);
  expect(await result.json()).toEqual({ error: 'temporarily_unavailable' });
});
