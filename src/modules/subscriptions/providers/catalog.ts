import 'server-only';
import { BILLING_PRODUCTS, BILLING_PRODUCT_KEYS } from '../domain/billing-products';
import { FEATURE_CATALOG } from '../domain/feature-catalog';
import type { AvailableBillingProduct } from '../domain/billing-dashboard';
import { billingConfiguration } from './configuration';
import { stripeBillingClient } from './stripe';
export async function availableWebProducts(): Promise<AvailableBillingProduct[]> {
  const config = billingConfiguration();
  const stripe = stripeBillingClient();
  const result: AvailableBillingProduct[] = [];
  for (const key of BILLING_PRODUCT_KEYS) {
    const id = config.products[key].stripe;
    if (!id) continue;
    const price = await stripe.prices.retrieve(id);
    const product = BILLING_PRODUCTS[key];
    if (
      !price.active ||
      price.unit_amount === null ||
      price.livemode !== (config.environment === 'production') ||
      (price.recurring?.interval ?? null) !== product.interval
    )
      continue;
    result.push({
      key,
      name: product.name,
      price: new Intl.NumberFormat('en-CA', { style: 'currency', currency: price.currency }).format(
        price.unit_amount / 100,
      ),
      interval: product.interval,
      features: Object.entries(FEATURE_CATALOG)
        .filter(
          ([feature]) =>
            key !== 'single_tryout_pro' ||
            !['advanced_scouting', 'historical_data'].includes(feature),
        )
        .map(([, value]) => value)
        .filter((f) => f.tier !== 'organization' || product.tier === 'organization')
        .map((f) => f.name),
    });
  }
  return result;
}
