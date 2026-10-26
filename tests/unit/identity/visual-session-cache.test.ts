// @vitest-environment node
import {
  chmodSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Cookie } from '@playwright/test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  demoEmail,
  readVisualSession,
  reserveVisualSessionBootstrap,
  writeVisualSession,
  verifyVisualSession,
  visualUserOnlyFetch,
  type VisualSessionBinding,
} from '../../e2e/helpers/visual-session-cache';

const now = 1_800_000_000_000;
const binding: VisualSessionBinding = {
  runId: 'visual_run_123456',
  project: 'tryoutflow-lint-verify-123456abcdef',
  proofSHA256: 'a'.repeat(64),
  appOrigin: 'http://127.0.0.1:3112',
  apiOrigin: 'http://127.0.0.1:54321',
  email: demoEmail,
};
const cookies: Cookie[] = [
  {
    name: 'sb-127-auth-token',
    value: 'synthetic-unit-session',
    domain: '127.0.0.1',
    path: '/',
    expires: -1,
    httpOnly: false,
    secure: false,
    sameSite: 'Lax',
  },
];
const identity = {
  userId: '11111111-1111-4111-8111-111111111111',
  email: demoEmail,
  emailConfirmed: true,
  expiresAt: now + 3600_000,
};
let dir: string;
let path: string;
const verify = vi.fn(async () => identity);
beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'visual-cache-unit-')));
  path = join(dir, 'session.json');
  verify.mockReset();
  verify.mockResolvedValue(identity);
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});
async function seed() {
  await writeVisualSession(path, binding, cookies, verify, now);
  verify.mockClear();
}
function alter(change: (value: Record<string, unknown>) => void) {
  const value = JSON.parse(readFileSync(path, 'utf8'));
  change(value);
  writeFileSync(path, JSON.stringify(value));
}

describe('visual-only session cache', () => {
  it('persists private cookies across worker state and verifies normal-user identity on reuse', async () => {
    expect(await readVisualSession(path, binding, verify, now)).toBeUndefined();
    reserveVisualSessionBootstrap(path);
    await seed();
    expect(lstatSync(path).mode & 0o777).toBe(0o600);
    expect(await readVisualSession(path, binding, verify, now)).toEqual(cookies);
    expect(verify).toHaveBeenCalledExactlyOnceWith(cookies);
  });
  it('allows only one bootstrap even after a failed login', () => {
    reserveVisualSessionBootstrap(path);
    expect(() => reserveVisualSessionBootstrap(path)).toThrow();
  });
  it.each(['runId', 'project', 'proofSHA256', 'appOrigin', 'apiOrigin'] as const)(
    'rejects a different %s binding before auth calls',
    async (key) => {
      await seed();
      alter((value) => {
        (value.binding as Record<string, unknown>)[key] =
          key === 'runId' ? 'other_run_123456' : 'different';
      });
      await expect(readVisualSession(path, binding, verify, now)).rejects.toThrow();
      expect(verify).not.toHaveBeenCalled();
    },
  );
  it('rejects an expired session without refresh or login fallback', async () => {
    await seed();
    await expect(readVisualSession(path, binding, verify, now + 30 * 60_000)).rejects.toThrow(
      'expired',
    );
    expect(verify).not.toHaveBeenCalled();
  });
  it('rejects file and directory permission expansion', async () => {
    await seed();
    chmodSync(path, 0o644);
    await expect(readVisualSession(path, binding, verify, now)).rejects.toThrow('permissions');
    chmodSync(path, 0o600);
    chmodSync(dir, 0o755);
    await expect(readVisualSession(path, binding, verify, now)).rejects.toThrow(
      'private directory',
    );
    expect(verify).not.toHaveBeenCalled();
  });
  it('rejects symlink files and directories', async () => {
    const target = join(dir, 'target');
    writeFileSync(target, 'never-read', { mode: 0o600 });
    symlinkSync(target, path);
    await expect(readVisualSession(path, binding, verify, now)).rejects.toThrow('safely');
    const link = join(dir, 'link');
    symlinkSync(dir, link);
    await expect(
      readVisualSession(join(link, 'session.json'), binding, verify, now),
    ).rejects.toThrow('private directory');
    expect(verify).not.toHaveBeenCalled();
  });
  it('rejects oversized and malformed data without exposing session text', async () => {
    writeFileSync(path, 's'.repeat(128 * 1024 + 1), { mode: 0o600 });
    await expect(readVisualSession(path, binding, verify, now)).rejects.toThrow('size');
    writeFileSync(path, '{synthetic-secret');
    await expect(readVisualSession(path, binding, verify, now)).rejects.toThrow(
      /^Visual session cache is invalid\.$/u,
    );
  });
  it.each(['userId', 'email', 'emailConfirmed', 'expiresAt'] as const)(
    'rejects verified identity mismatch: %s',
    async (key) => {
      await seed();
      const changed = {
        ...identity,
        [key]:
          key === 'userId'
            ? '22222222-2222-4222-8222-222222222222'
            : key === 'email'
              ? 'someone@example.test'
              : key === 'emailConfirmed'
                ? false
                : now,
      };
      verify.mockResolvedValue(changed);
      await expect(readVisualSession(path, binding, verify, now)).rejects.toThrow('not verified');
    },
  );
  it('fails closed on revoked real session with no cache rewrite', async () => {
    await seed();
    const before = readFileSync(path, 'utf8');
    verify.mockRejectedValue(new Error('revoked'));
    await expect(readVisualSession(path, binding, verify, now)).rejects.toThrow('revoked');
    expect(readFileSync(path, 'utf8')).toBe(before);
    expect(verify).toHaveBeenCalledTimes(1);
  });
  it('rejects cookies for another origin and never stores unrelated cookies', async () => {
    await expect(
      writeVisualSession(path, binding, [{ ...cookies[0]!, domain: 'example.test' }], verify, now),
    ).rejects.toThrow('cookies');
    await writeVisualSession(
      path,
      binding,
      [...cookies, { ...cookies[0]!, name: 'unrelated' }],
      verify,
      now,
    );
    expect(await readVisualSession(path, binding, verify, now)).toEqual(cookies);
  });
});

