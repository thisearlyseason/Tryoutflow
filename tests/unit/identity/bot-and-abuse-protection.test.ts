// @vitest-environment node

import { createHash } from 'node:crypto';

import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

import { getTrustedRequestOrigin } from '../../../src/lib/request-origin';
import {
  DETERMINISTIC_TEST_BOT_TOKEN,
  TurnstileBotProtection,
  createBotProtectionFromEnvironment,
  isExactDeterministicBotTestEnvironment,
} from '../../../src/modules/identity/application/bot-protection';
import {
  createDatabaseAuthAbuseProtection,
  getTrustedAuthRequestContext,
} from '../../../src/modules/identity/application/database-auth-abuse-protection';
import { guardAuthFormRequest } from '../../../src/modules/identity/application/guard-auth-form-request';

const successfulTurnstileResponse = {
  success: true,
  challenge_ts: new Date().toISOString(),
  hostname: 'tryoutflow.example',
  action: 'sign_in',
  cdata: '',
  'error-codes': [],
};

describe('Turnstile bot protection', () => {
  it('verifies the token server-side and binds hostname, action, address, and a request id', async () => {
    const request = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = new URLSearchParams(String(init?.body));
      expect(body.get('secret')).toBe('turnstile-secret');
      expect(body.get('response')).toBe('opaque-token');
      expect(body.get('remoteip')).toBe('203.0.113.7');
      expect(body.get('idempotency_key')).toMatch(/^[0-9a-f-]{36}$/u);
      return new Response(JSON.stringify(successfulTurnstileResponse), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const protection = new TurnstileBotProtection({
      secretKey: 'turnstile-secret',
      allowedHostnames: ['tryoutflow.example'],
      request,
      now: () => Date.now(),
    });

    await expect(
      protection.verify({ token: 'opaque-token', action: 'sign_in', remoteAddress: '203.0.113.7' }),
    ).resolves.toEqual({ ok: true });
    expect(request).toHaveBeenCalledWith(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      expect.objectContaining({ method: 'POST', signal: expect.any(AbortSignal) }),
    );
  });

  it.each([
    ['wrong hostname', { hostname: 'attacker.example' }],
    ['wrong action', { action: 'sign_up' }],
    ['failed verification', { success: false, 'error-codes': ['invalid-input-response'] }],
    ['expired timestamp', { challenge_ts: new Date(Date.now() - 301_000).toISOString() }],
  ])('rejects a %s response without exposing provider details', async (_name, change) => {
    const request = vi.fn(
      async () =>
        new Response(JSON.stringify({ ...successfulTurnstileResponse, ...change }), {
          status: 200,
        }),
    );
    const protection = new TurnstileBotProtection({
      secretKey: 'turnstile-secret',
      allowedHostnames: ['tryoutflow.example'],
      request,
      now: () => Date.now(),
    });

    await expect(protection.verify({ token: 'opaque-token', action: 'sign_in' })).resolves.toEqual({
      ok: false,
      reason: 'invalid',
    });
  });

  it('fails unavailable on timeout, non-200, or malformed provider data', async () => {
    const request = vi.fn(async () => {
      throw new Error('timed out');
    });
    const protection = new TurnstileBotProtection({
      secretKey: 'turnstile-secret',
      allowedHostnames: ['tryoutflow.example'],
      request,
    });

    await expect(protection.verify({ token: 'opaque-token', action: 'sign_in' })).resolves.toEqual({
      ok: false,
      reason: 'unavailable',
    });
  });

  it('fails closed when production configuration is incomplete', () => {
    expect(() =>
      createBotProtectionFromEnvironment({
        NODE_ENV: 'production',
        NEXT_PUBLIC_APP_URL: 'https://tryoutflow.example',
      }),
    ).toThrow(/Turnstile protection is not configured/u);
  });

  it('allows the deterministic fake only at the exact Vitest boundary', async () => {
    const protection = createBotProtectionFromEnvironment({
      NODE_ENV: 'test',
      TRYOUTFLOW_SERVER_TEST_ENV: 'vitest',
      TRYOUTFLOW_BOT_PROTECTION_MODE: 'deterministic-test',
    });
    await expect(
      protection.verify({ token: DETERMINISTIC_TEST_BOT_TOKEN, action: 'recovery' }),
    ).resolves.toEqual({ ok: true });
    expect(() =>
      createBotProtectionFromEnvironment({
        NODE_ENV: 'production',
        TRYOUTFLOW_SERVER_TEST_ENV: 'vitest',
        TRYOUTFLOW_BOT_PROTECTION_MODE: 'deterministic-test',
      }),
    ).toThrow(/not configured/u);
  });

  it('allows deterministic bot proof only for the explicit loopback development demo', async () => {
    const exactLocalDemo = {
      NODE_ENV: 'development',
      NEXT_PUBLIC_TRYOUTFLOW_LOCAL_DEMO_MODE: 'true',
      NEXT_PUBLIC_APP_URL: 'http://localhost:3112',
      NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
    };

    expect(isExactDeterministicBotTestEnvironment(exactLocalDemo)).toBe(true);
    await expect(
      createBotProtectionFromEnvironment(exactLocalDemo).verify({
        token: DETERMINISTIC_TEST_BOT_TOKEN,
        action: 'sign_in',
      }),
    ).resolves.toEqual({ ok: true });

    for (const environment of [
      { ...exactLocalDemo, NEXT_PUBLIC_TRYOUTFLOW_LOCAL_DEMO_MODE: undefined },
      { ...exactLocalDemo, NODE_ENV: 'production' },
      { ...exactLocalDemo, NEXT_PUBLIC_APP_URL: 'http://localhost:3113' },
      { ...exactLocalDemo, NEXT_PUBLIC_APP_URL: 'https://tryoutflow.example' },
      { ...exactLocalDemo, NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co' },
    ]) {
      expect(isExactDeterministicBotTestEnvironment(environment)).toBe(false);
      expect(() => createBotProtectionFromEnvironment(environment)).toThrow(/not configured/u);
    }
  });
});

describe('shared auth abuse protection', () => {
  it('verifies reissue bot proof before creating any durable limiter or replay row', async () => {
    const events: string[] = [];
    const rpc = vi.fn(async (name: string) => {
      events.push(name);
      return name === 'consume_abuse_rate_limit'
        ? { data: [{ allowed: true }], error: null }
        : { data: [{ consumed: true }], error: null };
    });
    const protection = createDatabaseAuthAbuseProtection({
      rpc,
      botProtection: {
        verify: vi.fn(async () => {
          events.push('verify_bot');
          return { ok: false as const, reason: 'invalid' as const };
        }),
      },
      hmacSecret: 'h'.repeat(64),
    });

    await expect(
      protection.checkBotFirst({
        scope: 'registration_reissue',
        action: 'registration_reissue',
        subject: 'registration-reissue-network',
        token: 'invalid-provider-token',
        requestContext: { networkAddress: '203.0.113.7' },
      }),
    ).resolves.toEqual({ allowed: false, reason: 'bot_verification_required' });
    expect(events).toEqual(['verify_bot']);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('consumes a verified reissue token before one fixed-cardinality network counter', async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return name === 'consume_bot_token_once'
        ? { data: [{ consumed: true }], error: null }
        : { data: [{ allowed: true }], error: null };
    });
    const protection = createDatabaseAuthAbuseProtection({
      rpc,
      botProtection: { verify: vi.fn(async () => ({ ok: true as const })) },
      hmacSecret: 'h'.repeat(64),
    });
    const attempt = (token: string) => ({
      scope: 'registration_reissue' as const,
      action: 'registration_reissue' as const,
      subject: 'registration-reissue-network',
      token,
      requestContext: { networkAddress: '203.0.113.7' },
    });

    await expect(protection.checkBotFirst(attempt('provider-token-one'))).resolves.toEqual({
      allowed: true,
    });
    await expect(protection.checkBotFirst(attempt('provider-token-two'))).resolves.toEqual({
      allowed: true,
    });

    expect(calls.map(({ name }) => name)).toEqual([
      'consume_bot_token_once',
      'consume_abuse_rate_limit',
      'consume_bot_token_once',
      'consume_abuse_rate_limit',
    ]);
    const rateCalls = calls.filter(({ name }) => name === 'consume_abuse_rate_limit');
    expect(rateCalls).toHaveLength(2);
    expect(rateCalls[0]?.args.p_subject_digest).toBe(rateCalls[1]?.args.p_subject_digest);
    expect(JSON.stringify(calls)).not.toContain('provider-token');
    expect(JSON.stringify(calls)).not.toContain('203.0.113.7');
  });

  it('stores only HMAC/digest material and rejects replayed verified tokens', async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return name === 'consume_abuse_rate_limit'
        ? { data: [{ allowed: true }], error: null }
        : {
            data: [{ consumed: calls.filter((call) => call.name === name).length === 1 }],
            error: null,
          };
    });
    const botProtection = { verify: vi.fn(async () => ({ ok: true as const })) };
    const protection = createDatabaseAuthAbuseProtection({
      rpc,
      botProtection,
      hmacSecret: 'h'.repeat(64),
    });
    const attempt = {
      scope: 'auth_sign_in' as const,
      action: 'sign_in' as const,
      subject: 'Coach@Example.com',
      token: 'secret-provider-token',
      requestContext: { networkAddress: '203.0.113.7' },
    };

    await expect(protection.check(attempt)).resolves.toEqual({ allowed: true });
    await expect(protection.check(attempt)).resolves.toEqual({
      allowed: false,
      reason: 'bot_verification_required',
    });
    const serialized = JSON.stringify(calls);
    expect(serialized).not.toContain('Coach@Example.com');
    expect(serialized).not.toContain('203.0.113.7');
    expect(serialized).not.toContain('secret-provider-token');
    expect(serialized).toMatch(/[0-9a-f]{64}/u);
    expect(botProtection.verify).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'sign_in', remoteAddress: '203.0.113.7' }),
    );
  });

  it('shares one atomic counter across adapter instances', async () => {
    let attempts = 0;
    const rpc = vi.fn(async (name: string) => {
      if (name === 'consume_abuse_rate_limit') {
        attempts += 1;
        return { data: [{ allowed: attempts <= 2 }], error: null };
      }
      return { data: [{ consumed: true }], error: null };
    });
    const dependencies = {
      rpc,
      botProtection: { verify: async () => ({ ok: true as const }) },
      hmacSecret: 'h'.repeat(64),
      limits: { auth_sign_in: { limit: 2, windowSeconds: 60 } },
    };
    const firstInstance = createDatabaseAuthAbuseProtection(dependencies);
    const secondInstance = createDatabaseAuthAbuseProtection(dependencies);
    const attempt = (token: string) => ({
      scope: 'auth_sign_in' as const,
      action: 'sign_in' as const,
      subject: 'coach@example.com',
      token,
      requestContext: { networkAddress: '203.0.113.7' },
    });

    await expect(firstInstance.check(attempt('token-one'))).resolves.toEqual({ allowed: true });
    await expect(secondInstance.check(attempt('token-two'))).resolves.toEqual({ allowed: true });
    await expect(firstInstance.check(attempt('token-three'))).resolves.toEqual({
      allowed: false,
      reason: 'rate_limited',
    });
  });

  it('fails closed on bot-provider and shared-database failures', async () => {
    const unavailableBot = createDatabaseAuthAbuseProtection({
      rpc: async () => ({ data: [{ allowed: true }], error: null }),
      botProtection: {
        verify: async () => ({ ok: false as const, reason: 'unavailable' as const }),
      },
      hmacSecret: 'h'.repeat(64),
    });
    await expect(
      unavailableBot.check({
        scope: 'auth_recovery',
        action: 'recovery',
        subject: 'coach@example.com',
        token: 'token',
        requestContext: { networkAddress: '203.0.113.7' },
      }),
    ).resolves.toEqual({ allowed: false, reason: 'abuse_protection_unavailable' });

    const unavailableDatabase = createDatabaseAuthAbuseProtection({
      rpc: async () => {
        throw new Error('unavailable');
      },
      botProtection: { verify: async () => ({ ok: true as const }) },
      hmacSecret: 'h'.repeat(64),
    });
    await expect(
      unavailableDatabase.check({
        scope: 'auth_recovery',
        action: 'recovery',
        subject: 'coach@example.com',
        token: 'token',
        requestContext: { networkAddress: '203.0.113.7' },
      }),
    ).resolves.toEqual({ allowed: false, reason: 'abuse_protection_unavailable' });
  });
});

