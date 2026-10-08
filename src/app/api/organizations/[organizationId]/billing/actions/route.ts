import { managedBillingCountryAllowed } from '@/modules/subscriptions/providers/managed-billing-country';
import { managedPrePaymentEnforcementAvailable } from '@/modules/subscriptions/providers/stripe-managed-coverage';
import { assertManagedPrice } from '@/modules/subscriptions/providers/stripe-managed-payments';
import { stripeCheckoutIdentity } from '@/modules/subscriptions/providers/stripe-checkout-identity';
import { resumePendingStripeCheckout } from '@/modules/subscriptions/providers/stripe-checkout-resume';
import { createAdminSupabaseClient } from '@/infrastructure/supabase/admin';
import { z } from 'zod';
import Stripe from 'stripe';
import { ownerBillingContext } from '@/modules/subscriptions/application/billing-request';
import { checkoutReturnStatus } from '@/modules/subscriptions/application/checkout-return-status';
import {
  providerContext,
  reconcileOrganizationSubscription,
} from '@/modules/subscriptions/application/billing-service';
import { billingConfiguration } from '@/modules/subscriptions/providers/configuration';
import { stripeBillingClient } from '@/modules/subscriptions/providers/stripe';
import { BILLING_PRODUCTS, managementUrl } from '@/modules/subscriptions/domain/billing-products';
import { readBoundedStripeBody } from '@/app/api/webhooks/stripe/stripe-webhook';
const schema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('purchase'),
    product: z.enum([
      'pro_monthly',
      'pro_annual',
      'organization_monthly',
      'organization_annual',
      'single_tryout_pro',
    ]),
    provider: z.enum(['stripe', 'apple', 'google']),
    attemptId: z.uuid(),
    checkoutProtocol: z.enum(['standard_v1', 'standard_tax_v1', 'managed_v1']).optional(),
    billingCountry: z.unknown().optional(),
    tryoutId: z.uuid().nullable().default(null),
  }),
  z.object({ action: z.enum(['manage', 'reconcile', 'restore', 'start_trial']) }),
]);
export const runtime = 'nodejs';
export async function GET(
  request: Request,
  { params }: { params: Promise<{ organizationId: string }> },
) {
  try {
    const { organizationId } = await params;
    z.uuid().parse(organizationId);
    const { client, user } = await ownerBillingContext(request, organizationId);
    const intentValues = new URL(request.url).searchParams.getAll('intent');
    const intentId = intentValues.length ? z.uuid().parse(intentValues[0]) : null;
    if (intentValues.length > 1) throw new Error('invalid_checkout_identity');
    const { data, error } = await client.rpc('get_billing_dashboard', {
      p_organization_id: organizationId,
    });
    if (error) throw error;
    const { data: tryouts, error: tryoutError } = await client
      .from('tryouts')
      .select('id,name')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false })
      .limit(500);
    if (tryoutError) throw tryoutError;
    let checkout;
    if (intentId) {
      try {
        checkout = checkoutReturnStatus(await providerContext(organizationId, user.id), {
          organizationId,
          purchaserId: user.id,
          intentId,
          now: new Date(),
        });
      } catch {
        checkout = { intentId, status: 'unavailable' as const };
      }
    }
    return Response.json(
      {
        ...z.record(z.string(), z.unknown()).parse(data),
        tryouts,
        ...(checkout ? { checkout } : {}),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    return Response.json(
      { error: 'Billing is unavailable. Check your account access and try again.' },
      { status: 403 },
    );
  }
}
export async function POST(
  request: Request,
  { params }: { params: Promise<{ organizationId: string }> },
) {
  try {
    const { organizationId } = await params;
    z.uuid().parse(organizationId);
    const { client, user, isNative } = await ownerBillingContext(request, organizationId);
    const input = schema.parse(
      JSON.parse(Buffer.from(await readBoundedStripeBody(request, 4096)).toString('utf8')),
    );
    // Web activation must not enable unverified native store purchases.
    // Keep restore/reconciliation and existing entitlement processing independent.
    if (
      input.action === 'purchase' &&
      (input.provider === 'apple' || input.provider === 'google') &&
      process.env.BILLING_NATIVE_PURCHASES_ENABLED !== 'true'
    ) {
      return Response.json(
        {
          code: 'native_purchases_disabled',
          error:
            'New store purchases are not available yet. You can still restore existing purchases.',
        },
        { status: 409 },
      );
    }
    if (input.action === 'start_trial') {
      const { data, error } = await client.rpc('start_pro_trial', {
        p_organization_id: organizationId,
      });
      if (error)
        return Response.json(
          { error: 'This trial is not available. Refresh your plan to see your current access.' },
          { status: 409 },
        );
      return Response.json({
        dashboard: data,
        message: 'Your 7-day Pro trial is ready. No payment method or automatic charge.',
      });
    }
    const { data: accessDashboard, error: accessError } = await client.rpc(
      'get_billing_dashboard',
      { p_organization_id: organizationId },
    );
    if (accessError) throw accessError;
    if (
      input.action === 'purchase' &&
      (accessDashboard as { purchasesEnabled?: boolean }).purchasesEnabled === false
    ) {
      return Response.json({ error: 'Paid plans are not available yet.' }, { status: 409 });
    }
    if (
      input.action === 'reconcile' &&
      (accessDashboard as { purchasesEnabled?: boolean }).purchasesEnabled === false
    ) {
      return Response.json({
        dashboard: accessDashboard,
        message: 'Your current access is up to date.',
      });
    }
    const context = await providerContext(organizationId);
    if (input.action === 'restore' || input.action === 'reconcile') {
      if (
        input.action === 'restore' &&
        context.contracts.some((c) => c.provider !== 'stripe' && c.purchaser_id !== user.id)
      )
        return Response.json(
          {
            error:
              'This purchase belongs to another account. Sign in with the original purchasing account.',
          },
          { status: 409 },
        );
      await reconcileOrganizationSubscription(organizationId);
      const { data, error } = await client.rpc('get_billing_dashboard', {
        p_organization_id: organizationId,
      });
      if (error) throw error;
      return Response.json({
        dashboard: data,
        message:
          input.action === 'restore'
            ? 'Purchase records checked. Your current access is shown below.'
            : 'Subscription updated.',
      });
    }
    const { data: organization, error: orgError } = await client
      .from('organizations')
      .select('slug')
      .eq('id', organizationId)
      .single();
    if (orgError) throw orgError;
    const origin = new URL(process.env.NEXT_PUBLIC_APP_URL!).origin;
    const returnUrl = `${origin}/app/${encodeURIComponent(organization.slug)}/organization/billing`;
    if (input.action === 'manage') {
      const contract = context.contracts
        .filter((c) => !c.tryout_id)
        .sort((a, b) => Date.parse(b.observed_at) - Date.parse(a.observed_at))[0];
      if (!contract)
        return Response.json(
          { error: 'Use the existing plan controls below to manage your subscription.' },
          { status: 409 },
        );
      if (contract.provider !== 'stripe')
        return Response.json({ url: managementUrl(contract.provider) });
      if (isNative)
        return Response.json(
          { error: 'This subscription was purchased on the web. Manage it from your web account.' },
          { status: 409 },
        );
      const portalConfiguration = process.env.STRIPE_BILLING_PORTAL_CONFIGURATION_ID;
      if (!portalConfiguration?.startsWith('bpc_')) throw new Error('billing_portal_unavailable');
      const session = await stripeBillingClient().billingPortal.sessions.create({
        configuration: portalConfiguration,
        customer: contract.provider_customer_id,
        return_url: returnUrl,
      });
      return Response.json({ url: session.url });
    }
    if (input.action !== 'purchase') throw new Error('invalid_action');
    const productConfig = billingConfiguration().products[input.product][input.provider];
    if (!productConfig)
      return Response.json(
        { error: 'This plan is not available for purchase yet.' },
        { status: 409 },
      );
    if ((isNative && input.provider === 'stripe') || (!isNative && input.provider !== 'stripe'))
      return Response.json(
        { error: 'Please use the purchase options for this device.' },
        { status: 400 },
      );
    if (input.provider === 'stripe' && process.env.BILLING_CHECKOUT_ENABLED !== 'true')
      return Response.json(
        {
          code: 'checkout_disabled',
          error: 'Paid web checkout is not available yet. No purchase has been created.',
        },
        { status: 409 },
      );
    // New web purchases cannot opt out of the Managed coverage boundary.
    // Historical contracts still reconcile through their recorded protocol.
    if (input.provider === 'stripe' && input.checkoutProtocol !== 'managed_v1')
      return Response.json(
        {
          code: 'managed_checkout_required',
          error:
            'Refresh billing and choose a supported billing country before checkout. No purchase has been created.',
        },
        { status: 409 },
      );
    if (
      input.checkoutProtocol === 'managed_v1' &&
      !managedBillingCountryAllowed(input.billingCountry)
    )
      return Response.json(
        {
          code: 'managed_billing_country_required',
          error:
            'Declare a supported billing country (Canada or United States) before checkout. No purchase has been created.',
        },
        { status: 409 },
      );
    if (input.checkoutProtocol === 'managed_v1' && !managedPrePaymentEnforcementAvailable())
      return Response.json(
        {
          code: 'managed_coverage_unavailable',
          error:
            'Managed checkout is awaiting Canadian seller readiness. No purchase has been created.',
        },
        { status: 409 },
      );
    const checkoutIdentity = stripeCheckoutIdentity(
      input.attemptId,
      input.provider === 'stripe' ? input.checkoutProtocol : undefined,
      input.billingCountry,
      input.provider === 'stripe' ? 'intent_return_v1' : undefined,
    );
    const { data: intent, error } = await client.rpc('reserve_billing_purchase', {
      p_id: checkoutIdentity.intentId,
      p_organization_id: organizationId,
      p_tryout_id: input.tryoutId!,
      p_product_key: input.product,
      p_provider: input.provider,
    });
    if (error) {
      if (error.message === 'purchase_in_progress' && input.provider === 'stripe') {
        const url = await resumePendingStripeCheckout({
          stripe: stripeBillingClient(),
          intents: context.intents,
          organizationId,
          purchaserId: user.id,
          productKey: input.product,
          tryoutId: input.tryoutId,
          priceId: productConfig,
          environment: context.environment,
          mode: BILLING_PRODUCTS[input.product].kind === 'tryout' ? 'payment' : 'subscription',
          requireAutomaticTax: input.checkoutProtocol === 'standard_tax_v1',
          requireManagedPayments: input.checkoutProtocol === 'managed_v1',
          declaredBillingCountry: input.billingCountry,
        });
        if (url) return Response.json({ url });
        if (['standard_tax_v1', 'managed_v1'].includes(input.checkoutProtocol ?? ''))
          return Response.json(
            {
              code: 'checkout_tax_transition_pending',
              error:
                'An earlier checkout is still pending. Let it expire before starting a new tax-calculated purchase. No additional purchase was created.',
            },
            { status: 409 },
          );
      }
      if (['single_tryout_locked', 'single_tryout_schedule_invalid'].includes(error.message)) {
        return Response.json(
          {
            error:
              error.message === 'single_tryout_locked'
                ? 'This tryout is permanently read-only. Create a new event for a new purchase.'
                : 'Single Tryout sessions must fit within 14 days, with registration closing by the last session. Review the event schedule before purchasing.',
          },
          { status: 409 },
        );
      }
      if (error.message === 'intent_expired')
        return Response.json(
          {
            code: 'intent_expired',
            error: 'Your previous checkout expired. Choose the plan again to start a new purchase.',
          },
          { status: 409 },
        );
      const conflict = ['already_subscribed', 'purchase_in_progress'].includes(error.message);
      return Response.json(
        {
          error: conflict
            ? 'This organization already has a subscription or a purchase in progress. Manage it or wait for confirmation.'
            : 'We could not prepare this purchase. Please try again.',
        },
        { status: 409 },
      );
    }
    if (input.provider !== 'stripe')
      return Response.json({ intentId: input.attemptId, productId: productConfig });
    const stripe = stripeBillingClient();
    const product = BILLING_PRODUCTS[input.product];
    if (input.checkoutProtocol === 'managed_v1')
      assertManagedPrice(
        await stripe.prices.retrieve(productConfig, { expand: ['product'] }),
        context.environment === 'production',
      );
    const metadata = {
      billing_version: '2',
      ...(['standard_tax_v1', 'managed_v1'].includes(input.checkoutProtocol ?? '')
        ? {
            tax_protocol: input.checkoutProtocol!,
            ...(input.checkoutProtocol === 'managed_v1'
              ? {
                  managed_seller_country: process.env.STRIPE_MANAGED_SELLER_COUNTRY!,
                  managed_billing_country: input.billingCountry as 'CA' | 'US',
                }
              : {}),
          }
        : {}),
      billing_intent_id: checkoutIdentity.intentId,
      organization_id: organizationId,
      purchaser_id: user.id,
      product_key: input.product,
      ...(input.tryoutId ? { tryout_id: input.tryoutId } : {}),
    };
    const session = await stripe.checkout.sessions.create(
      {
        ...checkoutIdentity.parameters,
        mode: product.kind === 'tryout' ? 'payment' : 'subscription',
        line_items: [{ price: productConfig, quantity: 1 }],
        client_reference_id: checkoutIdentity.intentId,
        metadata,
        success_url: `${returnUrl}?checkout=complete&intent=${checkoutIdentity.intentId}`,
        cancel_url: `${returnUrl}?checkout=cancelled&intent=${checkoutIdentity.intentId}`,
        expires_at:
          Math.floor(
            Date.parse(z.object({ created_at: z.string() }).parse(intent).created_at) / 1000,
          ) + 3600,
        ...(product.kind === 'tryout'
          ? { customer_creation: 'always', payment_intent_data: { metadata } }
          : { subscription_data: { metadata } }),
      },
      { idempotencyKey: checkoutIdentity.idempotencyKey },
    );
    if (input.checkoutProtocol === 'managed_v1' && session.managed_payments?.enabled !== true)
      throw new Error('managed_checkout_not_verified');
    if (!session.url || new URL(session.url).hostname !== 'checkout.stripe.com')
      throw new Error('invalid_checkout_url');
    const saved = await createAdminSupabaseClient().rpc('complete_billing_checkout', {
      p_intent_id: checkoutIdentity.intentId,
      p_session_id: session.id,
    });
    if (saved.error) throw new Error('checkout_confirmation_unavailable');
    return Response.json({ url: session.url });
  } catch (error) {
    // Only the explicitly isolated acceptance runner sees public, bounded API
    // error metadata. Never return key, request body, provider message or stack.
    const localSandbox =
      process.env.BILLING_ENVIRONMENT === 'sandbox' &&
      /^http:\/\/(127\.0\.0\.1|localhost):3138$/.test(process.env.NEXT_PUBLIC_APP_URL ?? '') &&
      process.env.STRIPE_MANAGED_EXPECTED_TEST_ACCOUNT === 'acct_1UBERCKFGD4sbm5r';
    const providerError = error instanceof Stripe.errors.StripeError ? error : null;
    const parameter = providerError?.param?.split('[', 1)[0];
    const diagnostics =
      localSandbox && providerError
        ? {
            ...([400, 401, 403, 404, 429, 500, 502, 503].includes(providerError.statusCode ?? 0)
              ? { status: providerError.statusCode }
              : {}),
            ...([
              'StripeInvalidRequestError',
              'StripePermissionError',
              'StripeAuthenticationError',
              'StripeConnectionError',
              'StripeAPIError',
            ].includes(providerError.type)
              ? { type: providerError.type }
              : {}),
            ...([
              'managed_payments',
              'expires_at',
              'metadata',
              'line_items',
              'subscription_data',
              'customer',
              'success_url',
              'cancel_url',
            ].includes(parameter ?? '')
              ? { parameter }
              : {}),
            ...([
              'parameter_unknown',
              'resource_missing',
              'parameter_missing',
              'parameter_invalid_empty',
              'parameter_invalid_integer',
              'api_key_expired',
              'account_invalid',
              'permission_error',
            ].includes(providerError.code ?? '')
              ? { code: providerError.code }
              : {}),
            ...(/^req_[A-Za-z0-9]{6,100}$/.test(providerError.requestId ?? '')
              ? { requestId: providerError.requestId }
              : {}),
          }
        : undefined;
    return Response.json(
      {
        error: 'We could not complete that billing request. Please try again.',
        ...(diagnostics ? { diagnostics } : {}),
      },
      { status: 503 },
    );
  }
}
