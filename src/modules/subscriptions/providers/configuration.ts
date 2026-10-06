import 'server-only';
import { BILLING_PRODUCT_KEYS, type BillingProductKey } from '../domain/billing-products';
export function billingConfiguration(env: Record<string, string | undefined> = process.env) {
  const environment = env.BILLING_ENVIRONMENT;
  if (environment !== 'production' && environment !== 'sandbox')
    throw new Error('billing_not_configured');
  const products = Object.fromEntries(
    BILLING_PRODUCT_KEYS.map((key) => [
      key,
      {
        stripe: env[`STRIPE_PRICE_${key.toUpperCase()}`] ?? null,
        apple: env[`REVENUECAT_APPLE_${key.toUpperCase()}`] ?? null,
        google: env[`REVENUECAT_GOOGLE_${key.toUpperCase()}`] ?? null,
      },
    ]),
  ) as Record<BillingProductKey, Record<'stripe' | 'apple' | 'google', string | null>>;
  for (const provider of ['stripe', 'apple', 'google'] as const) {
    const values = Object.values(products)
      .map((p) => p[provider])
      .filter(Boolean);
    if (new Set(values).size !== values.length) throw new Error('ambiguous_product_configuration');
  }
  // Retired prices remain recognizable for renewals, refunds and restore; they
  // are never offered by the checkout catalog.
  const legacyStripePrices = Object.fromEntries(
    BILLING_PRODUCT_KEYS.map((key) => [
      key,
      (env[`STRIPE_LEGACY_PRICES_${key.toUpperCase()}`] ?? '')
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean),
    ]),
  ) as Record<BillingProductKey, string[]>;
  const owners = new Map<string, BillingProductKey>();
  for (const key of BILLING_PRODUCT_KEYS) {
    for (const id of [products[key].stripe, ...legacyStripePrices[key]]) {
      if (!id) continue;
      if (owners.has(id) && owners.get(id) !== key)
        throw new Error('ambiguous_product_configuration');
      owners.set(id, key);
    }
  }
  return { environment, products, legacyStripePrices };
}
export function productForProvider(provider: 'stripe' | 'apple' | 'google', id: string) {
  const { products, legacyStripePrices } = billingConfiguration();
  return (
    BILLING_PRODUCT_KEYS.find(
      (key) =>
        products[key][provider] === id ||
        (provider === 'stripe' && legacyStripePrices[key].includes(id)),
    ) ?? null
  );
}
