'use client';
import { ManagedBillingCountryField } from './managed-billing-country-field';
import { useEffect, useRef, useState } from 'react';
import { useCheckoutReturn } from './use-checkout-return';
import { trackBilling } from './billing-analytics';
import { useRouter } from 'next/navigation';
import { CreditCard, ShieldCheck, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { BILLING_PRODUCTS, PROVIDER_LABELS, isBillingProduct } from '../domain/billing-products';
import type { PlanChangeQuote } from '../providers/stripe-plan-change';
import {
  billingDashboardSchema,
  type BillingDashboard,
  type AvailableBillingProduct,
} from '../domain/billing-dashboard';
const formatDate = (value: string) =>
  new Intl.DateTimeFormat('en-CA', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(value));
export function BillingDashboardPanel({
  initial,
  organizationId,
  products,
  tryouts,
  readOnly = false,
  analyticsEnabled = true,
  checkoutReturn = false,
}: {
  checkoutReturn?: boolean;
  readOnly?: boolean;
  analyticsEnabled?: boolean;
  initial: BillingDashboard;
  organizationId: string;
  products: AvailableBillingProduct[];
  tryouts: { id: string; name: string }[];
}) {
  const {
    dashboard,
    setDashboard,
    status: returnStatus,
    retry: retryReturn,
  } = useCheckoutReturn(initial, organizationId, checkoutReturn);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [tryout, setTryout] = useState('');
  const lock = useRef(false);
  const [billingCountry, setBillingCountry] = useState('');
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(`managed-billing-country-${organizationId}`);
      setBillingCountry(saved === 'CA' || saved === 'US' ? saved : '');
    } catch {
      setBillingCountry('');
    }
  }, [organizationId]);
  const [changeQuote, setChangeQuote] = useState<(PlanChangeQuote & { attemptId: string }) | null>(
    null,
  );
  const router = useRouter();
  useEffect(() => {
    if (analyticsEnabled && !readOnly) trackBilling(organizationId, 'pricing_viewed');
  }, [organizationId, analyticsEnabled, readOnly]);
  const current = dashboard.subscriptions
    .filter((s) => s.tryout_id === null)
    .sort((a, b) => Date.parse(b.current_period_start) - Date.parse(a.current_period_start))[0];
  const hasSubscription =
    !!current &&
    current.status !== 'expired' &&
    (!current.current_period_end ||
      Date.parse(current.current_period_end) > Date.parse(dashboard.access.evaluatedAt));
  const canChangePlan =
    hasSubscription &&
    current?.provider === 'stripe' &&
    current.status === 'active' &&
    !current.cancel_at_period_end &&
    !current.pending_product_key;
  const effectiveName =
    dashboard.access.plan === 'organization'
      ? 'Organization'
      : dashboard.access.plan === 'pro'
        ? 'Pro'
        : 'No paid plan';
  const [clock, setClock] = useState(() => Date.parse(initial.access.evaluatedAt));
  const expiry = dashboard.trial?.expiresAt ? Date.parse(dashboard.trial.expiresAt) : null;
  useEffect(() => {
    if (!expiry) return;
    const update = () => setClock(Date.now());
    update();
    const timer = setInterval(update, 60_000);
    return () => clearInterval(timer);
  }, [expiry]);
  const remaining = expiry === null ? 0 : Math.max(0, Math.ceil((expiry - clock) / 60_000));
  const trialActive = expiry !== null && remaining > 0;
  async function action(input: Record<string, unknown>, planChange = false) {
    if (lock.current || readOnly || (checkoutReturn && returnStatus !== 'confirmed')) return;
    lock.current = true;
    setBusy(true);
    setMessage('');
    try {
      if (
        input.action === 'purchase' &&
        input.provider === 'stripe' &&
        billingCountry !== 'CA' &&
        billingCountry !== 'US'
      )
        throw new Error('Select Canada or United States as your billing country before checkout.');
      const key = `billing-${input.provider === 'stripe' ? 'managed-v1' : 'standard-v1'}-${organizationId}-${String(input.product ?? 'action')}-${tryout}${input.provider === 'stripe' ? `-${billingCountry}` : ''}`;
      if (input.action === 'purchase') {
        trackBilling(organizationId, 'checkout_started');
        if (input.provider === 'stripe') {
          input.checkoutProtocol = 'managed_v1';
          input.billingCountry = billingCountry;
        }
        input.attemptId = sessionStorage.getItem(key) ?? crypto.randomUUID();
        sessionStorage.setItem(key, String(input.attemptId));
      }
      const response = await fetch(
        `/api/organizations/${organizationId}/billing/${planChange ? 'plan-change' : 'actions'}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        },
      );
      const result = await response.json();
      if (!response.ok) {
        if (result.code === 'intent_expired') sessionStorage.removeItem(key);
        throw new Error(result.error ?? 'Please try again.');
      }
      if (result.url) {
        const url = new URL(result.url);
        if (
          url.protocol !== 'https:' ||
          ![
            'checkout.stripe.com',
            'billing.stripe.com',
            'apps.apple.com',
            'play.google.com',
          ].includes(url.hostname)
        )
          throw new Error('Unable to open subscription management.');
        window.location.assign(url.toString());
        return;
      }
      if (result.dashboard) setDashboard(billingDashboardSchema.parse(result.dashboard));
      if (result.quote) {
        setChangeQuote({ ...result.quote, attemptId: crypto.randomUUID() });
        return;
      }
      if (planChange) setChangeQuote(null);
      setMessage(result.message ?? 'Subscription updated.');
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Please try again.');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="workspace-stack">
      {checkoutReturn ? (
        <section
          className="workspace-card"
          aria-label="Checkout status"
          aria-busy={returnStatus === 'checking'}
        >
          <p role="status" aria-live="polite">
            {returnStatus === 'confirmed'
              ? 'Your paid plan is confirmed.'
              : returnStatus === 'checking'
                ? 'Checking your plan… Payment confirmation can take a moment.'
                : returnStatus === 'denied'
                  ? 'Unable to check billing access. Sign in as this organization’s owner and try again.'
                  : 'Payment confirmation is still pending. Check again before starting another purchase.'}
          </p>
          {returnStatus === 'pending' ? (
            <Button variant="secondary" onClick={retryReturn}>
              Check payment status again
            </Button>
          ) : null}
        </section>
      ) : null}
      {changeQuote ? (
        <section className="workspace-card" aria-label="Review plan change">
          <h2 className="text-xl font-black">Review plan change</h2>
          <p className="mt-3">
            {changeQuote.name}: {changeQuote.price} per {changeQuote.interval}, starting{' '}
            {formatDate(changeQuote.effectiveAt)} (UTC). Applicable taxes are calculated on the
            invoice.
          </p>
          <p className="mt-3">
            Your current plan continues until that renewal date. No charge or credit is made today.
            The new plan renews automatically until cancelled. Existing records stay saved.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Button
              busy={busy}
              disabled={readOnly || (checkoutReturn && returnStatus !== 'confirmed')}
              onClick={() =>
                action(
                  {
                    action: 'confirm',
                    product: changeQuote.product,
                    token: changeQuote.token,
                    attemptId: changeQuote.attemptId,
                  },
                  true,
                )
              }
            >
              Confirm change at renewal
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => setChangeQuote(null)}>
              Keep current plan
            </Button>
          </div>
        </section>
      ) : null}
      {dashboard.trial?.eligible ? (
        <div className="workspace-card">
          <p className="eyebrow">TRYOUTFLOW PRO</p>
          <h2 className="text-2xl font-black">Your first 7 days are free</h2>
          <p className="my-4">
            Start your 7-day trial when you’re ready. No credit card, no automatic charge. Your work
            stays saved when the trial ends.
          </p>
          <Button
            busy={busy}
            disabled={readOnly || (checkoutReturn && returnStatus !== 'confirmed')}
            onClick={() => action({ action: 'start_trial' })}
          >
            Start my 7-day Pro trial
          </Button>
        </div>
      ) : expiry !== null && !hasSubscription ? (
        <div className="workspace-card" role="status">
          <h2 className="text-xl font-black">
            {trialActive ? 'Your Pro trial is active' : 'Your Pro trial has ended'}
          </h2>
          <p className="mt-2">
            {trialActive
              ? `${Math.floor(remaining / 1440)}d ${Math.floor((remaining % 1440) / 60)}h ${remaining % 60}m remaining`
              : dashboard.purchasesEnabled === false
                ? 'Your records are preserved. Paid plans are not available for purchase yet.'
                : 'Choose a paid plan to continue using Pro features. Your records are preserved.'}
          </p>
          <p className="mt-2 text-sm">
            No automatic charge. Trial ends{' '}
            {new Intl.DateTimeFormat('en-CA', {
              dateStyle: 'medium',
              timeStyle: 'short',
              timeZone: 'UTC',
            }).format(new Date(expiry))}{' '}
            UTC.
          </p>
        </div>
      ) : null}
      <div className="workspace-card">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div>
            <p className="eyebrow">YOUR PLAN</p>
            <h2 className="text-3xl font-black">
              TryOutFlow{' '}
              {checkoutReturn && returnStatus === 'checking'
                ? 'Checking your plan…'
                : dashboard.access.source === 'trial' && !trialActive
                  ? 'No paid plan'
                  : effectiveName}
            </h2>
            <p className="mt-2 text-[var(--color-text-muted)]">
              {current
                ? PROVIDER_LABELS[current.provider]
                : dashboard.access.source === 'trial'
                  ? '7-day Pro trial'
                  : dashboard.access.source === 'manual'
                    ? 'Promotional access'
                    : dashboard.access.source === 'legacy'
                      ? 'Your existing plan remains available.'
                      : 'Ready for your next tryout.'}
            </p>
          </div>
          <ShieldCheck aria-hidden className="text-[var(--color-primary)]" size={32} />
        </div>
        {current ? (
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            <div>
              <p className="text-sm text-[var(--color-text-muted)]">Status</p>
              <p className="font-bold capitalize">{current.status.replaceAll('_', ' ')}</p>
            </div>
            <div>
              <p className="text-sm text-[var(--color-text-muted)]">Billing</p>
              <p className="font-bold">
                {isBillingProduct(current.product_key)
                  ? BILLING_PRODUCTS[current.product_key].interval === 'year'
                    ? 'Annual'
                    : 'Monthly'
                  : 'Current plan'}
              </p>
            </div>
            <div>
              <p className="text-sm text-[var(--color-text-muted)]">
                {current.cancel_at_period_end ? 'Access until' : 'Current period ends'}
              </p>
              <p className="font-bold">
                {current.current_period_end
                  ? formatDate(current.current_period_end)
                  : 'No expiration'}
              </p>
            </div>
          </div>
        ) : null}
        {current?.cancel_at_period_end && current.current_period_end ? (
          <p role="status" className="mt-5 rounded-lg bg-[var(--color-surface-muted)] p-4">
            Your subscription is cancelled and will remain active until{' '}
            {formatDate(current.current_period_end)}. You can resume it through Manage subscription
            when your provider supports it.
          </p>
        ) : null}
        {current?.pending_product_key && current.downgrade_effective_at ? (
          <div className="mt-4">
            <p role="status">
              Your plan will change to{' '}
              {isBillingProduct(current.pending_product_key)
                ? BILLING_PRODUCTS[current.pending_product_key].name
                : 'your selected plan'}{' '}
              on {formatDate(current.downgrade_effective_at)}.
            </p>
            {current.provider === 'stripe' ? (
              <Button
                variant="secondary"
                busy={busy}
                disabled={readOnly || (checkoutReturn && returnStatus !== 'confirmed')}
                onClick={() =>
                  action(
                    {
                      action: 'cancel',
                      product: current.pending_product_key,
                      effectiveAt: current.downgrade_effective_at,
                    },
                    true,
                  )
                }
              >
                Cancel pending plan change
              </Button>
            ) : null}
          </div>
        ) : null}
        {current && ['past_due', 'grace_period'].includes(current.status) ? (
          <p role="alert" className="mt-4 rounded-lg bg-amber-50 p-4 text-amber-950">
            There’s a problem with your subscription payment. Update your billing information to
            avoid losing access.
          </p>
        ) : null}
        <div className="mt-6 flex flex-wrap gap-3">
          {current ? (
            <Button
              busy={busy}
              disabled={readOnly || (checkoutReturn && returnStatus !== 'confirmed')}
              onClick={() => action({ action: 'manage' })}
            >
              <CreditCard size={18} aria-hidden /> Manage subscription
            </Button>
          ) : null}
          <Button
            variant="secondary"
            busy={busy}
            disabled={readOnly || (checkoutReturn && returnStatus !== 'confirmed')}
            onClick={() => action({ action: 'reconcile' })}
          >
            Refresh subscription
          </Button>
        </div>
        <p className="mt-5 text-sm text-[var(--color-text-muted)]">
          Your athletes, evaluations, reports, and historical records stay safe when your plan
          changes. Manage web invoices and payment details in the billing portal.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="workspace-card">
          <p className="eyebrow">USAGE</p>
          <p className="text-3xl font-black">{dashboard.usage.active_tryouts}</p>
          <p>Active tryouts · {dashboard.access.limits.active_tryouts ?? 'No'} limit</p>
        </div>
        <div className="workspace-card">
          <p className="eyebrow">ALL YOUR DEVICES</p>
          <p className="font-bold">One organization. Shared access.</p>
          <p className="mt-2 text-sm text-[var(--color-text-muted)]">
            Purchases made on the web, iPhone, or Android follow this organization. Restore mobile
            purchases in the TryOutFlow app.
          </p>
        </div>
      </div>
      {dashboard.subscriptions
        .filter((subscription) => subscription.tryout_id)
        .map((license) => (
          <div className="workspace-card" key={license.id}>
            <p className="eyebrow">TRYOUT LICENSE</p>
            <h3 className="text-xl font-black">
              {tryouts.find((t) => t.id === license.tryout_id)?.name ?? 'Licensed tryout'}
            </h3>
            <p className="mt-2 capitalize">
              TryOutFlow Pro · {license.status.replaceAll('_', ' ')}
            </p>
            <p className="mt-2 text-sm text-[var(--color-text-muted)]">
              One-time purchase through {PROVIDER_LABELS[license.provider]}. Access applies to this
              tryout.
            </p>
          </div>
        ))}
      {dashboard.purchasesEnabled === false ? (
        <div className="workspace-card" role="status">
          <h2 className="text-xl font-black">Paid plans are coming soon</h2>
          <p className="mt-2">
            Paid checkout is not available yet. Eligible new organizations can start the no-card
            7-day Pro trial above. No automatic charge follows the trial.
          </p>
        </div>
      ) : null}
      {dashboard.purchasesEnabled !== false && products.length ? (
        <>
          <h2 className="text-2xl font-black">Choose your plan</h2>
          {!hasSubscription && !readOnly ? (
            <ManagedBillingCountryField
              value={billingCountry}
              disabled={busy}
              onChange={(value) => {
                setBillingCountry(value);
                try {
                  sessionStorage.setItem(`managed-billing-country-${organizationId}`, value);
                } catch {
                  /* validation remains required in this tab */
                }
              }}
            />
          ) : null}
          <div className="grid gap-4 lg:grid-cols-2">
            {products.map((product) => (
              <div className="workspace-card" key={product.key}>
                <Sparkles aria-hidden size={20} />
                <h3 className="mt-3 text-xl font-black">{product.name}</h3>
                <p className="mt-2 text-3xl font-black">
                  {product.price}
                  <span className="text-sm font-normal">
                    {product.interval ? ` / ${product.interval}` : ' once'}
                  </span>
                </p>
                <ul className="my-5 space-y-2 text-sm">
                  {product.features.map((feature) => (
                    <li key={feature}>✓ {feature}</li>
                  ))}
                </ul>
                {product.key === 'single_tryout_pro' ? (
                  <label className="mb-4 block">
                    Tryout
                    <p className="my-2 text-sm">
                      One event, with sessions within 14 days. Event details and dates freeze at
                      publication. Editing ends on completion or 7 days after the last session;
                      results stay readable.
                    </p>
                    <select
                      className="mt-2 block w-full rounded border p-3"
                      value={tryout}
                      onChange={(e) => setTryout(e.target.value)}
                    >
                      <option value="">Select a tryout</option>
                      {tryouts.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                <Button
                  busy={busy}
                  disabled={
                    readOnly ||
                    (checkoutReturn && returnStatus !== 'confirmed') ||
                    (hasSubscription && current?.product_key === product.key) ||
                    (product.key === 'single_tryout_pro' && !tryout)
                  }
                  onClick={() =>
                    canChangePlan && product.key !== 'single_tryout_pro'
                      ? action({ action: 'preview', product: product.key }, true)
                      : action(
                          hasSubscription
                            ? { action: 'manage' }
                            : {
                                action: 'purchase',
                                product: product.key,
                                provider: 'stripe',
                                tryoutId: product.key === 'single_tryout_pro' ? tryout : null,
                              },
                        )
                  }
                >
                  {hasSubscription && current?.product_key === product.key
                    ? 'Current plan'
                    : canChangePlan && product.key !== 'single_tryout_pro'
                      ? 'Review plan change'
                      : hasSubscription
                        ? 'Manage current subscription'
                        : 'Choose plan'}
                </Button>
                <p className="mt-3 text-xs text-[var(--color-text-muted)]">
                  {hasSubscription
                    ? current?.provider === 'stripe'
                      ? canChangePlan && product.key !== 'single_tryout_pro'
                        ? 'Review the price and renewal date before confirming. Your current access continues until the change takes effect.'
                        : 'Manage invoices, payment methods, and cancellation in the billing portal. Resume a cancelled subscription or cancel its pending plan change before choosing another plan.'
                      : `Manage this subscription through ${PROVIDER_LABELS[current!.provider]}.`
                    : product.key === 'single_tryout_pro'
                      ? 'One payment unlocks Pro for the selected tryout after payment is confirmed.'
                      : 'Your subscription begins after payment is confirmed. Manage renewal and cancellation in the billing portal.'}
                </p>
              </div>
            ))}
          </div>
        </>
      ) : null}
      {dashboard.overrides
        .filter((o) => !o.revoked_at)
        .map((o) => (
          <div className="workspace-card" key={o.id}>
            <h3 className="font-bold">Promotional access</h3>
            <p>{o.reason}</p>
            <p className="text-sm">
              {formatDate(o.starts_at)} – {formatDate(o.expires_at)}
            </p>
          </div>
        ))}
      <div className="workspace-card">
        <h2 className="text-xl font-black">Billing activity</h2>
        {dashboard.history.length ? (
          <ul className="mt-4 divide-y divide-[var(--color-border)]">
            {dashboard.history.map((event, index) => (
              <li
                key={`${event.created_at}-${index}`}
                className="flex flex-wrap justify-between gap-2 py-3 text-sm"
              >
                <span className="capitalize">
                  {event.event_type.toLowerCase().replaceAll('_', ' ').replaceAll('.', ' ')}
                </span>
                <time dateTime={event.created_at}>{formatDate(event.created_at)}</time>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-[var(--color-text-muted)]">
            New billing activity will appear here. Existing invoices remain in your billing portal.
          </p>
        )}
      </div>
      {message ? (
        <p role="status" className="workspace-card">
          {message}
        </p>
      ) : null}
    </div>
  );
}
