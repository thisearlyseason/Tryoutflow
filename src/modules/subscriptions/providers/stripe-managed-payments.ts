import type Stripe from 'stripe';

// Explicit supported SaaS classification is required; never inherit an unrelated
// account default or silently retry a purchase as standard merchant checkout.
const codes = new Set(['txcd_10103000', 'txcd_10103001', 'txcd_10103100', 'txcd_10103101']);
export function assertManagedPrice(price: Stripe.Price, live: boolean) {
  const product = price.product;
  if (
    !price.active ||
    price.livemode !== live ||
    !product ||
    typeof product === 'string' ||
    product.deleted ||
    !product.active ||
    product.livemode !== live
  )
    throw new Error('managed_product_not_verified');
  const code = typeof product.tax_code === 'string' ? product.tax_code : product.tax_code?.id;
  if (!code || !codes.has(code)) throw new Error('managed_product_classification_required');
}
