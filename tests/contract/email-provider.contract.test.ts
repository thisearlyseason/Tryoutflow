// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

import { FakeEmailProvider } from '../../src/infrastructure/email/fake-email-provider';
import {
  providerMessageIdSchema,
  type EmailProvider,
} from '../../src/infrastructure/email/email-provider';
import { ResendEmailProvider } from '../../src/infrastructure/email/resend-provider';

async function expectEmailProviderContract(factory: () => EmailProvider) {
  const provider = factory();
  const message = {
    to: 'guardian@example.com',
    subject: 'Registration received',
    text: 'Your registration was received.',
  };
  const first = await provider.send(message, 'communication:11111111-1111-4111-8111-111111111111');
  const replay = await provider.send(message, 'communication:11111111-1111-4111-8111-111111111111');

  expect(first).toEqual({ providerMessageId: expect.any(String) });
  expect(replay).toEqual(first);
}

describe('EmailProvider contract', () => {
  it('uses a stable idempotency key to return one provider submission', async () => {
    await expectEmailProviderContract(() => new FakeEmailProvider());
  });

  it('returns one deterministic RFC 4122 version-5 UUID across fake provider instances', async () => {
    const message = {
      to: 'guardian@example.com',
      subject: 'Registration received',
      text: 'Your registration was received.',
    };
    const key = 'communication:11111111-1111-4111-8111-111111111111';
    const first = await new FakeEmailProvider().send(message, key);
    const second = await new FakeEmailProvider().send(message, key);

    expect(first.providerMessageId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    expect(second).toEqual(first);
  });

  it.each([1, 2, 3, 4, 5])('accepts canonical RFC provider identifier version %i', (version) => {
    expect(
      providerMessageIdSchema.safeParse(`a5555555-5555-${version}555-8555-555555555555`).success,
    ).toBe(true);
  });

  it('normalizes provider failure without returning recipient or content', async () => {
    const provider = new FakeEmailProvider({ failWith: 'temporary' });
    await expect(
      provider.send(
        { to: 'private@example.com', subject: 'Private subject', text: 'Private body' },
        'communication:22222222-2222-4222-8222-222222222222',
      ),
    ).rejects.toEqual({ code: 'provider_temporary', retryable: true });
  });

  it('passes one stable idempotency key to Resend and normalizes its errors', async () => {
    const calls: unknown[][] = [];
    const request = async (...args: [string | URL | Request, RequestInit?]) => {
      calls.push(args);
      return Response.json({ id: '55555555-5555-4555-8555-555555555555' });
    };
    const provider = new ResendEmailProvider(
      { apiKey: `re_${'x'.repeat(30)}`, from: 'mail@example.com' },
      request,
    );
    await expect(
      provider.send(
        { to: 'guardian@example.com', subject: 'Subject', text: 'Body' },
        'communication:33333333-3333-4333-8333-333333333333',
      ),
    ).resolves.toEqual({ providerMessageId: '55555555-5555-4555-8555-555555555555' });
    expect(calls[0]?.[1]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({
          'idempotency-key': 'communication:33333333-3333-4333-8333-333333333333',
        }),
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('submits escaped HTML and the exact internal message tag for webhook reconciliation', async () => {
    const request = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      Response.json({ id: '55555555-5555-4555-8555-555555555555' }),
    );
    const provider = new ResendEmailProvider(
      { apiKey: `re_${'x'.repeat(30)}`, from: 'mail@example.com' },
      request,
    );
    await provider.send(
      {
        to: 'guardian@example.com',
        subject: 'Subject',
        text: 'Body',
        html: '<main><p>Safe body</p></main>',
        messageId: '33333333-3333-4333-8333-333333333333',
      },
      'communication:33333333-3333-4333-8333-333333333333',
    );
    const body = JSON.parse(String(request.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      html: '<main><p>Safe body</p></main>',
      tags: [{ name: 'message_id', value: '33333333-3333-4333-8333-333333333333' }],
    });
  });

  it('rejects incomplete server configuration without exposing its values', () => {
    expect(() => new ResendEmailProvider({ apiKey: 'short', from: 'bad' })).toThrow();
  });

  it('classifies explicit 4xx, 429, and 5xx responses without provider content', async () => {
    const configuration = { apiKey: `re_${'x'.repeat(30)}`, from: 'mail@example.com' };
    const message = { to: 'private@example.com', subject: 'Private subject', text: 'Private body' };
    const permanent = new ResendEmailProvider(
      configuration,
      async () => new Response('private rejection', { status: 400 }),
    );
    await expect(
      permanent.send(message, 'communication:33333333-3333-4333-8333-333333333333'),
    ).rejects.toEqual({ code: 'provider_rejected', retryable: false });
    const retryable = new ResendEmailProvider(
      configuration,
      async () => new Response('private outage', { status: 503 }),
    );
    await expect(
      retryable.send(message, 'communication:33333333-3333-4333-8333-333333333333'),
    ).rejects.toEqual({ code: 'provider_temporary', retryable: true });
    const rateLimited = new ResendEmailProvider(
      configuration,
      async () => new Response('private rate limit', { status: 429 }),
    );
    await expect(
      rateLimited.send(message, 'communication:33333333-3333-4333-8333-333333333333'),
    ).rejects.toEqual({ code: 'provider_temporary', retryable: true });
  });

  it.each([
    [400, { code: 'provider_rejected', retryable: false }],
    [408, { code: 'provider_rejected', retryable: false }],
    [418, { code: 'provider_rejected', retryable: false }],
    [429, { code: 'provider_temporary', retryable: true }],
    [499, { code: 'provider_rejected', retryable: false }],
    [500, { code: 'provider_temporary', retryable: true }],
    [599, { code: 'provider_temporary', retryable: true }],
  ] as const)('classifies explicit HTTP %i exactly', async (status, expected) => {
    const provider = new ResendEmailProvider(
      { apiKey: `re_${'x'.repeat(30)}`, from: 'mail@example.com' },
      async () => new Response('private provider response', { status }),
    );
    await expect(
      provider.send(
        { to: 'private@example.com', subject: 'Private subject', text: 'Private body' },
        'communication:33333333-3333-4333-8333-333333333333',
      ),
    ).rejects.toEqual(expected);
  });

  it.each([
    '00000000-0000-0000-0000-000000000000',
    '55555555-5555-6555-8555-555555555555',
    '55555555-5555-8555-8555-555555555555',
    '55555555-5555-4555-7555-555555555555',
    '55555555-5555-4555-8555-55555555555',
    'a5555555-5555-4555-8555-555555555555'.toUpperCase(),
  ])('rejects unsupported provider identifier %s in the shared contract', async (id) => {
    expect(providerMessageIdSchema.safeParse(id).success).toBe(false);
    const provider = new ResendEmailProvider(
      { apiKey: `re_${'x'.repeat(30)}`, from: 'mail@example.com' },
      async () => Response.json({ id }),
    );
    await expect(
      provider.send(
        { to: 'private@example.com', subject: 'Private subject', text: 'Private body' },
        'communication:33333333-3333-4333-8333-333333333333',
      ),
    ).rejects.toEqual({ code: 'delivery_uncertain', retryable: false });
  });

  it('classifies malformed or missing responses as delivery uncertain', async () => {
    const malformedRequest = vi.fn(async () => Response.json({ id: 'not-a-provider-uuid' }));
    const malformed = new ResendEmailProvider(
      { apiKey: `re_${'x'.repeat(30)}`, from: 'mail@example.com', timeoutMs: 1_000 },
      malformedRequest,
    );
    await expect(
      malformed.send(
        { to: 'guardian@example.com', subject: 'Subject', text: 'Body' },
        'communication:33333333-3333-4333-8333-333333333333',
      ),
    ).rejects.toEqual({ code: 'delivery_uncertain', retryable: false });
    expect(malformedRequest).toHaveBeenCalledTimes(1);

    const missingRequest = vi.fn(async () => undefined as unknown as Response);
    const missing = new ResendEmailProvider(
      { apiKey: `re_${'x'.repeat(30)}`, from: 'mail@example.com', timeoutMs: 1_000 },
      missingRequest,
    );
    await expect(
      missing.send(
        { to: 'guardian@example.com', subject: 'Subject', text: 'Body' },
        'communication:33333333-3333-4333-8333-333333333333',
      ),
    ).rejects.toEqual({ code: 'delivery_uncertain', retryable: false });
    expect(missingRequest).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      'abort before request completion',
      () => Promise.reject(new DOMException('Aborted', 'AbortError')),
    ],
    ['connection reset', () => Promise.reject(new TypeError('fetch failed: ECONNRESET'))],
  ])('classifies %s as delivery uncertain', async (_name, request) => {
    const requestSpy = vi.fn(request);
    const provider = new ResendEmailProvider(
      { apiKey: `re_${'x'.repeat(30)}`, from: 'mail@example.com', timeoutMs: 1_000 },
      requestSpy,
    );
    await expect(
      provider.send(
        { to: 'guardian@example.com', subject: 'Subject', text: 'Body' },
        'communication:33333333-3333-4333-8333-333333333333',
      ),
    ).rejects.toEqual({ code: 'delivery_uncertain', retryable: false });
    expect(requestSpy).toHaveBeenCalledTimes(1);
  });

  it('classifies a delayed abort after request body handoff as delivery uncertain', async () => {
    const stalledRequest = vi.fn(
      async (_input: string | URL | Request, options?: RequestInit) =>
        new Promise<Response>((_resolve, reject) =>
          options?.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          ),
        ),
    );
    const stalled = new ResendEmailProvider(
      { apiKey: `re_${'x'.repeat(30)}`, from: 'mail@example.com', timeoutMs: 1_000 },
      stalledRequest,
    );
    await expect(
      stalled.send(
        { to: 'guardian@example.com', subject: 'Subject', text: 'Body' },
        'communication:33333333-3333-4333-8333-333333333333',
      ),
    ).rejects.toEqual({ code: 'delivery_uncertain', retryable: false });
    expect(stalledRequest).toHaveBeenCalledTimes(1);
  });
});
