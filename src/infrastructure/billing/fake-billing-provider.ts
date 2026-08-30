import { createHash } from 'node:crypto';

import type {
  BillingProvider,
  BillingProviderError,
  CheckoutSessionInput,
  PortalSessionInput,
} from './billing-provider';

type Submission = Readonly<{
  digest: string;
  input: CheckoutSessionInput | PortalSessionInput;
  sessionId: string;
  url: string;
}>;

export class FakeBillingProvider implements BillingProvider {
  readonly submissions = new Map<string, Submission>();

  constructor(private readonly failure?: 'temporary' | 'rejected') {}

  private async submit(
    kind: 'checkout' | 'portal',
    input: CheckoutSessionInput | PortalSessionInput,
    idempotencyKey: string,
    signal?: AbortSignal,
  ) {
    if (signal?.aborted)
      throw { code: 'delivery_uncertain', retryable: false } satisfies BillingProviderError;
    const digest = createHash('sha256')
      .update(JSON.stringify([kind, input]))
      .digest('hex');
    const existing = this.submissions.get(idempotencyKey);
    if (existing) {
      if (existing.digest !== digest)
        throw { code: 'provider_rejected', retryable: false } satisfies BillingProviderError;
      return { sessionId: existing.sessionId, url: existing.url };
    }
    if (this.failure)
      throw {
        code: this.failure === 'temporary' ? 'provider_temporary' : 'provider_rejected',
        retryable: this.failure === 'temporary',
      } satisfies BillingProviderError;
    const token = createHash('sha256')
      .update(`${idempotencyKey}:${digest}`)
      .digest('hex')
      .slice(0, 24);
    const sessionId = kind === 'checkout' ? `cs_test_${token}` : `bps_${token}`;
    const url = `https://billing.example.test/${kind}/${token}`;
    this.submissions.set(idempotencyKey, { digest, input, sessionId, url });
    return { sessionId, url };
  }

  createCheckoutSession(
    input: CheckoutSessionInput,
    idempotencyKey: string,
    options?: { signal?: AbortSignal },
  ) {
    return this.submit('checkout', input, idempotencyKey, options?.signal);
  }

  createPortalSession(
    input: PortalSessionInput,
    idempotencyKey: string,
    options?: { signal?: AbortSignal },
  ) {
    return this.submit('portal', input, idempotencyKey, options?.signal);
  }
}
