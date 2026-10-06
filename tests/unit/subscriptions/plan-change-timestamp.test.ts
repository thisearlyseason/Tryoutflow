import { expect, it, vi } from 'vitest';
import type Stripe from 'stripe';
import { cancelStripePlanChange } from '@/modules/subscriptions/providers/stripe-plan-change';
vi.mock('@/modules/subscriptions/providers/configuration', () => ({
  billingConfiguration: () => ({ environment: 'sandbox' }),
  productForProvider: () => 'pro_monthly',
}));
const account = {
  provider_contract_id: 'sub_test',
  provider_customer_id: 'cus_test',
  organization_id: 'org_test',
  purchaser_id: 'user_test',
};
const end = Date.parse('2099-01-01T00:00:00Z') / 1000;
function fixture() {
  const release = vi.fn().mockResolvedValue({});
  const stripe = {
    subscriptions: {
      retrieve: vi.fn().mockResolvedValue({
        customer: 'cus_test',
        metadata: { organization_id: 'org_test', purchaser_id: 'user_test', billing_version: '2' },
        livemode: false,
        status: 'active',
        collection_method: 'charge_automatically',
        discounts: [],
        automatic_tax: { enabled: false },
        schedule: 'sched_test',
        items: {
          data: [
            { quantity: 1, discounts: [], current_period_end: end, price: { id: 'price_test' } },
          ],
        },
      }),
    },
    subscriptionSchedules: {
      release,
      retrieve: vi.fn().mockResolvedValue({
        status: 'active',
        metadata: {
          organization_id: 'org_test',
          tryoutflow_attempt: 'attempt_test',
          tryoutflow_product: 'pro_annual',
        },
        phases: [{}, { start_date: end }],
      }),
    },
  };
  return { stripe: stripe as unknown as Stripe, release };
}
it.each([
  '2099-01-01T00:00:00Z',
  '2099-01-01T00:00:00.000Z',
  '2099-01-01T00:00:00+00:00',
  '2098-12-31T17:00:00-07:00',
])(
  'cancels when database and provider timestamps represent the same instant: %s',
  async (timestamp) => {
    const { stripe, release } = fixture();
    await cancelStripePlanChange(stripe, account, 'pro_annual', timestamp);
    expect(release).toHaveBeenCalledWith(
      'sched_test',
      {},
      { idempotencyKey: 'tf_change_release_sched_test' },
    );
  },
);
it.each(['2099-01-01T00:00:01Z', 'invalid', '2099-01-01T00:00:00.001Z'])(
  'rejects a changed or invalid renewal instant: %s',
  async (timestamp) => {
    const { stripe, release } = fixture();
    await expect(
      cancelStripePlanChange(stripe, account, 'pro_annual', timestamp),
    ).rejects.toThrow();
    expect(release).not.toHaveBeenCalled();
  },
);
