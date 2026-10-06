import { assertManagedPrice } from './stripe-managed-payments';
import { subscriptionTaxSettings } from './stripe-tax';
import 'server-only';
import { createHash } from 'node:crypto';
import type Stripe from 'stripe';
import { billingConfiguration, productForProvider } from './configuration';
import { BILLING_PRODUCTS, type BillingProductKey } from '../domain/billing-products';

export class PlanChangeConflict extends Error {}
const conflict = () =>
  new PlanChangeConflict(
    'Refresh your subscription and review the change again. Cancel any pending change or cancellation first.',
  );
export type PlanChangeAccount = {
  provider_contract_id: string;
  provider_customer_id: string;
  organization_id: string;
  purchaser_id: string;
};
export type PlanChangeQuote = {
  product: BillingProductKey;
  name: string;
  price: string;
  interval: 'month' | 'year';
  effectiveAt: string;
  token: string;
};

async function currentSubscription(stripe: Stripe, account: PlanChangeAccount) {
  const sub = await stripe.subscriptions.retrieve(account.provider_contract_id);
  subscriptionTaxSettings(sub);
  const customer = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
  if (
    customer !== account.provider_customer_id ||
    sub.metadata.organization_id !== account.organization_id ||
    sub.metadata.purchaser_id !== account.purchaser_id ||
    sub.metadata.billing_version !== '2' ||
    sub.livemode !== (billingConfiguration().environment === 'production') ||
    sub.status !== 'active' ||
    sub.items.data.length !== 1 ||
    sub.pending_update ||
    sub.cancel_at ||
    sub.cancel_at_period_end ||
    sub.pause_collection ||
    sub.collection_method !== 'charge_automatically' ||
    sub.discounts.length ||
    sub.default_tax_rates?.length
  )
    throw conflict();
  const item = sub.items.data[0]!;
  if (
    item.quantity !== 1 ||
    item.discounts.length ||
    item.tax_rates?.length ||
    item.current_period_end <= Date.now() / 1000 ||
    !productForProvider('stripe', item.price.id)
  )
    throw conflict();
  return sub;
}

function hasAppliedChange(
  schedule: Stripe.SubscriptionSchedule,
  sub: Stripe.Subscription,
  account: PlanChangeAccount,
) {
  const next = schedule.phases[1];
  const price = next?.items[0]?.price;
  return (
    schedule.status === 'active' &&
    schedule.phases.length === 2 &&
    schedule.metadata?.organization_id === account.organization_id &&
    !!schedule.metadata?.tryoutflow_attempt &&
    !!next &&
    next.items.length === 1 &&
    next.start_date <= sub.items.data[0]!.current_period_start &&
    (typeof price === 'string' ? price : price?.id) === sub.items.data[0]!.price.id
  );
}

export async function previewStripePlanChange(
  stripe: Stripe,
  account: PlanChangeAccount,
  product: BillingProductKey,
  recoveringSchedule: string | null = null,
) {
  if (product === 'single_tryout_pro') throw conflict();
  const sub = await currentSubscription(stripe, account);
  if (
    sub.schedule &&
    (typeof sub.schedule === 'string' ? sub.schedule : sub.schedule.id) !== recoveringSchedule
  ) {
    const schedule = await stripe.subscriptionSchedules.retrieve(
      typeof sub.schedule === 'string' ? sub.schedule : sub.schedule.id,
    );
    if (!hasAppliedChange(schedule, sub, account)) throw conflict();
  }
  const item = sub.items.data[0]!;
  const priceId = billingConfiguration().products[product].stripe;
  if (!priceId || priceId === item.price.id) throw conflict();
  const price = await stripe.prices.retrieve(
    priceId,
    sub.managed_payments?.enabled ? { expand: ['product'] } : undefined,
  );
  if (sub.managed_payments?.enabled) assertManagedPrice(price, sub.livemode);
  if (
    !price.active ||
    price.livemode !== sub.livemode ||
    price.type !== 'recurring' ||
    price.recurring?.interval !== BILLING_PRODUCTS[product].interval ||
    price.recurring.interval_count !== 1 ||
    price.recurring.usage_type !== 'licensed' ||
    price.unit_amount === null ||
    price.currency !== item.price.currency ||
    price.billing_scheme !== 'per_unit' ||
    price.transform_quantity
  )
    throw conflict();
  const interval = price.recurring.interval as 'month' | 'year';
  // Bind confirmation to provider state and price; a renewed period or changed price
  // requires a new review. No client-provided amount/date can alter the subscription.
  const token = createHash('sha256')
    .update(
      JSON.stringify([
        sub.id,
        item.id,
        item.price.id,
        item.current_period_start,
        item.current_period_end,
        price.id,
        price.unit_amount,
        price.currency,
        interval,
        ...(sub.automatic_tax.enabled ? [subscriptionTaxSettings(sub), price.tax_behavior] : []),
      ]),
    )
    .digest('hex');
  const digits =
    new Intl.NumberFormat('en', { style: 'currency', currency: price.currency }).resolvedOptions()
      .maximumFractionDigits ?? 2;
  const quote: PlanChangeQuote = {
    product,
    name: BILLING_PRODUCTS[product].name,
    price: new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: price.currency,
      currencyDisplay: 'code',
    }).format(price.unit_amount / 10 ** digits),
    interval,
    effectiveAt: new Date(item.current_period_end * 1000).toISOString(),
    token,
  };
  return { sub, price, quote };
}

