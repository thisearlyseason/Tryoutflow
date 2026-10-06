import { BillingDashboardPanel } from '../../../../../src/modules/subscriptions/ui/billing-dashboard';
import { resolveEffectiveEntitlements } from '../../../../../src/modules/subscriptions/domain/effective-entitlements';
import { FEATURE_KEYS } from '../../../../../src/modules/subscriptions/domain/feature-catalog';
import { FeatureGate } from '../../../../../src/modules/subscriptions/ui/feature-gate';
const id = '11111111-1111-4111-8111-111111111111';
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const q = await searchParams;
  const paid = q.mode === 'paid',
    locked = q.mode === 'locked',
    failed = q.mode === 'failed';
  const now = new Date('2026-10-10T00:00:00Z');
  const access = resolveEffectiveEntitlements({
    organizationId: id,
    now,
    grants: paid
      ? [
          {
            organizationId: id,
            tryoutId: null,
            tier: 'pro',
            source: 'organization_subscription',
            features: FEATURE_KEYS.filter((x) => x !== 'advanced_scouting'),
            startsAt: '2026-10-01T00:00:00Z',
            expiresAt: '2026-11-01T00:00:00Z',
          },
        ]
      : [],
  });
  return (
    <main className="mx-auto max-w-6xl p-5">
      <h1>Local billing acceptance — synthetic only</h1>
      <FeatureGate access={access} feature="advanced_scouting" billingHref="/billing-acceptance">
        <p>SCOUTING ACCESS GRANTED</p>
      </FeatureGate>
      <BillingDashboardPanel
        analyticsEnabled={false}
        organizationId={id}
        tryouts={[{ id: '22222222-2222-4222-8222-222222222222', name: 'Synthetic event' }]}
        products={[
          {
            key: 'pro_monthly',
            name: 'Pro Monthly',
            price: 'USD 14.99',
            interval: 'month',
            features: ['Synthetic fixture'],
          },
          {
            key: 'organization_monthly',
            name: 'Organization Monthly',
            price: 'USD 44.99',
            interval: 'month',
            features: ['Synthetic fixture'],
          },
        ]}
        initial={{
          access,
          purchasesEnabled: !locked,
          subscriptions:
            paid || failed
              ? [
                  {
                    id,
                    tryout_id: null,
                    product_key: 'pro_monthly',
                    provider: 'stripe',
                    status: failed ? 'past_due' : 'active',
                    current_period_start: '2026-10-01T00:00:00Z',
                    current_period_end: '2026-11-01T00:00:00Z',
                    cancel_at_period_end: false,
                    pending_product_key: null,
                    downgrade_effective_at: null,
                  },
                ]
              : [],
          overrides: [],
          history: [],
          usage: { active_tryouts: 1 },
        }}
      />
    </main>
  );
}
