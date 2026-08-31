import type { Metadata } from 'next';

import { marketingMetadata } from '../../../modules/marketing/content/metadata';
import { PricingTable } from '../../../modules/marketing/ui/pricing-table';

export const metadata: Metadata = marketingMetadata({
  path: '/pricing',
  title: 'Pricing | TryoutFlow',
  description:
    'Compare TryoutFlow Team, Club, and Association launch plans in Canadian dollars per month.',
});

export default function PricingPage() {
  return (
    <>
      <section className="border-b border-[var(--color-border)]">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
          <p className="text-sm font-black uppercase tracking-[0.18em] text-[var(--color-primary)]">
            Launch plans
          </p>
          <h1 className="mt-4 max-w-4xl text-[clamp(2.75rem,7vw,5.75rem)] font-black leading-[0.94] tracking-[-0.055em]">
            Straightforward pricing for the way you run tryouts
          </h1>
          <p className="mt-6 max-w-3xl text-lg leading-8 text-[var(--color-text-muted)]">
            All amounts below are Canadian dollars per month. Choose the operating scale that fits
            your program; account access changes only after verified billing confirmation.
          </p>
        </div>
      </section>
      <section
        aria-labelledby="plan-comparison"
        className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8"
      >
        <h2 className="sr-only" id="plan-comparison">
          Plan comparison
        </h2>
        <PricingTable />
        <div className="mt-8 grid gap-5 border-t border-[var(--color-border)] pt-8 md:grid-cols-3">
          <div>
            <h2 className="font-black">Billing truth</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--color-text-muted)]">
              A return from checkout does not activate a plan by itself. The account page shows the
              last verified subscription state.
            </p>
          </div>
          <div>
            <h2 className="font-black">Roster responsibility</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--color-text-muted)]">
              Every plan supports human-directed roster review. TryoutFlow does not automatically
              select athletes.
            </p>
          </div>
          <div>
            <h2 className="font-black">Before purchase</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--color-text-muted)]">
              Taxes, cancellation, refunds, service levels, and final commercial terms require
              approval before production launch.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
