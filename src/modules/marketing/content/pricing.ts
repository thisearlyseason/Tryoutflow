import { BILLING_PRODUCTS } from '../../subscriptions/domain/billing-products';
import type { FeatureKey } from '../../subscriptions/domain/feature-catalog';

// Public USD prices confirmed by the owner against the configured Stripe catalog.
// Marketing copy only: checkout continues to use verified provider prices.
export const PUBLIC_PLANS = [
  {
    key: 'pro',
    name: 'TryOutFlow Pro',
    audience: 'Advanced evaluation tools for your ongoing tryouts.',
    priceUsd: 14.99,
    cadence: '/ month',
    annualPriceUsd: 149.99,
    included: 'Your full tryout toolkit',
    features: [
      'publish_tryout',
      'advanced_evaluations',
      'radar_charts',
      'player_comparison',
      'advanced_rankings',
      'custom_templates',
      'export_reports',
      'historical_data',
      'advanced_scouting',
      'unlimited_evaluators',
    ],
    note: 'Try Pro free for 7 days, then choose Pro Monthly or Pro Annual. No credit card and no automatic charge for the trial.',
    cta: 'Try Pro free for 7 days',
  },
  {
    key: 'organization',
    name: BILLING_PRODUCTS.organization_monthly.name,
    audience: 'Shared oversight and branding for your whole program.',
    priceUsd: 49.99,
    cadence: '/ month',
    annualPriceUsd: 499.99,
    included: 'Everything in Pro, plus',
    features: ['organization_management', 'custom_branding', 'organization_reporting'],
    note: 'Choose monthly or annual billing.',
    cta: 'Get started with Organization',
  },
  {
    key: 'single_tryout_pro',
    name: BILLING_PRODUCTS.single_tryout_pro.name,
    audience: 'Advanced tools for one tryout, with a one-time payment.',
    priceUsd: 34.99,
    cadence: '/ tryout · one time',
    annualPriceUsd: null,
    included: null,
    features: [
      'publish_tryout',
      'advanced_evaluations',
      'radar_charts',
      'player_comparison',
      'advanced_rankings',
      'custom_templates',
      'export_reports',
      'unlimited_evaluators',
    ],
    note: 'One event with sessions within 14 days. Event details and dates lock at publication; all editing locks on completion or 7 days after the last session. Results stay readable.',
    cta: 'Start a single tryout',
  },
] as const satisfies readonly {
  key: string;
  name: string;
  audience: string;
  priceUsd: number;
  cadence: string;
  annualPriceUsd: number | null;
  included: string | null;
  features: readonly FeatureKey[];
  note: string;
  cta: string;
}[];

export function formatPublicPrice(amount: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);
}
