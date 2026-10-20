import { loadVerifiedNativePurchases } from '../providers/revenuecat-reconciliation';
import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { createAdminSupabaseClient } from '@/infrastructure/supabase/admin';
import { createServerSupabaseClient } from '@/infrastructure/supabase/server';
import { effectiveEntitlementsSchema, hasEntitlement } from '../domain/effective-entitlements';
import {
  billingSnapshotSchema,
  type BillingReceipt,
  type BillingSnapshot,
} from '../providers/contracts';
import { billingConfiguration } from '../providers/configuration';
import {
  loadStripeSnapshot,
  loadStripeCheckoutSnapshot,
  loadStripeTryoutSnapshot,
} from '../providers/stripe';
export async function getEffectiveEntitlements(
  organizationId: string,
  tryoutId: string | null = null,
) {
  const client = await createServerSupabaseClient();
  const { data, error } = await client.rpc('get_effective_entitlements', {
    p_organization_id: organizationId,
    p_tryout_id: tryoutId ?? undefined,
  });
  if (error) throw new Error('billing_access_unavailable');
  return effectiveEntitlementsSchema.parse(data);
}
export async function requireEntitlement(
  organizationId: string,
  feature: string,
  tryoutId: string | null = null,
) {
  const access = await getEffectiveEntitlements(organizationId, tryoutId);
  if (!hasEntitlement(access, feature)) throw new Error('entitlement_required');
  return access;
}
const contextSchema = z.object({
  enabled: z.boolean(),
  environment: z.enum(['sandbox', 'production']),
  contracts: z.array(
    billingSnapshotSchema.extend({
      id: z.uuid(),
      organization_id: z.uuid(),
      tryout_id: z.uuid().nullable(),
    }),
  ),
  intents: z.array(
    z.object({
      id: z.uuid(),
      organization_id: z.uuid(),
      tryout_id: z.uuid().nullable(),
      purchaser_id: z.uuid(),
      provider: z.enum(['stripe', 'apple', 'google']),
      product_key: billingSnapshotSchema.shape.product_key,
      created_at: z.string(),
      expires_at: z.string(),
      contract_id: z.uuid().nullable(),
      provider_session_id: z.string().nullable().optional(),
    }),
  ),
});
export async function providerContext(
  organizationId: string | null = null,
  purchaserId: string | null = null,
) {
  const { data, error } = await createAdminSupabaseClient().rpc('billing_provider_context', {
    p_organization_id: organizationId ?? undefined,
    p_purchaser_id: purchaserId ?? undefined,
  });
  if (error) throw new Error('billing_unavailable');
  const context = contextSchema.parse(data);
  if (!context.enabled) throw new Error('billing_not_enabled');
  if (context.environment !== billingConfiguration().environment)
    throw new Error('billing_environment_mismatch');
  return context;
}
export async function applyBillingSnapshot(
  receipt: BillingReceipt,
  snapshot: BillingSnapshot,
  intentId: string | null = null,
) {
  const parsed = billingSnapshotSchema.parse(snapshot);
  const { data, error } = await createAdminSupabaseClient().rpc('apply_billing_snapshot', {
    p_event: receipt,
    p_snapshot: parsed,
    p_intent_id: intentId ?? undefined,
  });
  if (error) throw new Error('billing_reconciliation_failed');
  if (data === 'environment_mismatch' || data === 'event_conflict')
    throw new Error('billing_event_conflict');
  return data;
}
export function reconciliationReceipt(
  snapshot: BillingSnapshot,
  type = 'subscription_reconciled',
): BillingReceipt {
  return {
    provider: snapshot.provider,
    id: `reconcile_${randomUUID()}`,
    type,
    digest: createHash('sha256').update(JSON.stringify(snapshot)).digest('hex'),
    occurred_at: snapshot.observed_at,
  };
}
/** Called after explicit management/restore, webhooks or scheduled recovery; never on ordinary page loads. */
export async function reconcileOrganizationSubscription(organizationId: string) {
  const context = await providerContext(organizationId);
  const results = [];
  for (const contract of context.contracts.filter((c) => c.provider === 'stripe' && !c.tryout_id)) {
    const snapshot = (await loadStripeSnapshot(contract.provider_contract_id)).snapshot;
    results.push(await applyBillingSnapshot(reconciliationReceipt(snapshot), snapshot));
  }
  for (const contract of context.contracts.filter((c) => c.provider === 'stripe' && c.tryout_id)) {
    for (const verified of await loadStripeTryoutSnapshot(contract.provider_contract_id)) {
      results.push(
        await applyBillingSnapshot(reconciliationReceipt(verified.snapshot), verified.snapshot),
      );
    }
  }
  for (const intent of context.intents.filter(
    (i) => i.provider === 'stripe' && !i.contract_id && i.provider_session_id,
  )) {
    const restored = await loadStripeCheckoutSnapshot(intent.provider_session_id!);
    if (restored)
      results.push(
        await applyBillingSnapshot(
          reconciliationReceipt(restored.snapshot, 'purchase_restored'),
          restored.snapshot,
          intent.id,
        ),
      );
  }
  const users = new Set([
    ...context.contracts.filter((c) => c.provider !== 'stripe').map((c) => c.purchaser_id),
    ...context.intents
      .filter((i) => i.provider !== 'stripe' && !i.contract_id)
      .map((i) => i.purchaser_id),
  ]);
  for (const userId of users)
    results.push(...(await reconcileNativePurchaser(userId, organizationId)));
  return results;
}

