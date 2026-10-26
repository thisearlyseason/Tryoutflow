// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';

import config from '../../../next.config';

afterEach(() => vi.unstubAllEnvs());

it('protects pages and API responses without blocking Turnstile or Next hydration', async () => {
  vi.stubEnv('NODE_ENV', 'production');
  const rules = await config.headers!();
  const rule = rules.find((entry) => entry.source === '/:path*')!;
  const headers = Object.fromEntries(rule.headers.map(({ key, value }) => [key, value]));
  expect(headers['X-Content-Type-Options']).toBe('nosniff');
  expect(headers['X-Frame-Options']).toBe('DENY');
  expect(headers['Content-Security-Policy']).toContain("frame-ancestors 'none'");
  expect(headers['Content-Security-Policy']).toContain("object-src 'none'");
  expect(headers['Content-Security-Policy']).toContain("base-uri 'self'");
  expect(headers['Content-Security-Policy']).not.toMatch(/script-src|default-src|frame-src/);
  expect(headers['Strict-Transport-Security']).toBe('max-age=31536000');
  expect(config.poweredByHeader).toBe(false);
});

it('does not force HTTPS for local development', async () => {
  vi.stubEnv('NODE_ENV', 'development');
  const rules = await config.headers!();
  expect(rules.flatMap((rule) => rule.headers).map((header) => header.key)).not.toContain(
    'Strict-Transport-Security',
  );
});
