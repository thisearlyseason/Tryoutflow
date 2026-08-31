import Link from 'next/link';
import type { ReactNode } from 'react';

import { marketingLinkClassName } from '../../../components/layout/marketing-shell';

export function PageHero({
  children,
  eyebrow,
  title,
}: {
  children: ReactNode;
  eyebrow: string;
  title: string;
}) {
  return (
    <section className="relative overflow-hidden border-b border-[var(--color-border)]">
      <div
        aria-hidden="true"
        className="absolute inset-y-0 right-0 hidden w-1/3 border-l border-[var(--color-border)] bg-[linear-gradient(90deg,transparent_49%,var(--color-border)_50%,transparent_51%)] bg-[length:4rem_100%] opacity-35 md:block"
      />
      <div className="relative mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8 lg:py-24">
        <p className="text-sm font-black uppercase tracking-[0.18em] text-[var(--color-primary)]">
          {eyebrow}
        </p>
        <h1 className="mt-4 max-w-5xl text-[clamp(2.5rem,7vw,5.75rem)] font-black leading-[0.94] tracking-[-0.055em]">
          {title}
        </h1>
        <div className="mt-7 max-w-3xl text-lg leading-8 text-[var(--color-text-muted)]">
          {children}
        </div>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            className={`${marketingLinkClassName} bg-[var(--color-primary)] px-5 text-[var(--color-primary-foreground)] hover:no-underline`}
            href="/start"
          >
            Start a tryout
          </Link>
          <Link
            className={`${marketingLinkClassName} border border-[var(--color-border)] bg-[var(--color-surface)] px-5`}
            href="/demo"
          >
            View product walkthrough
          </Link>
        </div>
      </div>
    </section>
  );
}
