import { launchManagedCoverage } from './stripe-managed-coverage';
import { taxCalculationComplete } from './stripe-tax';
import 'server-only';
import Stripe from 'stripe';
import { billingConfiguration, productForProvider } from './configuration';
import { billingSnapshotSchema, type BillingSnapshot } from './contracts';
import { normalizeSubscriptionStatus } from '../domain/provider-status';
export function stripeBillingClient() {
  const configuration = billingConfiguration();
  const key = process.env.STRIPE_SECRET_KEY;
  if (
    !key ||
    !(configuration.environment === 'production'
      ? /^(sk|rk)_live_/.test(key)
      : /^(sk|rk)_test_/.test(key))
  )
    throw new Error('billing_environment_mismatch');
  return new Stripe(key, { timeout: 10_000, maxNetworkRetries: 1 });
}
const iso = (seconds: number) => new Date(seconds * 1000).toISOString();
export function stripeSubscriptionSnapshot(
  subscription: Stripe.Subscription,
  observedAt: string,
): BillingSnapshot {
  const items = subscription.items.data;
  if (items.length !== 1) throw new Error('unsupported_subscription_items');
  const item = items[0]!;
  const product = productForProvider('stripe', item.price.id);
  if (!product || product === 'single_tryout_pro') throw new Error('unknown_product');
  return billingSnapshotSchema.parse({
    provider: 'stripe',
    environment: subscription.livemode ? 'production' : 'sandbox',
    provider_contract_id: subscription.id,
    provider_customer_id:
      typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id,
    purchaser_id: subscription.metadata.purchaser_id,
    product_key: product,
    status: normalizeSubscriptionStatus('stripe', subscription.status),
    current_period_start: iso(item.current_period_start),
    current_period_end: iso(item.current_period_end),
    // The portal can schedule cancellation with cancel_at while leaving the legacy
    // flag false. Do not label a later-period cancellation as ending this paid period.
    cancel_at_period_end:
      subscription.cancel_at_period_end || subscription.cancel_at === item.current_period_end,
    observed_at: observedAt,
  });
}
export async function loadStripeSnapshot(id: string) {
  // Timestamp before network I/O prevents a slower older request overwriting a newer verified snapshot.
  const observedAt = new Date().toISOString();
  const stripe = stripeBillingClient();
  const subscription = await stripe.subscriptions.retrieve(id, { expand: ['schedule'] });
  const snapshot = stripeSubscriptionSnapshot(subscription, observedAt);
  let accessInvoiceId =
    typeof subscription.latest_invoice === 'string'
      ? subscription.latest_invoice
      : subscription.latest_invoice?.id;
  const taxRequired = ['standard_tax_v1', 'managed_v1'].includes(
    subscription.metadata.tax_protocol ?? '',
  );
  if (
    subscription.metadata.tax_protocol === 'managed_v1' &&
    subscription.managed_payments?.enabled !== true &&
    !['canceled', 'unpaid', 'incomplete_expired', 'paused'].includes(subscription.status)
  )
    throw new Error('managed_subscription_not_verified');
  const taxEnabled =
    taxRequired ||
    subscription.automatic_tax?.enabled ||
    !!subscription.automatic_tax?.disabled_reason;
  if (
    taxEnabled &&
    !['canceled', 'unpaid', 'incomplete_expired', 'paused'].includes(subscription.status)
  ) {
    const invoice = accessInvoiceId ? await stripe.invoices.retrieve(accessInvoiceId) : null;
    if (
      subscription.metadata.tax_protocol === 'managed_v1' &&
      !launchManagedCoverage(
        subscription.metadata.managed_seller_country,
        invoice?.customer_address?.country,
      )
    )
      throw new Error('managed_coverage_not_verified');
    if (
      !invoice ||
      invoice.status !== 'paid' ||
      !taxCalculationComplete(invoice.automatic_tax, taxEnabled)
    )
      snapshot.status = 'past_due';
  }
  if (subscription.schedule && typeof subscription.schedule !== 'string') {
    const next = subscription.schedule.phases.find(
      (p) =>
        p.start_date > Date.parse(snapshot.current_period_start) / 1000 &&
        p.start_date >= Date.parse(snapshot.current_period_end!) / 1000,
    );
    if (next && next.items.length === 1) {
      const price = next.items[0]!.price;
      const key = productForProvider('stripe', typeof price === 'string' ? price : price.id);
      if (key && key !== snapshot.product_key) {
        snapshot.pending_product_key = key;
        snapshot.downgrade_effective_at = iso(next.start_date);
      }
    }
  }
  if (snapshot.status === 'past_due') {
    const paid = await stripe.invoices.list({
      subscription: subscription.id,
      status: 'paid',
      limit: 1,
    });
    const invoice = paid.data.find(
      (i) => !taxEnabled || taxCalculationComplete(i.automatic_tax, taxRequired),
    );
    const line = invoice?.lines.data
      .filter((l) => l.amount > 0 && l.pricing?.price_details?.price)
      .sort((a, b) => b.period.end - a.period.end)[0];
    if (line) {
      // A failed renewal can leave access backed by an earlier paid invoice.
      // Its refund/dispute state must follow the same period as the grant.
      accessInvoiceId = invoice?.id;
      snapshot.current_period_start = iso(line.period.start);
      snapshot.current_period_end = iso(line.period.end);
      const price = line.pricing?.price_details?.price;
      const key = typeof price === 'string' ? productForProvider('stripe', price) : null;
      if (key && key !== 'single_tryout_pro') snapshot.product_key = key;
      const hours = Number(process.env.STRIPE_GRACE_PERIOD_HOURS ?? '0');
      if (!Number.isInteger(hours) || hours < 0 || hours > 168)
        throw new Error('invalid_grace_configuration');
      if (hours > 0) {
        snapshot.grace_period_end = iso(line.period.end + hours * 3600);
        snapshot.status =
          Date.parse(snapshot.grace_period_end) > Date.now() ? 'grace_period' : 'past_due';
      }
    } else snapshot.status = 'incomplete';
  }
  if (accessInvoiceId) {
    const payments = await stripe.invoicePayments.list({
      invoice: accessInvoiceId,
      status: 'paid',
      limit: 10,
    });
    if (payments.has_more) throw new Error('unsupported_invoice_payments');
    for (const item of payments.data) {
      const payment = item.payment.payment_intent;
      const intent = payment
        ? await stripe.paymentIntents.retrieve(typeof payment === 'string' ? payment : payment.id, {
            expand: ['latest_charge'],
          })
        : null;
      const directCharge = item.payment.charge;
      const charge =
        intent?.latest_charge ??
        (directCharge
          ? await stripe.charges.retrieve(
              typeof directCharge === 'string' ? directCharge : directCharge.id,
            )
          : null);
      if (charge && typeof charge !== 'string') {
        const state = await chargeAccessState(stripe, charge);
        if (state !== 'active') snapshot.status = state;
      }
    }
  }
  return { snapshot, intentId: subscription.metadata.billing_intent_id ?? null };
}