export async function reconcileNativePurchaser(
  userId: string,
  organizationId: string | null = null,
  receipt?: BillingReceipt,
) {
  const context = await providerContext(organizationId, userId),
    snapshots = await loadVerifiedNativePurchases(userId),
    results = [];
  snapshots.sort((a, b) => Number(a.status !== 'expired') - Number(b.status !== 'expired'));
  for (const snapshot of snapshots) {
    const existing = context.contracts.find(
      (c) =>
        c.provider === snapshot.provider &&
        c.provider_contract_id === snapshot.provider_contract_id,
    );
    const purchasedAt = Date.parse(snapshot.purchase_started_at ?? snapshot.current_period_start);
    const intents = context.intents.filter(
      (i) =>
        !i.contract_id &&
        i.provider === snapshot.provider &&
        i.product_key === snapshot.product_key &&
        Date.parse(i.created_at) - 300000 <= purchasedAt &&
        Date.parse(i.expires_at) >= purchasedAt,
    );
    let replacementId: string | undefined;
    if (!existing && intents.length === 0 && snapshot.product_key !== 'single_tryout_pro') {
      const prior = context.contracts.filter(
        (c) =>
          c.provider === snapshot.provider &&
          c.tryout_id === null &&
          c.product_key !== snapshot.product_key &&
          snapshots.some(
            (s) =>
              s.provider_contract_id === c.provider_contract_id &&
              s.status === 'expired' &&
              s.current_period_end &&
              Math.abs(purchasedAt - Date.parse(s.current_period_end)) <= 300000,
          ),
      );
      if (prior.length === 1) {
        const hash = createHash('sha256')
          .update(
            `replacement:${snapshot.provider}:${snapshot.environment}:${snapshot.provider_contract_id}`,
          )
          .digest('hex');
        const id = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
        const { data, error } = await createAdminSupabaseClient().rpc(
          'reserve_native_plan_replacement',
          { p_id: id, p_previous_id: prior[0]!.id, p_snapshot: snapshot },
        );
        if (error) throw new Error('replacement_attribution_required');
        replacementId = data;
      }
    }
    if (!existing && intents.length !== 1 && !replacementId) continue; // Unbound receipts require explicit original purchase attribution; never guess an organization.
    results.push(
      await applyBillingSnapshot(
        receipt
          ? { ...receipt, id: `${receipt.id}:${snapshot.provider_contract_id}` }
          : reconciliationReceipt(snapshot, 'purchase_restored'),
        snapshot,
        intents[0]?.id ?? replacementId ?? null,
      ),
    );
  }
  return results;
}
