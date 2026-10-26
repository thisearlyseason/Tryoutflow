// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { register } from '../../fixtures/full-routes/instrumentation';
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe('fictional route fixture network boundary', () => {
  it('rejects external transport before dispatch', async () => {
    const transport = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', transport);
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    register();
    await expect(fetch('https://example.test')).rejects.toThrow('denied');
    expect(transport).not.toHaveBeenCalled();
  });
  it('restricts local dispatch to owned port and prevents following redirects', async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response('', { status: 302, headers: { location: 'https://example.test' } }),
      );
    vi.stubGlobal('fetch', transport);
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    register();
    await expect(fetch('http://127.0.0.1:54321')).rejects.toThrow('denied');
    await fetch('http://127.0.0.1:3201/api/public/registrations', { redirect: 'follow' });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport).toHaveBeenCalledWith(
      'http://127.0.0.1:3201/api/public/registrations',
      expect.objectContaining({ redirect: 'error' }),
    );
  });
});
