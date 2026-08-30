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
    const client = {
      emails: {
        async send(...args: unknown[]) {
          calls.push(args);
          return { data: { id: 'resend-1' }, error: null, headers: null };
        },
      },
    };
    const provider = new ResendEmailProvider(
      { apiKey: `re_${'x'.repeat(30)}`, from: 'mail@example.com' },
      client as never,
    );
    await expect(
      provider.send(
        { to: 'guardian@example.com', subject: 'Subject', text: 'Body' },
        'communication:33333333-3333-4333-8333-333333333333',
      ),
    ).resolves.toEqual({ providerMessageId: 'resend-1' });
    expect(calls[0]?.[1]).toEqual({
      idempotencyKey: 'communication:33333333-3333-4333-8333-333333333333',
    });
  });

  it('rejects incomplete server configuration without exposing its values', () => {
    expect(() => new ResendEmailProvider({ apiKey: 'short', from: 'bad' })).toThrow();
  });
});
