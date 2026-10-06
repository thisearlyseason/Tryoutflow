import Link from 'next/link';
import { ArrowUpRight, Check, Flag, Sparkles, Zap } from 'lucide-react';
import { FEATURE_CATALOG } from '../../subscriptions/domain/feature-catalog';
import { PUBLIC_PLANS, formatPublicPrice } from '../content/pricing';

const icons = { pro: Zap, organization: Sparkles, single_tryout_pro: Flag };
const labels = {
  pro: 'Your next-level toolkit',
  organization: 'Big team energy',
  single_tryout_pro: 'One event. All in.',
};

export function PricingTable() {
  const purchasesAvailable = process.env.BILLING_CHECKOUT_ENABLED !== 'false';
  return (
    <div className="pricing-grid">
      {PUBLIC_PLANS.map((plan) => {
        const Icon = icons[plan.key];
        return (
          <article
            aria-labelledby={`plan-${plan.key}`}
            className={`pricing-card pricing-card-${plan.key}`}
            key={plan.key}
          >
            <div className="pricing-card-top">
              <span className="pricing-plan-icon">
                <Icon size={25} aria-hidden="true" />
              </span>
              <span>{labels[plan.key]}</span>
            </div>
            <div className="pricing-card-title">
              <p className="pricing-brand">TRYOUTFLOW</p>
              <h2 id={`plan-${plan.key}`}>
                {plan.key === 'pro'
                  ? 'Pro'
                  : plan.key === 'organization'
                    ? 'Organization'
                    : 'Single Tryout Pro'}
              </h2>
              <p>{plan.audience}</p>
            </div>
            <div className="pricing-price-block">
              <p className="pricing-price">
                <strong>{formatPublicPrice(plan.priceUsd)}</strong>
                <span>
                  {plan.key === 'pro' ? 'Pro Monthly · ' : ''}USD {plan.cadence}
                </span>
              </p>
              {plan.annualPriceUsd !== null ? (
                <p className="pricing-annual">
                  {plan.key === 'pro' ? 'Pro Annual · ' : 'or '}
                  {formatPublicPrice(plan.annualPriceUsd)} USD / year <span>· billed annually</span>
                </p>
              ) : (
                <p className="pricing-annual">One payment. One selected tryout.</p>
              )}
            </div>
            {plan.key === 'pro' ? (
              <div className="pricing-trial">
                <Sparkles size={17} aria-hidden="true" />
                <strong>Your first 7 days are free</strong>
              </div>
            ) : (
              <div className="pricing-plan-caption">
                {plan.key === 'organization'
                  ? 'Everything in Pro, made for your program.'
                  : 'Go Pro for the event that matters.'}
              </div>
            )}
            <Link className="pricing-cta" href={plan.key === 'pro' ? '/start?plan=pro' : '/start'}>
              {!purchasesAvailable && plan.key !== 'pro' ? 'Create your workspace' : plan.cta}
              <ArrowUpRight size={20} aria-hidden="true" />
            </Link>
            <p className="pricing-note">
              {plan.note}
              {!purchasesAvailable ? ' Paid checkout is coming soon.' : ''}
            </p>
            <div className="pricing-features">
              <h3>{plan.included ?? 'Pro tools for your selected tryout'}</h3>
              <ul>
                {plan.features.map((feature) => (
                  <li key={feature}>
                    <Check size={17} aria-hidden="true" />
                    <span>{FEATURE_CATALOG[feature].name}</span>
                  </li>
                ))}
              </ul>
            </div>
          </article>
        );
      })}
    </div>
  );
}
