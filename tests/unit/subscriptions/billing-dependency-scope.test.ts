// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  createBillingPortalRouteDependencies,
  createBillingRouteDependencies,
} from '@/app/api/organizations/[organizationId]/billing/billing-route-dependencies';

const mocks = vi.hoisted(() => ({ client: vi.fn(), admin: vi.fn() }));
vi.mock('@/infrastructure/supabase/server', () => ({ createServerSupabaseClient: mocks.client }));
vi.mock('@/infrastructure/supabase/admin', () => ({ createAdminSupabaseClient: mocks.admin }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.client.mockResolvedValue({});
  mocks.admin.mockImplementation(() => {
    throw new Error('checkout writer must not initialize for portal management');
  });
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://www.tryout.agency');
  vi.stubEnv('STRIPE_SECRET_KEY', `sk_test_${'x'.repeat(32)}`);
  vi.stubEnv('STRIPE_PRICE_TEAM', 'retired');
  vi.stubEnv('STRIPE_PRICE_CLUB', 'retired');
  vi.stubEnv('STRIPE_PRICE_ASSOCIATION', 'retired');
});
afterEach(() => vi.unstubAllEnvs());

it('initializes existing-customer management without retired checkout prices or a writer', async () => {
  const result = await createBillingPortalRouteDependencies();
  expect(result.canonicalOrigin).toBe('https://www.tryout.agency');
  expect(result.provider).toBeDefined();
  expect(result.authenticate).toBeTypeOf('function');
  expect(result.loadOwnedAccount).toBeTypeOf('function');
  expect(result).not.toHaveProperty('prices');
  expect(result).not.toHaveProperty('checkoutIntents');
  expect(mocks.admin).not.toHaveBeenCalled();
});

it('still rejects invalid legacy checkout mapping and never guesses active catalog prices', async () => {
  vi.stubEnv('STRIPE_PRICE_PRO_MONTHLY', 'price_CurrentProMonthly');
  vi.stubEnv('STRIPE_PRICE_ORGANIZATION_MONTHLY', 'price_CurrentOrganizationMonthly');
  await expect(createBillingRouteDependencies()).rejects.toMatchObject({ name: 'ZodError' });
  expect(mocks.admin).not.toHaveBeenCalled();
});
