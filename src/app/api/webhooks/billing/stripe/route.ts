import { withBillingDelivery } from '@/modules/subscriptions/application/billing-delivery';
import { createHash } from 'node:crypto';
import Stripe from 'stripe';
import { readBoundedStripeBody, parseStripeSignatureTimestamp } from '../../stripe/stripe-webhook';
import { SystemClock } from '@/lib/clock';
import {
  stripeSubscriptionSnapshot,
  loadStripeSnapshot,
  stripeBillingClient,
  stripeChargeSnapshots,
  loadStripeCheckoutSnapshot,
} from '@/modules/subscriptions/providers/stripe';
import { applyBillingSnapshot } from '@/modules/subscriptions/application/billing-service';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  let event: Stripe.Event;
  let digest: string;
  let verificationStage: 'body' | 'timestamp' | 'configuration' | 'signature' = 'body';
  try {
    const body = await readBoundedStripeBody(request);
    const signature = request.headers.get('stripe-signature') ?? '';
    verificationStage = 'timestamp';
    parseStripeSignatureTimestamp(signature, new SystemClock());
    verificationStage = 'configuration';
    if (!process.env.STRIPE_BILLING_WEBHOOK_SECRET) throw new Error('not_configured');
    const stripe = stripeBillingClient();
    verificationStage = 'signature';
    event = await stripe.webhooks.constructEventAsync(
      body,
      signature,
      process.env.STRIPE_BILLING_WEBHOOK_SECRET,
      300,
    );
    digest = createHash('sha256').update(body).digest('hex');
  } catch (error) {
    const knownConfigurationError =
      error instanceof Error &&
      [
        'not_configured',
        'billing_not_configured',
        'billing_environment_mismatch',
        'ambiguous_product_configuration',
      ].includes(error.message)
        ? error.message
        : 'unknown';
    console.warn('stripe_billing_webhook_verification_failed', {
      stage: verificationStage,
      errorType: error instanceof Error ? error.name : 'unknown',
      ...(verificationStage === 'configuration' ? { reason: knownConfigurationError } : {}),
      ...(knownConfigurationError === 'billing_environment_mismatch'
        ? {
            billingMode: ['sandbox', 'production'].includes(process.env.BILLING_ENVIRONMENT ?? '')
              ? process.env.BILLING_ENVIRONMENT
              : 'unknown',
            stripeKeyMode: process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_')
              ? 'sandbox'
              : process.env.STRIPE_SECRET_KEY?.startsWith('sk_live_')
                ? 'production'
                : process.env.STRIPE_SECRET_KEY?.startsWith('rk_test_')
                  ? 'restricted_sandbox'
                  : process.env.STRIPE_SECRET_KEY?.startsWith('rk_live_')
                    ? 'restricted_production'
                    : process.env.STRIPE_SECRET_KEY?.trim() === '[SENSITIVE]'
                      ? 'placeholder'
                      : process.env.STRIPE_SECRET_KEY?.trim().startsWith('sk_')
                        ? 'surrounded_by_whitespace'
                        : 'unknown',
          }
        : {}),
    });
    return Response.json(
      {
        error:
          verificationStage === 'configuration'
            ? 'Billing webhook unavailable.'
            : 'Invalid webhook.',
      },
      { status: verificationStage === 'configuration' ? 503 : 400 },
    );
  }
  // Reject cross-environment events before recording delivery or reading provider objects.
  if (event.livemode !== (process.env.BILLING_ENVIRONMENT === 'production')) {
    return Response.json(
      { error: 'Webhook environment does not match this deployment.' },
      { status: 400 },
    );
  }
  return withBillingDelivery({ provider: 'stripe', id: event.id, type: event.type, digest }, () =>
    processStripeEvent(event, digest),
  );
}
async function processStripeEvent(event: Stripe.Event, digest: string) {
  try {
    const receipt = {
      provider: 'stripe',
      id: event.id,
      type: event.type as string,
      digest,
      occurred_at: new Date(event.created * 1000).toISOString(),
    };
    let subscriptionId: string | null = null;
    if (event.type.startsWith('customer.subscription.'))
      subscriptionId = (event.data.object as Stripe.Subscription).id;
    if (event.type === 'invoice.paid' || event.type === 'invoice.payment_failed') {
      const invoice = event.data.object as Stripe.Invoice;
      const subscription = invoice.parent?.subscription_details?.subscription;
      subscriptionId = typeof subscription === 'string' ? subscription : (subscription?.id ?? null);
    }
    if (
      event.type === 'checkout.session.completed' ||
      event.type === 'checkout.session.async_payment_succeeded'
    ) {
      const restored = await loadStripeCheckoutSnapshot(event.data.object.id);
      if (restored)
        return Response.json({
          outcome: await applyBillingSnapshot(receipt, restored.snapshot, restored.intentId),
        });
      return Response.json({ outcome: 'payment_pending' });
    }
    if (
      event.type === 'charge.refunded' ||
      event.type === 'charge.dispute.created' ||
      event.type === 'charge.dispute.closed'
    ) {
      let chargeId: string;
      let state: 'active' | 'paused' | 'refunded' = 'refunded';
      if (event.type === 'charge.refunded') {
        const charge = await stripeBillingClient().charges.retrieve(event.data.object.id);
        if (!charge.refunded) return Response.json({ outcome: 'partial_refund_retained' });
        chargeId = charge.id;
      } else {
        const dispute = await stripeBillingClient().disputes.retrieve(event.data.object.id);
        chargeId = typeof dispute.charge === 'string' ? dispute.charge : dispute.charge.id;
        state =
          dispute.status === 'won' || dispute.status === 'warning_closed'
            ? 'active'
            : dispute.status === 'lost'
              ? 'refunded'
              : 'paused';
        if (state === 'active') receipt.type = 'subscription_revocation_reversed';
      }
      const snapshots = await stripeChargeSnapshots(chargeId, state);
      for (const item of snapshots)
        await applyBillingSnapshot(
          { ...receipt, id: `${receipt.id}:${item.snapshot.provider_contract_id}` },
          item.snapshot,
          item.intentId,
        );
      return Response.json({ outcome: 'payment_reconciled' });
    }
    if (subscriptionId) {
      let authoritative: Stripe.Subscription;
      try {
        authoritative = await stripeBillingClient().subscriptions.retrieve(subscriptionId);
      } catch (error) {
        // Managed privacy deletion can remove the provider object. Only the
        // already signature/mode-verified cancellation payload may revoke access;
        // never reconstruct an active purchase from a missing provider object.
        const deleted = event.data.object as Stripe.Subscription;
        if (
          event.type !== 'customer.subscription.deleted' ||
          deleted.id !== subscriptionId ||
          deleted.status !== 'canceled' ||
          deleted.metadata?.billing_version !== '2' ||
          !(error instanceof Stripe.errors.StripeInvalidRequestError) ||
          error.statusCode !== 404
        )
          throw error;
        const snapshot = stripeSubscriptionSnapshot(deleted, new Date().toISOString());
        snapshot.status = 'expired';
        return Response.json({
          outcome: await applyBillingSnapshot(
            receipt,
            snapshot,
            deleted.metadata.billing_intent_id ?? null,
          ),
        });
      }

      if (authoritative.metadata.billing_version !== '2')
        return Response.json({ outcome: 'legacy_subscription' });
      const { snapshot, intentId } = await loadStripeSnapshot(subscriptionId);
      return Response.json({ outcome: await applyBillingSnapshot(receipt, snapshot, intentId) });
    }
    return Response.json({ outcome: 'ignored' });
  } catch {
    return Response.json(
      { error: 'Billing confirmation is temporarily unavailable.' },
      { status: 503 },
    );
  }
}
