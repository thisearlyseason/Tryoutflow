import { PlanGrid } from '../../../../src/modules/subscriptions/ui/plan-grid';
import { SubscriptionStatus } from '../../../../src/modules/subscriptions/ui/subscription-status';

const organizationId = '11111111-1111-4111-8111-111111111111';
const plans = [
  { key: 'team' as const, name: 'Team', monthlyPriceCad: 49 },
  { key: 'club' as const, name: 'Club', monthlyPriceCad: 129 },
  { key: 'association' as const, name: 'Association', monthlyPriceCad: 249 },
];

export default function Page() {
  return (
    <section aria-labelledby="billing-heading" className="min-w-0">
      <h1 className="text-3xl font-black" id="billing-heading">
        Billing
      </h1>
      <p className="mt-2 text-[var(--color-text-muted)]">
        Access changes only after TryoutFlow processes a verified provider webhook.
      </p>
      <div className="mt-5">
        <SubscriptionStatus
          account={{
            plan: 'club',
            state: 'active',
            currentPeriodEnd: '2026-10-01T00:00:00.000Z',
            cancelAtPeriodEnd: false,
            cancelAt: null,
            canceledAt: null,
            trialEnd: null,
            hasVerifiedCustomer: true,
          }}
          organizationId={organizationId}
        />
      </div>
      <h2 className="mt-7 text-2xl font-black">Launch plans</h2>
      <PlanGrid disabled={false} organizationId={organizationId} plans={plans} />
    </section>
  );
}
