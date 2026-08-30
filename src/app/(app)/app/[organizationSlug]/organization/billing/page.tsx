import { notFound } from 'next/navigation';

import { requireCurrentOrganization } from '@/modules/organizations/application/current-organization';
import { launchPlans, type PaidPlanKey } from '@/modules/subscriptions/domain/plans';
import { loadOwnedSubscriptionAccount } from '@/modules/subscriptions/infrastructure/owned-subscription-account';
import { PlanCard } from '@/modules/subscriptions/ui/plan-card';
import { SubscriptionStatus } from '@/modules/subscriptions/ui/subscription-status';

export default async function BillingPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationSlug: string }>;
  searchParams: Promise<{ checkout?: string | string[] }>;
}) {
  const { organizationSlug } = await params;
  const current = await requireCurrentOrganization(organizationSlug);
  if (current.authorization.organizationRole !== 'owner') notFound();
  const account = await loadOwnedSubscriptionAccount(current.client, current.organization.id);
  if (!account) notFound();
  const checkout = (await searchParams).checkout;
  const returnState = Array.isArray(checkout) ? null : checkout;
  const hasLiveProviderSubscription =
    account.providerSubscriptionId !== null &&
    ['trialing', 'active', 'past_due'].includes(account.state);
  const paidPlans = (['team', 'club', 'association'] as PaidPlanKey[]).map(
    (key) => launchPlans[key],
  );

  return (
    <section aria-labelledby="billing-heading" className="min-w-0">
      <p className="eyebrow">Owner-only</p>
      <h2 className="text-3xl font-black" id="billing-heading">
        Billing
      </h2>
      <p className="mt-2 max-w-3xl text-[var(--color-text-muted)]">
        Subscription access changes only after TryoutFlow processes a verified provider webhook.
        Returning from checkout does not activate a plan by itself.
      </p>
      {returnState === 'complete' ? (
        <p
          className="mt-4 rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
          role="status"
        >
          Checkout returned successfully. Provider confirmation may take a moment; this page still
          shows the last verified subscription state.
        </p>
      ) : null}
      {returnState === 'cancelled' ? (
        <p className="mt-4" role="status">
          Checkout was canceled. Your verified subscription state was not changed.
        </p>
      ) : null}
      <div className="mt-6">
        <SubscriptionStatus
          account={{
            plan: account.plan,
            state: account.state,
            currentPeriodEnd: account.currentPeriodEnd,
            cancelAtPeriodEnd: account.cancelAtPeriodEnd,
            cancelAt: account.cancelAt,
            canceledAt: account.canceledAt,
            trialEnd: account.trialEnd,
            hasVerifiedCustomer: account.providerCustomerId !== null,
          }}
          organizationId={current.organization.id}
        />
      </div>
      <h2 className="mt-8 text-2xl font-black">Launch plans</h2>
      {hasLiveProviderSubscription ? (
        <p className="mt-2 text-sm text-[var(--color-text-muted)]">
          Manage the existing subscription in the billing portal before starting another checkout.
        </p>
      ) : null}
      <div className="mt-4 grid min-w-0 gap-4 md:grid-cols-3">
        {paidPlans.map((plan) => (
          <PlanCard
            disabled={hasLiveProviderSubscription}
            key={plan.key}
            organizationId={current.organization.id}
            plan={plan}
          />
        ))}
      </div>
    </section>
  );
}
