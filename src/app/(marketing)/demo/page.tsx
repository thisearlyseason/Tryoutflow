import type { Metadata } from 'next';
import Link from 'next/link';

import { marketingLinkClassName } from '../../../components/layout/marketing-shell';
import { marketingMetadata } from '../../../modules/marketing/content/metadata';
import { ProductProof } from '../../../modules/marketing/ui/product-proof';

export const metadata: Metadata = marketingMetadata({
  path: '/demo',
  title: 'Product Walkthrough | TryoutFlow',
  description:
    'Walk through the real TryoutFlow tryout workflow using synthetic, non-identifying product states.',
});

export default function DemoPage() {
  return (
    <>
      <section className="border-b border-[var(--color-border)] bg-[var(--color-text)] text-white">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
          <p className="text-sm font-black uppercase tracking-[0.18em] text-[#c7f000]">
            Self-guided demo
          </p>
          <h1 className="mt-4 max-w-5xl text-[clamp(2.75rem,7vw,5.75rem)] font-black leading-[0.94] tracking-[-0.055em]">
            A product walkthrough built from real workflow states
          </h1>
          <p className="mt-6 max-w-3xl text-lg leading-8 text-[#d8dee6]">
            These synthetic views show what staff see as a tryout moves from registration through
            communication. They contain no athlete identity or private evaluation notes.
          </p>
        </div>
      </section>
      <ProductProof />
      <section className="border-t border-[var(--color-border)] bg-[var(--color-surface-muted)] px-4 py-14">
        <div className="mx-auto grid max-w-5xl gap-7 md:grid-cols-[1fr_auto] md:items-center">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.18em] text-[var(--color-primary)]">
              Continue
            </p>
            <h2 className="mt-2 text-3xl font-black">Build a workspace for your own tryout.</h2>
            <p className="mt-3 text-[var(--color-text-muted)]">
              The public walkthrough does not connect to an organization or load tenant data.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link
              className={`${marketingLinkClassName} bg-[var(--color-primary)] px-5 text-white hover:no-underline`}
              href="/start"
            >
              Start a tryout
            </Link>
            <Link
              className={`${marketingLinkClassName} border border-[var(--color-border)] bg-[var(--color-surface)] px-5`}
              href="/sign-in"
            >
              Sign in
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
