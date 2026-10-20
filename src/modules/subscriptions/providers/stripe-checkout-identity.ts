import { createHash } from 'node:crypto';

// A changed provider payload gets a distinct reservation and Stripe key. The
// organization reservation lock then safely resumes an older pending Session.
export function stripeCheckoutIdentity(
  attemptId: string,
  protocol?: 'standard_v1' | 'standard_tax_v1' | 'managed_v1',
  billingCountry?: unknown,
  returnIdentityVersion?: 'intent_return_v1',
) {
  if (!protocol)
    return {
      intentId: attemptId,
      idempotencyKey: `billing_v2_${attemptId}`,
      parameters: {},
    };
  // Country-bound new Managed attempts cannot replay another declaration's payload.
  const declaration =
    protocol === 'managed_v1' && (billingCountry === 'CA' || billingCountry === 'US')
      ? `:${billingCountry}`
      : '';
  const hash = createHash('sha256')
    .update(
      `tryoutflow:${protocol}${declaration}${returnIdentityVersion ? `:${returnIdentityVersion}` : ''}:${attemptId}`,
    )
    .digest('hex');
  const intentId = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
  return {
    intentId,
    idempotencyKey: `billing_v2_${protocol}_${intentId}`,
    parameters: {
      managed_payments: { enabled: protocol === 'managed_v1' },
      ...(protocol === 'standard_tax_v1'
        ? { automatic_tax: { enabled: true }, billing_address_collection: 'required' as const }
        : {}),
    },
  };
}
