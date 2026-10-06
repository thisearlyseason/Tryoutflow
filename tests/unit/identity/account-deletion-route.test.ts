import { beforeEach, expect, it, vi } from 'vitest';
import { GET, POST } from '@/app/api/account/deletion/route';
const mocks = vi.hoisted(() => ({ context: vi.fn(), rpc: vi.fn() }));
vi.mock('@/modules/identity/application/account-request', () => ({
  accountRequestContext: mocks.context,
}));
const receipt = { id: 'request-test', dueAt: '2099-01-01T00:00:00Z', status: 'requested' };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.mockResolvedValue({ client: { rpc: mocks.rpc } });
  mocks.rpc.mockResolvedValue({ data: receipt, error: null });
});
const request = (body: unknown) =>
  new Request('https://www.tryout.agency/api/account/deletion', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
it('saves only for the authenticated identity, without accepting an account id', async () => {
  const response = await POST(request({ confirm: true }));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ request: receipt });
  expect(mocks.rpc).toHaveBeenCalledWith('request_account_deletion', { p_confirm: true });
});
it.each([{ confirm: false }, {}, { confirm: true, userId: 'someone-else' }, null])(
  'requires exact explicit confirmation %j',
  async (body) => {
    expect((await POST(request(body))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  },
);
it('returns no success when persistence fails', async () => {
  mocks.rpc.mockResolvedValue({ error: { code: 'database_error' } });
  expect((await POST(request({ confirm: true }))).status).toBe(503);
});
it.each(['unauthorized', 'forbidden'])(
  'preserves authentication/origin rejection %s',
  async (message) => {
    mocks.context.mockRejectedValue(new Error(message));
    expect((await POST(request({ confirm: true }))).status).toBe(
      message === 'unauthorized' ? 401 : 403,
    );
    expect(mocks.rpc).not.toHaveBeenCalled();
  },
);
it('rejects oversized request bodies', async () => {
  expect((await POST(request({ confirm: true, padding: 'x'.repeat(2048) }))).status).toBe(400);
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it('reads only the current account request without caching', async () => {
  const response = await GET(new Request('https://www.tryout.agency/api/account/deletion'));
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(mocks.rpc).toHaveBeenCalledWith('get_account_deletion_request');
});
