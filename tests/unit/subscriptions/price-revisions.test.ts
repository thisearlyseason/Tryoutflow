import { afterEach, expect, it, vi } from 'vitest';
import {
  billingConfiguration,
  productForProvider,
} from '@/modules/subscriptions/providers/configuration';

afterEach(() => vi.unstubAllEnvs());

it('recognizes prior prices without putting them in the purchase catalog', () => {
  vi.stubEnv('BILLING_ENVIRONMENT', 'sandbox');
  vi.stubEnv('STRIPE_PRICE_PRO_MONTHLY', 'price_current');
  vi.stubEnv('STRIPE_LEGACY_PRICES_PRO_MONTHLY', 'price_previous, price_older');
  expect(productForProvider('stripe', 'price_previous')).toBe('pro_monthly');
  expect(productForProvider('stripe', 'price_older')).toBe('pro_monthly');
  expect(productForProvider('stripe', 'price_current')).toBe('pro_monthly');
  expect(productForProvider('apple', 'price_previous')).toBeNull();
  expect(billingConfiguration().products.pro_monthly.stripe).toBe('price_current');
});

it('rejects a prior price assigned to another current product', () => {
  expect(() =>
    billingConfiguration({
      BILLING_ENVIRONMENT: 'sandbox',
      STRIPE_PRICE_PRO_ANNUAL: 'price_conflict',
      STRIPE_LEGACY_PRICES_PRO_MONTHLY: 'price_conflict',
    }),
  ).toThrow('ambiguous_product_configuration');
});

it('rejects a prior price attributed to two products', () => {
  expect(() =>
    billingConfiguration({
      BILLING_ENVIRONMENT: 'sandbox',
      STRIPE_LEGACY_PRICES_PRO_ANNUAL: 'price_conflict',
      STRIPE_LEGACY_PRICES_PRO_MONTHLY: 'price_conflict',
    }),
  ).toThrow('ambiguous_product_configuration');
});
