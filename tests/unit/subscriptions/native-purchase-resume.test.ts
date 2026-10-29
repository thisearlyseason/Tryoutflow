import { beforeEach, expect, it, vi } from 'vitest';
import { resumeNativePurchase } from '@/modules/subscriptions/application/native-purchase-resume';
import type { providerContext } from '@/modules/subscriptions/application/billing-service';
type Context = Awaited<ReturnType<typeof providerContext>>;
const intent = {
  id: 'reservation',
  organization_id: 'organization',
  purchaser_id: 'owner',
  tryout_id: null,
  provider: 'google' as const,
  product_key: 'pro_monthly' as const,
  contract_id: null,
  created_at: new Date().toISOString(),
  expires_at: new Date(Date.now() + 60000).toISOString(),
};
const reserve = vi.fn();
const hasLegacySubscription = vi.fn();
const options = () => ({
  context: {
    enabled: true,
    environment: 'sandbox',
    intents: [{ ...intent }],
    contracts: [],
  } as Context,
  scope: {
    organizationId: 'organization',
    purchaserId: 'owner',
    provider: 'google' as const,
    productKey: 'pro_monthly',
    tryoutId: null,
  },
  reserve,
  hasLegacySubscription,
});
beforeEach(() => {
  vi.resetAllMocks();
  reserve.mockResolvedValue({ ...intent, environment: 'sandbox' });
  hasLegacySubscription.mockResolvedValue(false);
});
it('resumes the exact original reservation without creating or extending one', async () => {
  expect(await resumeNativePurchase(options())).toBe(intent.id);
  expect(reserve).toHaveBeenCalledExactlyOnceWith(intent.id);
});
it.each([
  { organization_id: 'other' },
  { purchaser_id: 'other' },
  { provider: 'apple' },
  { provider: 'stripe' },
  { product_key: 'pro_annual' },
  { tryout_id: 'other' },
  { contract_id: 'completed' },
  { provider_session_id: 'checkout' },
  { expires_at: new Date(0).toISOString() },
  { expires_at: 'invalid' },
])('rejects reservations outside exact pending ownership/scope: %j', async (change) => {
  const o = options();
  Object.assign(o.context.intents[0]!, change);
  expect(await resumeNativePurchase(o)).toBeNull();
  expect(reserve).not.toHaveBeenCalled();
});
it('rejects ambiguous reservations', async () => {
  const o = options();
  o.context.intents.push({ ...intent, id: 'second' });
  expect(await resumeNativePurchase(o)).toBeNull();
  expect(reserve).not.toHaveBeenCalled();
});
it('retains database rejection instead of bypassing eligibility checks', async () => {
  reserve.mockRejectedValue(new Error('single_tryout_locked'));
  await expect(resumeNativePurchase(options())).rejects.toThrow('single_tryout_locked');
});
it.each([
  { id: 'other' },
  { organization_id: 'other' },
  { purchaser_id: 'other' },
  { provider: 'apple' },
  { product_key: 'pro_annual' },
  { tryout_id: 'other' },
  { environment: 'production' },
  { contract_id: 'completed' },
  { expires_at: new Date(Date.now() + 3600000).toISOString() },
])('rejects changed attribution/completion/expiry from the reservation RPC: %j', async (change) => {
  reserve.mockResolvedValue({ ...intent, environment: 'sandbox', ...change });
  expect(await resumeNativePurchase(options())).toBeNull();
});
it('fails closed on legacy subscription lookup failure', async () => {
  hasLegacySubscription.mockRejectedValue(new Error('unavailable'));
  await expect(resumeNativePurchase(options())).rejects.toThrow('unavailable');
  expect(reserve).not.toHaveBeenCalled();
});
it('does not resume over an existing paid legacy subscription', async () => {
  hasLegacySubscription.mockResolvedValue(true);
  expect(await resumeNativePurchase(options())).toBeNull();
  expect(reserve).not.toHaveBeenCalled();
});
it.each([
  'active',
  'trialing',
  'grace_period',
  'past_due',
  'cancelled',
  'refunded',
  'paused',
  'incomplete',
] as const)('blocks an intervening unexpired %s contract', async (status) => {
  const o = options();
  o.context.contracts.push({
    organization_id: 'organization',
    environment: 'sandbox',
    tryout_id: null,
    status,
    current_period_end: new Date(Date.now() + 60000).toISOString(),
    grace_period_end: null,
  } as Context['contracts'][number]);
  expect(await resumeNativePurchase(o)).toBeNull();
  expect(reserve).not.toHaveBeenCalled();
});
it('allows the historical expired contract but retains grace-period conflicts', async () => {
  const o = options();
  const contract = {
    organization_id: 'organization',
    environment: 'sandbox',
    tryout_id: null,
    status: 'expired',
    current_period_end: new Date(0).toISOString(),
    grace_period_end: null,
  } as Context['contracts'][number];
  o.context.contracts.push(contract);
  expect(await resumeNativePurchase(o)).toBe(intent.id);
  contract.status = 'grace_period';
  contract.grace_period_end = new Date(Date.now() + 60000).toISOString();
  expect(await resumeNativePurchase(o)).toBeNull();
});

it('does not bypass a competing pending checkout for a different product or owner', async () => {
  const o = options();
  o.context.intents.push({
    ...intent,
    id: 'competing',
    product_key: 'pro_annual',
    purchaser_id: 'other',
  });
  expect(await resumeNativePurchase(o)).toBeNull();
  expect(reserve).not.toHaveBeenCalled();
});
it('also resumes Apple using only its matching provider reservation', async () => {
  const o = options();
  const apple = { ...o, scope: { ...o.scope, provider: 'apple' as const } };
  apple.context.intents[0]!.provider = 'apple';
  reserve.mockResolvedValue({ ...intent, provider: 'apple', environment: 'sandbox' });
  expect(await resumeNativePurchase(apple)).toBe(intent.id);
});
it('rejects a purchase that completes while resumption is in progress', async () => {
  reserve.mockImplementation(async () => ({
    ...intent,
    environment: 'sandbox',
    contract_id: 'newly-completed',
  }));
  expect(await resumeNativePurchase(options())).toBeNull();
});
