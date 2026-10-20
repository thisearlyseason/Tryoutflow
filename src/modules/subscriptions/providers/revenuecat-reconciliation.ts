import 'server-only';
import { z } from 'zod';
import { billingConfiguration, productForProvider } from './configuration';
import { billingSnapshotSchema, type BillingSnapshot } from './contracts';
import { getRevenueCatCustomer, verifiedNativeSubscription } from './revenuecat';
const identity = {
  id: z.string().min(1).max(255),
  customer_id: z.string(),
  original_customer_id: z.string(),
  product_id: z.string(),
  environment: z.enum(['production', 'sandbox']),
  store: z.string(),
  ownership: z.string(),
};
const subscriptionSchema = z.object({
  ...identity,
  starts_at: z.number().int(),
  current_period_starts_at: z.number().int(),
  current_period_ends_at: z.number().int().nullable(),
  ends_at: z.number().int().nullable(),
  status: z.string(),
  gives_access: z.boolean(),
  auto_renewal_status: z.string(),
  pending_changes: z
    .object({
      product: z.object({ store_identifier: z.string() }).nullable().optional(),
      current_period_starts_at: z.number().int().nullable().optional(),
    })
    .nullable()
    .optional(),
});
const purchaseSchema = z.object({
  ...identity,
  purchased_at: z.number().int(),
  status: z.string(),
  quantity: z.number().int(),
});
async function get(path: string): Promise<unknown> {
  const key = process.env.REVENUECAT_SECRET_KEY;
  if (!key) throw new Error('native_billing_unavailable');
  const response = await fetch(`https://api.revenuecat.com${path}`, {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(10000),
    cache: 'no-store',
  });
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
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
async function list(path: string): Promise<unknown[]> {
  const items: unknown[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 10; page++) {
    const result = z
      .object({ items: z.array(z.unknown()).max(100), next_page: z.string().nullable() })
      .parse(
        await get(
          `${path}&limit=100${cursor ? `&starting_after=${encodeURIComponent(cursor)}` : ''}`,
        ),
      );
    items.push(...result.items);
    if (!result.next_page) return items;
    const last = z.object({ id: z.string() }).parse(result.items.at(-1));
    cursor = last.id;
  }
  throw new Error('provider_pagination_limit');
}
/** Stable RevenueCat record IDs support recovery even when the initial webhook was missed. */
export async function loadVerifiedNativePurchases(userId: string): Promise<BillingSnapshot[]> {
  z.uuid().parse(userId);
  const project = process.env.REVENUECAT_PROJECT_ID;
  if (!project || !/^proj[A-Za-z0-9]+$/.test(project))
    throw new Error('native_billing_unavailable');
  const environment = billingConfiguration().environment,
    observedAt = new Date().toISOString();
  const base = `/v2/projects/${encodeURIComponent(project)}`;
  const [rawSubscriptions, rawPurchases, customer] = await Promise.all([
    list(`${base}/customers/${userId}/subscriptions?environment=${environment}`),
    list(`${base}/customers/${userId}/purchases?environment=${environment}`),
    getRevenueCatCustomer(userId),
  ]);
  if (customer.original_app_user_id !== userId) throw new Error('purchase_account_conflict');
  const products = new Map<string, string>();
  async function productId(id: string) {
    let value = products.get(id);
    if (!value) {
      value = z
        .object({ store_identifier: z.string() })
        .parse(await get(`${base}/products/${encodeURIComponent(id)}`)).store_identifier;
      products.set(id, value);
    }
    return value;
  }
  const snapshots: BillingSnapshot[] = [];
  for (const raw of rawSubscriptions) {
    const s = subscriptionSchema.parse(raw);
    if (!['app_store', 'play_store'].includes(s.store) || s.environment !== environment) continue;
    if (
      s.customer_id !== userId ||
      s.original_customer_id !== userId ||
      s.ownership !== 'purchased'
    )
      throw new Error('purchase_account_conflict');
    const provider = s.store === 'app_store' ? 'apple' : 'google',
      sku = await productId(s.product_id),
      key = productForProvider(provider, sku);
    if (!key || key === 'single_tryout_pro') continue;
    const snapshot = verifiedNativeSubscription({
      customer,
      userId,
      provider,
      productId: sku,
      productKey: key,
      contractId: s.id,
      observedAt,
    });
    snapshot.purchase_started_at = new Date(s.starts_at).toISOString();
    snapshot.current_period_start = new Date(s.current_period_starts_at).toISOString();
    snapshot.current_period_end = new Date(
      s.current_period_ends_at ?? Date.parse(snapshot.current_period_end!),
    ).toISOString();
    // V2 is authoritative about revocation/access, V1 supplies the exact grace boundary and refund timestamp.
    if (!s.gives_access && snapshot.status !== 'refunded')
      snapshot.status =
        s.status === 'paused' ? 'paused' : s.status === 'incomplete' ? 'incomplete' : 'expired';
    snapshot.cancel_at_period_end = ['will_not_renew', 'will_pause'].includes(
      s.auto_renewal_status,
    );
    const pending = s.pending_changes?.product?.store_identifier;
    const pendingKey = pending ? productForProvider(provider, pending) : null;
    if (pendingKey && pendingKey !== key && s.current_period_ends_at) {
      snapshot.pending_product_key = pendingKey;
      snapshot.downgrade_effective_at = new Date(
        s.pending_changes?.current_period_starts_at ?? s.current_period_ends_at,
      ).toISOString();
    }
    snapshots.push(snapshot);
  }
  for (const raw of rawPurchases) {
    const p = purchaseSchema.parse(raw);
    if (!['app_store', 'play_store'].includes(p.store) || p.environment !== environment) continue;
    if (
      p.customer_id !== userId ||
      p.original_customer_id !== userId ||
      p.ownership !== 'purchased'
    )
      throw new Error('purchase_account_conflict');
    const provider = p.store === 'app_store' ? 'apple' : 'google',
      key = productForProvider(provider, await productId(p.product_id));
    if (key !== 'single_tryout_pro') continue;
    snapshots.push(
      billingSnapshotSchema.parse({
        provider,
        environment,
        provider_contract_id: p.id,
        provider_customer_id: userId,
        purchaser_id: userId,
        product_key: key,
        status: p.status === 'owned' ? 'active' : 'refunded',
        current_period_start: new Date(p.purchased_at).toISOString(),
        current_period_end: null,
        observed_at: observedAt,
      }),
    );
  }
  return snapshots;
}
