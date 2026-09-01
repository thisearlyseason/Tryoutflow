// @vitest-environment node

import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { guardPublicJsonRequest } from '../../../src/app/api/public/registrations/public-request-security';

const parse = (value: unknown) => {
  if (!value || typeof value !== 'object' || !('target' in value)) return null;
  const target = (value as { target?: unknown }).target;
  return typeof target === 'string' && /^[a-z0-9-]{1,63}$/u.test(target)
    ? { body: value as { target: string }, target }
    : null;
};

function request(body: BodyInit, headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost/api/public/registrations/test', {
    method: 'POST',
    headers: {
      origin: 'http://localhost',
      'content-type': 'application/json',
      'x-forwarded-for': '203.0.113.9',
      ...headers,
    },
    body,
  });
}

describe('shared public registration request defenses', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'local-test-key';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'local-service-key';
    process.env.PUBLIC_REGISTRATION_RATE_LIMIT_SECRET = 'r'.repeat(64);
    delete process.env.TRYOUTFLOW_INTEGRATION_RUN_ID;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('accepts same-origin JSON and derives a non-reversible route-specific bucket', async () => {
    const guarded = await guardPublicJsonRequest(request('{"target":"fall-camp"}'), {
      bucket: 'consume',
      parse,
    });
    expect(guarded).toEqual(expect.objectContaining({ ok: true, body: { target: 'fall-camp' } }));
    if (guarded.ok) {
      expect(guarded.contextRateKey).toMatch(/^[0-9a-f]{64}$/u);
      expect(guarded.rateKey).toMatch(/^[0-9a-f]{64}$/u);
      expect(guarded.rateKey).not.toContain('fall-camp');
    }
  });

  it('keeps the route/address context bucket stable when attacker-controlled targets change', async () => {
    const first = await guardPublicJsonRequest(request('{"target":"fall-camp"}'), {
      bucket: 'consume',
      parse,
    });
    const second = await guardPublicJsonRequest(request('{"target":"winter-camp"}'), {
      bucket: 'consume',
      parse,
    });
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.contextRateKey).toBe(second.contextRateKey);
      expect(first.rateKey).not.toBe(second.rateKey);
    }
  });

  it('namespaces supervised rate keys by the unguessable integration run id', async () => {
    const firstRunId = '8'.repeat(16);
    process.env.TRYOUTFLOW_INTEGRATION_RUN_ID = firstRunId;
    const first = await guardPublicJsonRequest(request('{"target":"fall-camp"}'), {
      bucket: 'consume',
      parse,
    });
    const secondRunId = '9'.repeat(16);
    process.env.TRYOUTFLOW_INTEGRATION_RUN_ID = secondRunId;
    const second = await guardPublicJsonRequest(request('{"target":"fall-camp"}'), {
      bucket: 'consume',
      parse,
    });
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.contextRateKey).not.toBe(second.contextRateKey);
      expect(first.rateKey).not.toBe(second.rateKey);
    }
  });

  it('uses a bounded local-development context when the dev server provides no proxy address', async () => {
    const guarded = await guardPublicJsonRequest(
      request('{"target":"fall-camp"}', { 'x-forwarded-for': '' }),
      { bucket: 'consume', parse },
    );
    expect(guarded).toEqual(expect.objectContaining({ ok: true }));
  });

  it('compares Origin to the request Host when the framework URL uses an internal host', async () => {
    const proxied = new NextRequest('http://internal:3000/api/public/registrations/test', {
      method: 'POST',
      headers: {
        host: '127.0.0.1:3000',
        origin: 'http://127.0.0.1:3000',
        'content-type': 'application/json',
        'x-forwarded-for': '203.0.113.9',
      },
      body: '{"target":"fall-camp"}',
    });
    await expect(guardPublicJsonRequest(proxied, { bucket: 'consume', parse })).resolves.toEqual(
      expect.objectContaining({ ok: true }),
    );
  });

  it('uses the canonical production origin instead of attacker-controlled Host metadata', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://tryoutflow.example');
    const canonical = new NextRequest(
      'http://internal:3000/api/public/registrations/confirmation',
      {
        method: 'POST',
        headers: {
          host: 'attacker.example',
          origin: 'https://tryoutflow.example',
          'x-forwarded-proto': 'https',
          'content-type': 'application/json',
          'x-vercel-forwarded-for': '203.0.113.9',
        },
        body: '{"target":"fall-camp"}',
      },
    );
    await expect(guardPublicJsonRequest(canonical, { bucket: 'consume', parse })).resolves.toEqual(
      expect.objectContaining({ ok: true }),
    );

    const forged = new NextRequest('http://internal:3000/api/public/registrations/confirmation', {
      method: 'POST',
      headers: {
        host: 'attacker.example',
        origin: 'https://attacker.example',
        'x-forwarded-proto': 'https',
        'content-type': 'application/json',
        'x-vercel-forwarded-for': '203.0.113.9',
      },
      body: '{"target":"fall-camp"}',
    });
    await expect(guardPublicJsonRequest(forged, { bucket: 'consume', parse })).resolves.toEqual({
      ok: false,
      status: 403,
    });
  });

  it.each([
    ['cross-origin', { origin: 'https://attacker.example' }, 403],
    ['missing origin', { origin: '' }, 403],
    ['JSON suffix', { 'content-type': 'application/ld+json' }, 403],
    ['invalid target', {}, 400],
  ])('rejects %s requests before rate-bucket allocation', async (caseName, headers, status) => {
    const body =
      caseName === 'invalid target' ? '{"target":"../secret"}' : '{"target":"fall-camp"}';
    const guarded = await guardPublicJsonRequest(request(body, headers), {
      bucket: 'consume',
      parse,
    });
    expect(guarded).toEqual({ ok: false, status });
  });

  it('enforces the actual streamed byte count when content-length lies', async () => {
    const oversized = JSON.stringify({ target: 'fall-camp', padding: 'x'.repeat(33 * 1024) });
    await expect(
      guardPublicJsonRequest(request(oversized, { 'content-length': '10' }), {
        bucket: 'consume',
        parse,
      }),
    ).resolves.toEqual({ ok: false, status: 413 });
  });

  it('counts multibyte UTF-8 bytes rather than JavaScript characters', async () => {
    const oversized = JSON.stringify({ target: 'fall-camp', padding: '🥅'.repeat(11_000) });
    expect(oversized.length).toBeLessThan(32 * 1024);
    await expect(
      guardPublicJsonRequest(request(oversized), { bucket: 'consume', parse }),
    ).resolves.toEqual({ ok: false, status: 413 });
  });
});
