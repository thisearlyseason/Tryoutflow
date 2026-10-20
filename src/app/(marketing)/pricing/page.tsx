import type { Metadata } from 'next';
import { ArrowDownRight, HeartHandshake, ShieldCheck, Sparkles } from 'lucide-react';
import { marketingMetadata } from '../../../modules/marketing/content/metadata';
import { PricingTable } from '../../../modules/marketing/ui/pricing-table';
import './pricing.css';

export const metadata: Metadata = marketingMetadata({
  path: '/pricing',
  title: 'Pricing | TryoutFlow',
  description:
    'Find your TryoutFlow plan: Pro with a 7-day free trial, Organization, or Single Tryout Pro. Monthly, annual, and one-time pricing in USD.',
});

export default function PricingPage() {
  const purchasesAvailable = process.env.BILLING_CHECKOUT_ENABLED !== 'false';
  return (
    <div className="pricing-page">
      <section className="pricing-hero" aria-labelledby="pricing-title">
        <div className="pricing-hero-inner">
          <p className="pricing-eyebrow">
            <span /> SMALL PRICE. BIG GAME.
          </p>
          <h1 id="pricing-title">
            Great tryouts.
            <br />
            <span>Game-changing pricing.</span>
          </h1>
          <p className="pricing-intro">
            Less admin. More potential. Pick your plan and give your next team a brilliant start.
          </p>
          <div className="pricing-hero-bottom">
            <p>
              Three ways to make it happen. <ArrowDownRight size={22} aria-hidden="true" />
            </p>
            <span className="pricing-currency">All prices in USD</span>
          </div>
          <div className="pricing-sticker" aria-hidden="true">
            <Sparkles size={26} />
            <strong>
              LET’S
              <br />
              PLAY.
            </strong>
          </div>
        </div>
      </section>
      <section aria-label="Plan comparison" className="pricing-section">
        {!purchasesAvailable && (
          <p className="mb-6 rounded-2xl bg-white p-5 text-center font-bold">
            Start with a 7-day Pro trial today. Paid plans are coming soon at the prices below.
          </p>
        )}
        <PricingTable />
      </section>
      <section className="pricing-reassurance" aria-label="Good to know">
        <div>
          <Sparkles aria-hidden="true" />
          <h2>Try it. Love it. Go Pro.</h2>
          <p>
            Activate your 7-day Pro trial when you’re ready. No credit card and no automatic charge.
            {purchasesAvailable
              ? 'Choose a paid plan to keep Pro features after your trial.'
              : 'Paid checkout is coming soon. Your work stays saved when the trial ends.'}
          </p>
        </div>
        <div>
          <ShieldCheck aria-hidden="true" />
          <h2>Your work stays yours.</h2>
          <p>
            Your athletes, evaluations, and historical records are preserved when a trial ends or
            your plan changes.
          </p>
        </div>
        <div>
          <HeartHandshake aria-hidden="true" />
          <h2>Clear from the start.</h2>
          <p>
            Review applicable taxes and billing terms at checkout. Mobile store prices may vary by
            region and currency.
          </p>
        </div>
      </section>
    </div>
  );
}