export async function stripeChargeSnapshots(
  chargeId: string,
  state: 'active' | 'paused' | 'refunded',
) {
  const stripe = stripeBillingClient(),
    charge = await stripe.charges.retrieve(chargeId, { expand: ['payment_intent'] });
  const payment = charge.payment_intent;
  if (!payment) return [];
  const paymentId = typeof payment === 'string' ? payment : payment.id;
  const targetState = charge.refunded ? 'refunded' : state;
  if (
    typeof payment !== 'string' &&
    payment.metadata.billing_version === '2' &&
    payment.metadata.product_key === 'single_tryout_pro'
  ) {
    if (
      targetState === 'active' &&
      ['standard_tax_v1', 'managed_v1'].includes(payment.metadata.tax_protocol ?? '')
    ) {
      const sessions = await stripe.checkout.sessions.list({
        payment_intent: payment.id,
        limit: 2,
      });
      const session = sessions.data[0];
      if (
        sessions.has_more ||
        sessions.data.length !== 1 ||
        !session ||
        session.payment_status !== 'paid' ||
        session.metadata?.billing_intent_id !== payment.metadata.billing_intent_id ||
        (payment.metadata.tax_protocol === 'managed_v1' &&
          (session.managed_payments?.enabled !== true ||
            !launchManagedCoverage(
              payment.metadata.managed_seller_country,
              session.customer_details?.address?.country,
            ))) ||
        !taxCalculationComplete(session.automatic_tax, true)
      )
        throw new Error('unverified_checkout_tax');
    }
    return [
      {
        snapshot: billingSnapshotSchema.parse({
          provider: 'stripe',
          environment: charge.livemode ? 'production' : 'sandbox',
          provider_contract_id: payment.id,
          provider_customer_id:
            typeof charge.customer === 'string' ? charge.customer : charge.customer?.id,
          purchaser_id: payment.metadata.purchaser_id,
          product_key: 'single_tryout_pro',
          status: targetState,
          current_period_start: iso(payment.created),
          current_period_end: null,
          observed_at: new Date().toISOString(),
        }),
        intentId: payment.metadata.billing_intent_id ?? null,
      },
    ];
  }
  const payments = await stripe.invoicePayments.list({
    payment: { type: 'payment_intent', payment_intent: paymentId },
    limit: 10,
  });
  if (payments.has_more) throw new Error('ambiguous_payment');
  const results = [];
  for (const payment of payments.data) {
    const invoice = await stripe.invoices.retrieve(
      typeof payment.invoice === 'string' ? payment.invoice : payment.invoice.id,
    );
    const subscription = invoice.parent?.subscription_details?.subscription,
      id = typeof subscription === 'string' ? subscription : subscription?.id;
    if (!id) continue;
    const authoritative = await stripe.subscriptions.retrieve(id);
    if (authoritative.metadata.billing_version !== '2') continue;
    // Re-read the invoice supplying current access. A delayed callback for an
    // older invoice or a resolved dispute cannot overwrite that verified state.
    results.push(await loadStripeSnapshot(id));
  }
  return results;
}

