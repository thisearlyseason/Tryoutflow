import { NativeBillingEntry } from '@/modules/subscriptions/ui/native-billing-entry';
import { cookies } from 'next/headers';
import { NATIVE_CONTEXT_COOKIE } from '@/modules/identity/native-context';
import Link from 'next/link';
import { loadWorkspaceNavigation } from '@/modules/organizations/application/team-workspaces';
import { getEffectiveEntitlements } from '@/modules/subscriptions/application/billing-service';
import { BillingDashboardPanel } from '@/modules/subscriptions/ui/billing-dashboard';
import { billingDashboardSchema } from '@/modules/subscriptions/domain/billing-dashboard';
import { availableWebProducts } from '@/modules/subscriptions/providers/catalog';
import { notFound } from 'next/navigation';

import { requireCurrentOrganization } from '@/modules/organizations/application/current-organization';
import { launchPlans, type PaidPlanKey } from '@/modules/subscriptions/domain/plans';
import { loadOwnedSubscriptionAccount } from '@/modules/subscriptions/infrastructure/owned-subscription-account';
import { PlanGrid } from '@/modules/subscriptions/ui/plan-grid';
import { SubscriptionStatus } from '@/modules/subscriptions/ui/subscription-status';
import { PageHeader } from '@/components/layout/page-header';

export default async function BillingPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationSlug: string }>;
  searchParams: Promise<{ checkout?: string | string[]; intent?: string | string[] }>;
}) {
  const { organizationSlug } = await params;
  const current = await requireCurrentOrganization(organizationSlug);
  const native = (await cookies()).get(NATIVE_CONTEXT_COOKIE)?.value;
  if (native === 'apple' || native === 'google')
    return (
      <section className="workspace-stack">
        <PageHeader
          title="Billing & access"
          description="Use the app's Billing & access control to review your current plan, purchase or restore through your device's store."
        />
        <div className="workspace-card">
          <p>
            Your existing workspace, athletes, evaluations and reports remain here. Purchase access
            is confirmed securely for the same account and organization.
          </p>
        </div>
        <NativeBillingEntry slug={current.organization.slug} />
      </section>
    );
  const workspaces = await loadWorkspaceNavigation(current.client, current.organization.id);
  if (workspaces.parent)
    return (
      <section className="workspace-stack">
        <PageHeader
          title="Covered by your organization"
          description={`Billing for this team is managed by ${workspaces.parent.name}.`}
        />
        <div className="workspace-card">
          <p>
            Your team inherits its organization's plan. There is no separate team subscription or
            trial.
          </p>
          {workspaces.parent.canManage ? (
            <Link
              className="mt-4 inline-block font-bold underline"
              href={`/app/${workspaces.parent.slug}/organization/billing`}
            >
              Open organization billing
            </Link>
          ) : (
            <p className="mt-3">Contact your organization owner for billing changes.</p>
          )}
        </div>
      </section>
    );
  if (current.authorization.organizationRole !== 'owner') {
    if (!process.env.BILLING_ENVIRONMENT) notFound();
    const access = await getEffectiveEntitlements(current.organization.id);
    return (
      <section className="workspace-stack">
        <PageHeader
          title="Your organization plan"
          description="Your access is shared across your organization."
        />
        <div className="workspace-card">
          <h2 className="text-2xl font-bold capitalize">TryOutFlow {access.plan}</h2>
          <p className="mt-4">
            Contact your organization owner to upgrade or manage billing. Existing athletes,
            evaluations, and historical records are preserved when the plan changes.
          </p>
        </div>
      </section>
    );
  }
  const account = await loadOwnedSubscriptionAccount(current.client, current.organization.id);
  if (!account) notFound();
  if (process.env.BILLING_ENVIRONMENT) {
    const [{ data, error }, tryouts] = await Promise.all([
      current.client.rpc('get_billing_dashboard', { p_organization_id: current.organization.id }),
      current.client
        .from('tryouts')
        .select('id,name')
        .eq('organization_id', current.organization.id)
        .order('created_at', { ascending: false }),
    ]);
    if (error) throw new Error('Billing is temporarily unavailable.');
    const dashboard = billingDashboardSchema.parse(data);
    const checkoutQuery = await searchParams;
    let catalogUnavailable = false;
    const products =
      dashboard.purchasesEnabled === false
        ? []
        : await availableWebProducts().catch(() => {
            catalogUnavailable = true;
            return [];
          });
    return (
      <section className="workspace-stack">
        <PageHeader
          title="Billing & plans"
          eyebrow="Your organization"
          description="Manage your plan, review activity, and keep your team connected."
        />
        {catalogUnavailable ? (
          <div className="workspace-card" role="alert">
            <h2 className="text-xl font-bold">Paid plans could not be loaded</h2>
            <p className="mt-2">Refresh this page to try again. No payment has been started.</p>
          </div>
        ) : null}
        <BillingDashboardPanel
          key={current.organization.id}
          checkoutReturn={checkoutQuery.checkout === 'complete'}
          checkoutCancelled={checkoutQuery.checkout === 'cancelled'}
          checkoutIntentId={typeof checkoutQuery.intent === 'string' ? checkoutQuery.intent : null}
          initial={dashboard}
          organizationId={current.organization.id}
          products={products}
          tryouts={tryouts.data ?? []}
        />
        {dashboard.access.source === 'legacy' ? (
          <div className="workspace-card">
            <h2 className="mb-4 text-xl font-bold">Existing subscription</h2>
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
        ) : null}
      </section>
    );
  }
  const checkout = (await searchParams).checkout;
  const returnState = Array.isArray(checkout) ? null : checkout;
  const hasLiveProviderSubscription =
    account.providerSubscriptionId !== null &&
    ['trialing', 'active', 'past_due'].includes(account.state);
  const paidPlans = (['team', 'club', 'association'] as PaidPlanKey[]).map(
    (key) => launchPlans[key],
  );

  return (
    <section aria-labelledby="billing-heading" className="workspace-stack">
      <PageHeader
        description="Subscription access changes only after TryoutFlow processes a verified provider webhook."
        eyebrow="Owner-only"
        title="Billing"
      />
      <h2 className="sr-only" id="billing-heading">
        Billing
      </h2>
      <div className="workspace-card">
        <p className="max-w-3xl text-[var(--color-text-muted)]">
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
      </div>
      <h2 className="mt-8 text-2xl font-black">Launch plans</h2>
      {hasLiveProviderSubscription ? (
        <p className="mt-2 text-sm text-[var(--color-text-muted)]">
          Manage the existing subscription in the billing portal before starting another checkout.
        </p>
      ) : null}
      <PlanGrid
        disabled={hasLiveProviderSubscription}
        organizationId={current.organization.id}
        plans={paidPlans}
      />
    </section>
  );
}