export async function scheduleStripePlanChange(
  stripe: Stripe,
  account: PlanChangeAccount,
  product: BillingProductKey,
  token: string,
  attemptId: string,
) {
  // Replaying the same operation recovers the same schedule; Stripe also rejects
  // attaching a second schedule to a subscription during concurrent requests.
  const existing = await currentSubscription(stripe, account);
  const tax = subscriptionTaxSettings(existing);
  const taxSuffix = existing.managed_payments?.enabled
    ? '_managed_v1'
    : tax.enabled
      ? '_tax_v1'
      : '';
  const taxParameters = tax.enabled ? { automatic_tax: tax } : {};
  let recoveringSchedule: string | null = null;
  if (existing.schedule) {
    const schedule = await stripe.subscriptionSchedules.retrieve(
      typeof existing.schedule === 'string' ? existing.schedule : existing.schedule.id,
    );
    if (
      schedule.metadata?.tryoutflow_attempt === attemptId &&
      schedule.metadata?.tryoutflow_quote === token &&
      schedule.metadata?.tryoutflow_product === product
    ) {
      if (
        tax.enabled &&
        schedule.phases.some(
          (p) =>
            !p.automatic_tax?.enabled ||
            JSON.stringify(p.automatic_tax.liability) !== JSON.stringify(tax.liability),
        )
      )
        throw conflict();
      return schedule;
    }
    if (hasAppliedChange(schedule, existing, account)) {
      // The requested phase already took effect. Release only this app's completed
      // transition so the next confirmed change can attach a fresh schedule.
      const reviewed = await previewStripePlanChange(stripe, account, product);
      if (reviewed.quote.token !== token) throw conflict();
      await stripe.subscriptionSchedules.release(
        schedule.id,
        {},
        { idempotencyKey: `tf_change_release_${schedule.id}` },
      );
    } else {
      if (schedule.metadata?.tryoutflow_attempt || schedule.phases.length !== 1) throw conflict();
      // Recover an interrupted create/update pair only through Stripe's matching
      // idempotency record. Never adopt a schedule created by another operation.
      const recovered = await stripe.subscriptionSchedules.create(
        { from_subscription: existing.id },
        { idempotencyKey: `tf_change_create_${existing.id}_${attemptId}` },
      );
      if (recovered.id !== schedule.id) throw conflict();
      recoveringSchedule = schedule.id;
    }
  }
  const { sub, price, quote } = await previewStripePlanChange(
    stripe,
    account,
    product,
    recoveringSchedule,
  );
  if (quote.token !== token) throw conflict();
  const schedule = await stripe.subscriptionSchedules.create(
    { from_subscription: sub.id },
    { idempotencyKey: `tf_change_create_${sub.id}_${attemptId}` },
  );
  if (schedule.status !== 'active' || schedule.phases.length !== 1) throw conflict();
  const phase = schedule.phases[0]!;
  const item = sub.items.data[0]!;
  // Explicitly preserve the current paid period. The next price starts at renewal;
  // no upgrade charge or loss of current access happens during this request.
  return stripe.subscriptionSchedules.update(
    schedule.id,
    {
      end_behavior: 'release',
      proration_behavior: 'none',
      ...(tax.enabled ? { default_settings: taxParameters } : {}),
      metadata: {
        tryoutflow_attempt: attemptId,
        tryoutflow_quote: token,
        tryoutflow_product: product,
        organization_id: account.organization_id,
      },
      phases: [
        {
          ...taxParameters,
          start_date: phase.start_date,
          end_date: item.current_period_end,
          items: [{ price: item.price.id, quantity: 1 }],
          proration_behavior: 'none',
        },
        {
          ...taxParameters,
          start_date: item.current_period_end,
          duration: { interval: quote.interval, interval_count: 1 },
          items: [{ price: price.id, quantity: 1 }],
          proration_behavior: 'none',
          metadata: { product_key: product },
        },
      ],
    },
    { idempotencyKey: `tf_change_update${taxSuffix}_${schedule.id}_${attemptId}` },
  );
}

export async function cancelStripePlanChange(
  stripe: Stripe,
  account: PlanChangeAccount,
  expectedProduct: string,
  expectedEffectiveAt: string,
) {
  const sub = await currentSubscription(stripe, account);
  if (!sub.schedule) return;
  const id = typeof sub.schedule === 'string' ? sub.schedule : sub.schedule.id;
  const schedule = await stripe.subscriptionSchedules.retrieve(id);
  // Release, never cancel: cancellation would terminate the paid subscription.
  if (
    schedule.metadata?.organization_id !== account.organization_id ||
    !schedule.metadata?.tryoutflow_attempt ||
    schedule.status !== 'active' ||
    schedule.metadata?.tryoutflow_product !== expectedProduct ||
    (schedule.phases[1]?.start_date ?? 0) * 1000 !== Date.parse(expectedEffectiveAt) ||
    schedule.phases[1]?.start_date !== sub.items.data[0]!.current_period_end
  )
    throw conflict();
  await stripe.subscriptionSchedules.release(id, {}, { idempotencyKey: `tf_change_release_${id}` });
}