describe('real SDK visual verifier transport', () => {
  const configuration = { binding, publishableKey: 'sb_publishable_synthetic_unit' };
  function sessionCookies(expiresAt: number): Cookie[] {
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const accessToken =
      encode({ alg: 'HS256', typ: 'JWT' }) +
      '.' +
      encode({
        sub: identity.userId,
        exp: expiresAt,
        iat: expiresAt - 3600,
        role: 'authenticated',
      }) +
      '.synthetic_signature';
    const session = {
      access_token: accessToken,
      refresh_token: 'synthetic-refresh-token',
      token_type: 'bearer',
      expires_at: expiresAt,
      expires_in: 3600,
      user: { id: identity.userId, email: demoEmail, email_confirmed_at: '2026-01-01T00:00:00Z' },
    };
    return [{ ...cookies[0]!, value: 'base64-' + encode(session) }];
  }
  it('allows only authoritative normal-user GET and disables redirects', async () => {
    const expiresAt = Math.floor(Date.now() / 1000) + 3600;
    const transport = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            id: identity.userId,
            email: demoEmail,
            email_confirmed_at: '2026-01-01T00:00:00Z',
            app_metadata: {},
            user_metadata: {},
            aud: 'authenticated',
            created_at: '2026-01-01T00:00:00Z',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    );
    expect(await verifyVisualSession(sessionCookies(expiresAt), configuration, transport)).toEqual({
      ...identity,
      expiresAt: expiresAt * 1000,
    });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(String(transport.mock.calls[0]![0])).toBe('http://127.0.0.1:54321/auth/v1/user');
    expect(transport.mock.calls[0]![1]).toMatchObject({
      method: 'GET',
      redirect: 'error',
      credentials: 'omit',
    });
  });
  it('rejects real SDK near-expiry refresh before token transport dispatch', async () => {
    // Hold only the clock value stable; the real SDK and its async callbacks still run.
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now());
    const transport = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            id: identity.userId,
            email: demoEmail,
            email_confirmed_at: '2026-01-01T00:00:00Z',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    );
    await expect(
      verifyVisualSession(
        sessionCookies(Math.floor(Date.now() / 1000) + 1),
        configuration,
        transport,
      ),
    ).rejects.toThrow('verification failed');
    // SDK can preserve and verify an unexpired token after denied proactive
    // refresh; the verifier denial latch must still reject the entire attempt.
    expect(transport).toHaveBeenCalledTimes(1);
    expect(String(transport.mock.calls[0]![0])).toBe(binding.apiOrigin + '/auth/v1/user');
    expect(transport.mock.calls[0]![1]?.method).toBe('GET');
    clock.mockRestore();
  });

  it('rejects an already expired SDK session without cookie writes, refresh dispatch or an unhandled callback error', async () => {
    const transport = vi.fn<typeof fetch>();
    await expect(
      verifyVisualSession(
        sessionCookies(Math.floor(Date.now() / 1000) - 1),
        configuration,
        transport,
      ),
    ).rejects.toThrow('verification failed');
    expect(transport).not.toHaveBeenCalled();
  });

  it.each([
    ['http://127.0.0.1:54321/auth/v1/token?grant_type=refresh_token', 'POST'],
    ['http://127.0.0.1:54321/auth/v1/user', 'POST'],
    ['http://127.0.0.1:54321/auth/v1/user?x=1', 'GET'],
    ['http://127.0.0.1:54321/auth/v1/user#x', 'GET'],
    ['http://someone:password@127.0.0.1:54321/auth/v1/user', 'GET'],
    ['http://127.0.0.1:54321/rest/v1/users', 'GET'],
    ['https://example.test/auth/v1/user', 'GET'],
  ])('denies %s %s before dispatch', async (url, method) => {
    const transport = vi.fn<typeof fetch>();
    const response = await visualUserOnlyFetch(binding.apiOrigin, transport)(url, { method });
    expect(response.status).toBe(403);
    expect(transport).not.toHaveBeenCalled();
  });
});
