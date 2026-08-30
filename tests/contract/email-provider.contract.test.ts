// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { FakeEmailProvider } from '../../src/infrastructure/email/fake-email-provider';
import type { EmailProvider } from '../../src/infrastructure/email/email-provider';
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

  it('rejects incomplete server configuration without exposing its values', () => {
    expect(() => new ResendEmailProvider({ apiKey: 'short', from: 'bad' })).toThrow();
  });

  it('classifies permanent and retryable HTTP failures without provider content', async () => {
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
  });

  it('rejects malformed provider IDs and aborts stalled Resend requests', async () => {
    const malformed = new ResendEmailProvider(
      { apiKey: `re_${'x'.repeat(30)}`, from: 'mail@example.com', timeoutMs: 1_000 },
      async () => Response.json({ id: 'not-a-provider-uuid' }),
    );
    await expect(
      malformed.send(
        { to: 'guardian@example.com', subject: 'Subject', text: 'Body' },
        'communication:33333333-3333-4333-8333-333333333333',
      ),
    ).rejects.toEqual({ code: 'provider_temporary', retryable: true });

    const stalled = new ResendEmailProvider(
      { apiKey: `re_${'x'.repeat(30)}`, from: 'mail@example.com', timeoutMs: 1_000 },
      async (_input, options) =>
        new Promise((_resolve, reject) =>
          options?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted'))),
        ),
    );
    await expect(
      stalled.send(
        { to: 'guardian@example.com', subject: 'Subject', text: 'Body' },
        'communication:33333333-3333-4333-8333-333333333333',
      ),
    ).rejects.toEqual({ code: 'provider_temporary', retryable: true });
  });
});
