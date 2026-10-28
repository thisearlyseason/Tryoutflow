import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { loadVerifiedNativePurchases } from '@/modules/subscriptions/providers/revenuecat-reconciliation';
const user = '11111111-1111-4111-8111-111111111111';
beforeEach(() => {
  vi.stubEnv('BILLING_ENVIRONMENT', 'sandbox');
  vi.stubEnv('REVENUECAT_PROJECT_ID', 'projTest');
  vi.stubEnv('REVENUECAT_SECRET_KEY', 'v2_fixture');
  vi.stubEnv('REVENUECAT_V1_API_KEY', 'v1_fixture');
  vi.stubEnv('REVENUECAT_GOOGLE_PRO_MONTHLY', 'agency.tryout.pro:monthly');
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-15T00:00:00Z'));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});
function receipt(plan: string | null = 'monthly', overrides: Record<string, unknown> = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const start = Date.parse('2026-10-01T00:00:00Z'),
        end = Date.parse('2026-11-01T00:00:00Z');
      if (input.includes('/v1/'))
        return Response.json({
          subscriber: {
            original_app_user_id: user,
            subscriptions: {
              'agency.tryout.pro': {
                store: 'play_store',
                is_sandbox: true,
                product_plan_identifier: plan,
                original_purchase_date: new Date(start).toISOString(),
                purchase_date: new Date(start).toISOString(),
                expires_date: new Date(end).toISOString(),
                ...overrides,
              },
            },
          },
        });
      if (input.includes('/products/'))
        return Response.json({ store_identifier: 'agency.tryout.pro:monthly' });
      if (input.includes('/purchases?')) return Response.json({ items: [], next_page: null });
      return Response.json({
        items: [
          {
            id: 'subGoogleStable',
            customer_id: user,
            original_customer_id: user,
            product_id: 'prodGoogle',
            environment: 'sandbox',
            store: 'play_store',
            ownership: 'purchased',
            starts_at: start,
            current_period_starts_at: start,
            current_period_ends_at: end,
            ends_at: end,
            status: 'active',
            gives_access: true,
            auto_renewal_status: 'will_renew',
          },
        ],
        next_page: null,
      });
    }),
  );
}
it('recovers Google access from V1 subscription ID plus the exact V2 base plan', async () => {
  receipt();
  expect(await loadVerifiedNativePurchases(user)).toEqual([
    expect.objectContaining({
      provider: 'google',
      product_key: 'pro_monthly',
      provider_contract_id: 'subGoogleStable',
      purchaser_id: user,
      status: 'active',
    }),
  ]);
});
it.each(['annual', null])('rejects a mismatched or missing Google base plan: %s', async (plan) => {
  receipt(plan);
  await expect(loadVerifiedNativePurchases(user)).rejects.toThrow('purchase_product_conflict');
});
it.each([{ store: 'app_store' }, { is_sandbox: false }, { ownership_type: 'FAMILY_SHARED' }])(
  'retains environment, store and ownership checks: %j',
  async (overrides) => {
    receipt('monthly', overrides);
    await expect(loadVerifiedNativePurchases(user)).rejects.toThrow(
      'purchase_environment_or_ownership_conflict',
    );
  },
);
