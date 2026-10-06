import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { billingConfiguration } from './configuration';
import { billingSnapshotSchema, type BillingSnapshot } from './contracts';
const same = (a: string, b: string) => {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};
export function verifyRevenueCatWebhook(
  body: Uint8Array,
  headers: Headers,
  env: Record<string, string | undefined> = process.env,
  now = Date.now(),
) {
  const secret = env.REVENUECAT_WEBHOOK_SECRET;
  if (
    !secret ||
    secret.length < 32 ||
    !same(headers.get('authorization') ?? '', `Bearer ${secret}`)
  )
    return false;
  const signing = env.REVENUECAT_WEBHOOK_SIGNING_SECRET;
  if (!signing) return true; // Authorization is the documented baseline; configure signing to require both.
  const header = headers.get('x-revenuecat-webhook-signature') ?? '';
  if (header.length > 1024) return false;
  const parts = header.split(',').map((x) => x.trim().split('='));
  if (
    parts.length !== 2 ||
    parts.filter((p) => p[0] === 't').length !== 1 ||
    parts.filter((p) => p[0] === 'v1').length !== 1
  )
    return false;
  const t = parts.find((p) => p[0] === 't')?.[1] ?? '',
    hash = parts.find((p) => p[0] === 'v1')?.[1] ?? '';
  if (
    !/^\d{1,12}$/.test(t) ||
    !/^[a-f0-9]{64}$/.test(hash) ||
    now / 1000 - Number(t) > 300 ||
    Number(t) - now / 1000 > 30
  )
    return false;
  return same(createHmac('sha256', signing).update(`${t}.`).update(body).digest('hex'), hash);
}
const date = z.iso.datetime({ offset: true });
const subscriptionSchema = z.object({
  store: z.enum(['app_store', 'play_store']),
  is_sandbox: z.boolean(),
  expires_date: date,
  original_purchase_date: date,
  purchase_date: date,
  grace_period_expires_date: date.nullable().optional(),
  billing_issues_detected_at: date.nullable().optional(),
  unsubscribe_detected_at: date.nullable().optional(),
  refunded_at: date.nullable().optional(),
  period_type: z.string().optional(),
  ownership_type: z.string().optional(),
});
export const customerSchema = z.object({
  subscriber: z.object({
    original_app_user_id: z.string(),
    subscriptions: z.record(z.string(), z.unknown()),
    non_subscriptions: z.record(z.string(), z.array(z.unknown())).default({}),
  }),
});
export async function getRevenueCatCustomer(userId: string) {
  z.uuid().parse(userId);
  // V2 scoped secret keys are rejected by the V1 CustomerInfo API (provider error 7723).
  // Use a V1-compatible key from this same project; never fall back to the V2 secret.
  const key = process.env.REVENUECAT_V1_API_KEY;
  if (!key) throw new Error('native_billing_unavailable');
  const response = await fetch(
    `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(userId)}`,
    {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(10_000),
      cache: 'no-store',
    },
  );
  if (!response.ok) throw new Error('native_provider_unavailable');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('invalid_provider_response');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 1024 * 1024) throw new Error('provider_response_too_large');
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return customerSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8'))).subscriber;
}
export function verifiedNativeSubscription(input: {
  customer: Awaited<ReturnType<typeof getRevenueCatCustomer>>;
  userId: string;
  productId: string;
  contractId: string;
  provider: 'apple' | 'google';
  productKey: BillingSnapshot['product_key'];
  observedAt: string;
}): BillingSnapshot {
  // Reject anonymous aliases, family shares and unrelated restored customers. Never silently transfer an organization.
  if (input.customer.original_app_user_id !== input.userId)
    throw new Error('purchase_account_conflict');
  const subscription = subscriptionSchema.parse(input.customer.subscriptions[input.productId]);
  const config = billingConfiguration();
  if (
    (subscription.is_sandbox ? 'sandbox' : 'production') !== config.environment ||
    subscription.store !== (input.provider === 'apple' ? 'app_store' : 'play_store') ||
    subscription.ownership_type === 'FAMILY_SHARED'
  )
    throw new Error('purchase_environment_or_ownership_conflict');
  const now = Date.parse(input.observedAt),
    end = Date.parse(subscription.expires_date),
    grace = subscription.grace_period_expires_date
      ? Date.parse(subscription.grace_period_expires_date)
      : 0;
  const state = subscription.refunded_at
    ? 'refunded'
    : grace > now && subscription.billing_issues_detected_at
      ? 'grace_period'
      : end <= now
        ? 'expired'
        : subscription.billing_issues_detected_at
          ? 'past_due'
          : subscription.period_type === 'trial'
            ? 'trialing'
            : 'active';
  return billingSnapshotSchema.parse({
    provider: input.provider,
    environment: config.environment,
    provider_contract_id: input.contractId,
    provider_customer_id: input.userId,
    purchaser_id: input.userId,
    product_key: input.productKey,
    status: state,
    current_period_start: subscription.purchase_date,
    current_period_end: subscription.expires_date,
    grace_period_end: subscription.grace_period_expires_date ?? null,
    cancel_at_period_end: !!subscription.unsubscribe_detected_at,
    observed_at: input.observedAt,
  });
}