describe('bounded same-origin auth form requests', () => {
  function request(body: string, headers: Record<string, string> = {}) {
    return new NextRequest('https://tryoutflow.example/auth/sign-in', {
      method: 'POST',
      body,
      headers: {
        origin: 'https://tryoutflow.example',
        'content-type': 'application/x-www-form-urlencoded',
        'x-vercel-forwarded-for': '203.0.113.7',
        ...headers,
      },
    });
  }

  it('accepts exact bounded fields and derives trusted deployment context', async () => {
    const guarded = await guardAuthFormRequest(
      request('email=coach%40example.com&password=a&cf-turnstile-response=token'),
      {
        allowedFields: ['email', 'password', 'cf-turnstile-response'],
      },
    );
    expect(guarded).toEqual(
      expect.objectContaining({
        ok: true,
        fields: expect.any(URLSearchParams),
        requestContext: { networkAddress: '203.0.113.7' },
      }),
    );
    expect(
      getTrustedAuthRequestContext(new Headers({ 'x-forwarded-for': '198.51.100.9' })),
    ).toEqual({
      networkAddress: undefined,
    });
  });

  it.each([
    ['cross origin', { origin: 'https://attacker.example' }, 'email=a%40b.co'],
    ['wrong mime', { 'content-type': 'text/plain' }, 'email=a%40b.co'],
    ['unexpected field', {}, 'email=a%40b.co&role=owner'],
    ['oversized body', {}, `email=a%40b.co&padding=${'x'.repeat(9_000)}`],
  ])('rejects %s before application work', async (_name, headers, body) => {
    await expect(
      guardAuthFormRequest(request(body, headers), {
        allowedFields: ['email', 'password', 'cf-turnstile-response'],
      }),
    ).resolves.toEqual(expect.objectContaining({ ok: false }));
  });
});