export async function loadStripeCheckoutSnapshot(sessionId: string) {
  const stripe = stripeBillingClient();
  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ['line_items', 'payment_intent.latest_charge'],
  });
  if (session.metadata?.billing_version !== '2') return null;
  if (
    session.metadata.tax_protocol === 'managed_v1' &&
    (session.managed_payments?.enabled !== true ||
      !launchManagedCoverage(
        session.metadata.managed_seller_country,
        session.customer_details?.address?.country,
      ))
  )
    return null;
  if (
    !taxCalculationComplete(
      session.automatic_tax,
      ['standard_tax_v1', 'managed_v1'].includes(session.metadata.tax_protocol ?? ''),
    )
  )
    return null;
  if (session.mode === 'subscription') {
    const id =
      typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
    return id ? loadStripeSnapshot(id) : null;
  }
  if (session.payment_status !== 'paid') return null;
  const price = session.line_items?.data[0]?.price;
  const product = price ? productForProvider('stripe', price.id) : null;
  if (product !== 'single_tryout_pro' || session.line_items?.data.length !== 1)
    throw new Error('unknown_product');
  const payment = session.payment_intent;
  if (!payment || typeof payment === 'string' || payment.status !== 'succeeded')
    throw new Error('unverified_payment');
  const charge = payment.latest_charge;
  return {
    snapshot: billingSnapshotSchema.parse({
      provider: 'stripe',
      environment: session.livemode ? 'production' : 'sandbox',
      provider_contract_id: payment.id,
      provider_customer_id:
        typeof session.customer === 'string' ? session.customer : session.customer?.id,
      purchaser_id: session.metadata.purchaser_id,
      product_key: product,
      status:
        charge && typeof charge !== 'string' ? await chargeAccessState(stripe, charge) : 'active',
      current_period_start: iso(payment.created),
      current_period_end: null,
      observed_at: new Date().toISOString(),
    }),
    intentId: session.metadata.billing_intent_id ?? null,
  };
}

async function chargeAccessState(
  stripe: Stripe,
  charge: Stripe.Charge,
): Promise<'active' | 'paused' | 'refunded'> {
  if (charge.refunded) return 'refunded';
  if (!charge.disputed) return 'active';
  const disputes = await stripe.disputes.list({ charge: charge.id, limit: 10 });
  if (disputes.has_more) throw new Error('unsupported_disputes');
  if (disputes.data.some((d) => d.status === 'lost')) return 'refunded';
  return disputes.data.some((d) => !['won', 'warning_closed'].includes(d.status))
    ? 'paused'
    : 'active';
}
export async function loadStripeTryoutSnapshot(paymentId: string) {
  const stripe = stripeBillingClient();
  const payment = await stripe.paymentIntents.retrieve(paymentId, { expand: ['latest_charge'] });
  if (
    payment.metadata.billing_version !== '2' ||
    payment.metadata.product_key !== 'single_tryout_pro'
  )
    throw new Error('unknown_payment');
  const charge = payment.latest_charge;
  if (!charge || typeof charge === 'string') throw new Error('unverified_payment');
  return stripeChargeSnapshots(charge.id, await chargeAccessState(stripe, charge));
}
