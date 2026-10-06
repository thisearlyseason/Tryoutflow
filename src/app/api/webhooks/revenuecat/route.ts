import { withBillingDelivery } from '@/modules/subscriptions/application/billing-delivery';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { readBoundedStripeBody } from '../stripe/stripe-webhook';
import {
  verifyRevenueCatWebhook,
  getRevenueCatCustomer,
  verifiedNativeSubscription,
} from '@/modules/subscriptions/providers/revenuecat';
import {
  billingConfiguration,
  productForProvider,
} from '@/modules/subscriptions/providers/configuration';
import {
  applyBillingSnapshot,
  providerContext,
  reconcileNativePurchaser,
} from '@/modules/subscriptions/application/billing-service';
import { billingSnapshotSchema } from '@/modules/subscriptions/providers/contracts';
const eventSchema = z.object({
  id: z.string().min(1).max(256),
  type: z.string(),
  app_user_id: z.uuid(),
  store: z.enum(['APP_STORE', 'PLAY_STORE']),
  environment: z.enum(['SANDBOX', 'PRODUCTION']),
  product_id: z.string(),
  original_transaction_id: z.string(),
  transaction_id: z.string(),
  purchased_at_ms: z.number().int(),
  event_timestamp_ms: z.number().int(),
  expiration_at_ms: z.number().int().nullable().optional(),
});
export const runtime = 'nodejs';
export async function POST(request: Request) {
  let body: Uint8Array;
  try {
    body = await readBoundedStripeBody(request);
    if (!verifyRevenueCatWebhook(body, request.headers))
      return Response.json({ error: 'Invalid webhook.' }, { status: 401 });
  } catch {
    return Response.json({ error: 'Invalid webhook.' }, { status: 400 });
  }
  try {
    const event = z
      .object({ id: z.string().min(1).max(256), type: z.string().max(100) })
      .parse(JSON.parse(Buffer.from(body).toString('utf8')).event);
    return withBillingDelivery(
      {
        provider: 'revenuecat',
        id: event.id,
        type: event.type,
        digest: createHash('sha256').update(body).digest('hex'),
      },
      () => processRevenueCatBody(body),
    );
  } catch {
    return Response.json({ error: 'Invalid webhook.' }, { status: 400 });
  }
}
async function processRevenueCatBody(body: Uint8Array) {
  try {
    const raw = JSON.parse(Buffer.from(body).toString('utf8'));
    if (raw.event?.type === 'TRANSFER') {
      const transfer = z
        .object({
          id: z.string().max(256),
          event_timestamp_ms: z.number().int(),
          transferred_from: z.array(z.string()).max(100),
        })
        .parse(raw.event);
      for (const userId of transfer.transferred_from.filter(
        (id) => z.uuid().safeParse(id).success,
      )) {
        const context = await providerContext(null, userId);
        for (const contract of context.contracts.filter((c) => c.provider !== 'stripe')) {
          // Keep the original organization binding. A transferred store receipt requires review,
          // not an automatic reassignment to a different TryOutFlow account.
          const snapshot = {
            ...contract,
            status: 'paused' as const,
            observed_at: new Date(transfer.event_timestamp_ms).toISOString(),
          };
          await applyBillingSnapshot(
            {
              provider: 'revenuecat',
              id: `${transfer.id}:${contract.id}`,
              type: 'purchase_transfer_review_required',
              digest: createHash('sha256').update(body).digest('hex'),
              occurred_at: snapshot.observed_at,
            },
            snapshot,
          );
        }
      }
      return Response.json({ outcome: 'transfer_recorded' });
    }
    if (['TEMPORARY_ENTITLEMENT_GRANT', 'INVOICE_ISSUANCE'].includes(raw.event?.type))
      return Response.json({ outcome: 'non_payment_notification' });
    if (raw.event?.type === 'TEST') return Response.json({ outcome: 'test_received' });
    const event = eventSchema.parse(raw.event);
    const provider = event.store === 'APP_STORE' ? 'apple' : 'google';
    const environment = event.environment === 'PRODUCTION' ? 'production' : 'sandbox';
    if (environment !== billingConfiguration().environment)
      return Response.json({ outcome: 'environment_mismatch' });
    const productKey = productForProvider(provider, event.product_id);
    if (!productKey) return Response.json({ outcome: 'unknown_product' });
    const receipt = {
      provider: 'revenuecat',
      id: event.id,
      type: event.type,
      digest: createHash('sha256').update(body).digest('hex'),
      occurred_at: new Date(event.event_timestamp_ms).toISOString(),
    };
    const outcomes = await reconcileNativePurchaser(event.app_user_id, null, receipt);
    if (!outcomes.length) throw new Error('purchase_attribution_required');
    return Response.json({ outcomes });
  } catch {
    return Response.json(
      { error: 'Billing confirmation is temporarily unavailable.' },
      { status: 503 },
    );
  }
}
