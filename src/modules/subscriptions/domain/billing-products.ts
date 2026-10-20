export const BILLING_PRODUCTS = {
  pro_monthly: { name: 'Pro Monthly', tier: 'pro', kind: 'subscription', interval: 'month' },
  pro_annual: { name: 'Pro Annual', tier: 'pro', kind: 'subscription', interval: 'year' },
  organization_monthly: {
    name: 'TryOutFlow Organization',
    tier: 'organization',
    kind: 'subscription',
    interval: 'month',
  },
  organization_annual: {
    name: 'TryOutFlow Organization',
    tier: 'organization',
    kind: 'subscription',
    interval: 'year',
  },
  single_tryout_pro: { name: 'Single Tryout Pro', tier: 'pro', kind: 'tryout', interval: null },
} as const;
export type BillingProductKey = keyof typeof BILLING_PRODUCTS;
export const BILLING_PRODUCT_KEYS = Object.keys(BILLING_PRODUCTS) as BillingProductKey[];
export const PROVIDER_LABELS = {
  stripe: 'Web',
  apple: 'App Store',
  google: 'Google Play',
  manual: 'Promotional access',
  legacy: 'Existing plan',
  free: 'Free',
} as const;
export function isBillingProduct(value: string): value is BillingProductKey {
  return Object.hasOwn(BILLING_PRODUCTS, value);
}
export function managementUrl(provider: 'apple' | 'google') {
  return provider === 'apple'
    ? 'https://apps.apple.com/account/subscriptions'
    : 'https://play.google.com/store/account/subscriptions';
}
