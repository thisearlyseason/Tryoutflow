import { BillingDashboardPanel } from '../../../../../src/modules/subscriptions/ui/billing-dashboard';
import { resolveEffectiveEntitlements } from '../../../../../src/modules/subscriptions/domain/effective-entitlements';
import { FEATURE_KEYS } from '../../../../../src/modules/subscriptions/domain/feature-catalog';
const id = '11111111-1111-4111-8111-111111111111';
export default function BillingFixture() {
  const access = resolveEffectiveEntitlements({
    organizationId: id,
    now: new Date('2026-10-15T00:00:00Z'),
    grants: [
      {
        organizationId: id,
        tryoutId: null,
        tier: 'organization',
        source: 'organization_subscription',
        features: FEATURE_KEYS,
        startsAt: '2026-10-01T00:00:00Z',
        expiresAt: '2026-11-01T00:00:00Z',
      },
    ],
  });
  return (
    <main className="mx-auto max-w-6xl px-4 py-8 md:px-8">
      <p className="eyebrow">BILLING PREVIEW · FICTIONAL DATA</p>
      <h1 className="mb-7 mt-3 text-4xl font-black">Billing & plans</h1>
      <BillingDashboardPanel
        analyticsEnabled={false}
        organizationId={id}
        tryouts={[]}
        products={[]}
        initial={{
          access,
          subscriptions: [
            {
              id,
              tryout_id: null,
              product_key: 'organization_monthly',
              provider: 'apple',
              status: 'active',
              current_period_start: '2026-10-01T00:00:00Z',
              current_period_end: '2026-11-01T00:00:00Z',
              cancel_at_period_end: false,
              pending_product_key: 'pro_monthly',
              downgrade_effective_at: '2026-11-01T00:00:00Z',
            },
          ],
          usage: { active_tryouts: 4 },
          overrides: [],
          history: [
            { event_type: 'downgrade_scheduled', created_at: '2026-10-15T00:00:00Z', metadata: {} },
            {
              event_type: 'subscription_renewed',
              created_at: '2026-10-01T00:00:00Z',
              metadata: {},
            },
          ],
        }}
      />
    </main>
  );
}
