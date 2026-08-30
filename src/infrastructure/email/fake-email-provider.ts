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
    const bytes = createHash('sha256')
      .update(JSON.stringify([idempotencyKey, message.to, message.subject, message.text]))
      .digest()
      .subarray(0, 16);
    // RFC 4122 variant, deterministic version 5. The fake intentionally binds
    // the identifier to both the provider idempotency key and exact handoff.
    bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
    bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
    const hex = bytes.toString('hex');
    const providerMessageId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    this.submissions.set(idempotencyKey, { message: { ...message }, providerMessageId });
    return { providerMessageId };
  }
}
