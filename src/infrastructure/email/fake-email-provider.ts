import { createHash } from 'node:crypto';

import type { EmailMessage, EmailProvider, EmailProviderError } from './email-provider';

export class FakeEmailProvider implements EmailProvider {
  readonly submissions = new Map<string, { message: EmailMessage; providerMessageId: string }>();

  constructor(private readonly options: { failWith?: 'temporary' | 'rejected' } = {}) {}

  async send(message: EmailMessage, idempotencyKey: string, options?: { signal?: AbortSignal }) {
    if (options?.signal?.aborted)
      throw { code: 'provider_temporary', retryable: true } satisfies EmailProviderError;
    const existing = this.submissions.get(idempotencyKey);
    if (existing) return { providerMessageId: existing.providerMessageId };
    if (this.options.failWith) {
      throw {
        code: this.options.failWith === 'temporary' ? 'provider_temporary' : 'provider_rejected',
        retryable: this.options.failWith === 'temporary',
      } satisfies EmailProviderError;
    }
    const providerMessageId = `fake_${createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 24)}`;
    this.submissions.set(idempotencyKey, { message: { ...message }, providerMessageId });
    return { providerMessageId };
  }
}
