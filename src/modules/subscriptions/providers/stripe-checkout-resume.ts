import 'server-only';
import { managedBillingCountryAllowed } from './managed-billing-country';
import type Stripe from 'stripe';

type PendingIntent = {
  id: string;
  organization_id: string;
  purchaser_id: string;
  tryout_id: string | null;
  provider: string;
  product_key: string;
  contract_id: string | null;
  expires_at: string;
  provider_session_id?: string | null;
};
/** Recover an interrupted checkout without creating another intent or purchase. */
export async function resumePendingStripeCheckout({
  stripe,
  intents,
  organizationId,
  purchaserId,
  productKey,
  tryoutId,
  priceId,
  environment,
  mode,
  requireAutomaticTax = false,
  requireManagedPayments = false,
  declaredBillingCountry,
}: {
  stripe: Pick<Stripe, 'checkout'>;
  intents: PendingIntent[];
  organizationId: string;
  purchaserId: string;
  productKey: string;
  tryoutId: string | null;
  priceId: string;
  environment: 'sandbox' | 'production';
  mode: 'payment' | 'subscription';
  requireAutomaticTax?: boolean;
  requireManagedPayments?: boolean;
  declaredBillingCountry?: unknown;
}): Promise<string | null> {
  if (requireManagedPayments && !managedBillingCountryAllowed(declaredBillingCountry)) return null;
  const now = Date.now();
  const matching = intents.filter(
    (i) =>
      i.organization_id === organizationId &&
      i.purchaser_id === purchaserId &&
      i.provider === 'stripe' &&
      i.product_key === productKey &&
      i.tryout_id === tryoutId &&
      i.contract_id === null &&
      !!i.provider_session_id &&
      Date.parse(i.expires_at) > now,
  );
  if (matching.length !== 1) return null;
  const intent = matching[0]!;
  const session = await stripe.checkout.sessions.retrieve(intent.provider_session_id!, {
    expand: ['line_items'],
  });
  if (
    requireManagedPayments &&
    (session.managed_payments?.enabled !== true ||
      session.metadata?.tax_protocol !== 'managed_v1' ||
      session.metadata?.managed_billing_country !== declaredBillingCountry)
  )
    return null;
  if (
    requireAutomaticTax &&
    (session.automatic_tax?.enabled !== true ||
      session.metadata?.tax_protocol !== 'standard_tax_v1' ||
      session.managed_payments?.enabled !== false)
  )
    return null;
  if (
    session.status !== 'open' ||
    session.payment_status !== 'unpaid' ||
    session.livemode !== (environment === 'production') ||
    session.mode !== mode ||
    session.expires_at * 1000 <= now ||
    session.client_reference_id !== intent.id ||
    session.metadata?.billing_version !== '2' ||
    session.metadata.billing_intent_id !== intent.id ||
    session.metadata.organization_id !== organizationId ||
    session.metadata.purchaser_id !== purchaserId ||
    session.metadata.product_key !== productKey ||
    (session.metadata.tryout_id ?? null) !== tryoutId ||
    session.line_items?.has_more ||
    session.line_items?.data.length !== 1 ||
    session.line_items.data[0]?.price?.id !== priceId ||
    session.line_items.data[0]?.quantity !== 1 ||
    !session.url
  )
    return null;
  const url = new URL(session.url);
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'checkout.stripe.com' ||
    url.username ||
    url.password
  )
    return null;
  return session.url;
}