describe('production request origin', () => {
  it('uses the configured canonical HTTPS origin instead of a forged Host header', () => {
    const request = new NextRequest('http://internal:3000/auth/sign-up', {
      headers: { host: 'attacker.example', 'x-forwarded-proto': 'https' },
    });

    expect(
      getTrustedRequestOrigin(request, {
        NODE_ENV: 'production',
        NEXT_PUBLIC_APP_URL: 'https://tryoutflow.example',
      }),
    ).toBe('https://tryoutflow.example');
  });

  it('fails closed when a production canonical origin is missing or not HTTPS', () => {
    const request = new NextRequest('http://internal:3000/auth/sign-up');
    expect(() => getTrustedRequestOrigin(request, { NODE_ENV: 'production' })).toThrow(
      /canonical origin/u,
    );
    expect(() =>
      getTrustedRequestOrigin(request, {
        NODE_ENV: 'production',
        NEXT_PUBLIC_APP_URL: 'http://tryoutflow.example',
      }),
    ).toThrow(/canonical origin/u);
  });

  it('uses the local browser origin only at the exact production E2E boundary', () => {
    const request = new NextRequest('http://internal:3000/auth/sign-up', {
      headers: { host: '127.0.0.1:3112', 'x-forwarded-proto': 'http' },
    });
    const exact = {
      NODE_ENV: 'production',
      TRYOUTFLOW_SERVER_TEST_ENV: 'task30-playwright',
      TRYOUTFLOW_BOT_PROTECTION_MODE: 'deterministic-test',
      NEXT_PUBLIC_APP_URL: 'https://task30.e2e.example.test',
      NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
    };
    expect(getTrustedRequestOrigin(request, exact)).toBe('http://127.0.0.1:3112');
    expect(
      getTrustedRequestOrigin(request, { ...exact, TRYOUTFLOW_SERVER_TEST_ENV: 'other' }),
    ).toBe('https://task30.e2e.example.test');
  });

  it('accepts an explicitly configured alternate loopback E2E origin without trusting another port', () => {
    const alternate = new NextRequest('http://internal:3000/auth/sign-up', {
      headers: { host: '127.0.0.1:3217', 'x-forwarded-proto': 'http' },
    });
    const wrongPort = new NextRequest('http://internal:3000/auth/sign-up', {
      headers: { host: '127.0.0.1:3218', 'x-forwarded-proto': 'http' },
    });
    const exact = {
      NODE_ENV: 'production',
      TRYOUTFLOW_SERVER_TEST_ENV: 'task30-playwright',
      TRYOUTFLOW_BOT_PROTECTION_MODE: 'deterministic-test',
      NEXT_PUBLIC_APP_URL: 'https://task30.e2e.example.test',
      NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
      TASK30_LOCAL_REQUEST_ORIGIN: 'http://127.0.0.1:3217',
    };

    expect(getTrustedRequestOrigin(alternate, exact)).toBe('http://127.0.0.1:3217');
    expect(getTrustedRequestOrigin(wrongPort, exact)).toBe('https://task30.e2e.example.test');
    expect(
      getTrustedRequestOrigin(alternate, {
        ...exact,
        TASK30_LOCAL_REQUEST_ORIGIN: 'http://192.0.2.1:3217',
      }),
    ).toBe('https://task30.e2e.example.test');
  });
});

it('never hashes privacy subjects without an HMAC secret', () => {
  const rawDigest = createHash('sha256').update('coach@example.com').digest('hex');
  expect(() =>
    createDatabaseAuthAbuseProtection({
      rpc: async () => ({ data: [], error: null }),
      botProtection: { verify: async () => ({ ok: true as const }) },
      hmacSecret: '',
    }),
  ).toThrow(/HMAC/u);
  expect(rawDigest).toHaveLength(64);
});
