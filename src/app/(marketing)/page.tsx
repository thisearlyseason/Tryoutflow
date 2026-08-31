import type { Metadata } from 'next';
import Link from 'next/link';

import { marketingLinkClassName } from '../../components/layout/marketing-shell';
import { marketingMetadata } from '../../modules/marketing/content/metadata';
import { ProductProof } from '../../modules/marketing/ui/product-proof';

export const metadata: Metadata = marketingMetadata({
  path: '/',
  title: 'TryoutFlow | Better tryouts. Better decisions.',
  description:
    'Run registration, check-in, independent evaluation, rankings, rosters, and participant communication in one structured workflow.',
});

const audiences = [
  {
    href: '/for/teams',
    name: 'Team',
    tag: 'One focused tryout',
    text: 'Move one roster from registration to confirmed decisions without stitching together forms and spreadsheets.',
  },
  {
    href: '/for/clubs',
    name: 'Club',
    tag: 'Multiple teams',
    text: 'Give directors and evaluators one consistent workflow across divisions while keeping responsibilities clear.',
  },
  {
    href: '/for/associations',
    name: 'Association',
    tag: 'Program-wide control',
    text: 'Coordinate tryout operations across an association with visible status, scoped access, and explicit approvals.',
  },
] as const;

export default function HomePage() {
  return (
    <>
      <section className="relative overflow-hidden border-b border-[var(--color-border)]">
        <div
          aria-hidden="true"
          className="absolute -right-20 -top-24 size-80 rounded-full border-[3rem] border-[var(--color-performance)] sm:size-[32rem]"
        />
        <div className="relative mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-24 lg:px-8 lg:py-28">
          <p className="text-sm font-black uppercase tracking-[0.2em] text-[var(--color-primary)]">
            Better tryouts. Better decisions.
          </p>
          <h1 className="mt-5 max-w-6xl text-[clamp(3rem,9vw,7.5rem)] font-black leading-[0.85] tracking-[-0.065em]">
            Stop running tryouts with spreadsheets
          </h1>
          <div className="mt-8 grid gap-7 lg:grid-cols-[1fr_.65fr] lg:items-end">
            <p className="max-w-3xl text-xl leading-8 text-[var(--color-text-muted)]">
              Connect registration, check-in, independent evaluation, transparent rankings, roster
              review, and participant communication—without handing roster decisions to software.
            </p>
            <div className="flex flex-wrap gap-3 lg:justify-end">
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
                See the workflow
              </Link>
            </div>
          </div>
        </div>
      </section>
      <ProductProof />
      <section
        aria-labelledby="built-for-heading"
        className="border-t border-[var(--color-border)] bg-[var(--color-surface-muted)]"
      >
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
          <p className="text-sm font-black uppercase tracking-[0.18em] text-[var(--color-primary)]">
            Choose your operating scale
          </p>
          <h2 className="mt-2 text-3xl font-black sm:text-5xl" id="built-for-heading">
            One workflow, sized to your program
          </h2>
          <div className="mt-8 grid gap-px overflow-hidden rounded-[var(--radius-surface)] border border-[var(--color-border)] bg-[var(--color-border)] lg:grid-cols-3">
            {audiences.map((audience, index) => (
              <article
                className="flex min-w-0 flex-col bg-[var(--color-surface)] p-6"
                key={audience.name}
              >
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-2xl font-black">{audience.name}</h3>
                  <span className="font-[family-name:var(--font-bib)] text-3xl text-[var(--color-primary)]">
                    0{index + 1}
                  </span>
                </div>
                <p className="mt-8 font-black">{audience.tag}</p>
                <p className="mt-2 flex-1 text-sm leading-6 text-[var(--color-text-muted)]">
                  {audience.text}
                </p>
                <Link
                  className={`${marketingLinkClassName} mt-5 self-start px-0`}
                  href={audience.href}
                >
                  For {audience.name.toLowerCase()}s <span aria-hidden="true">→</span>
                </Link>
              </article>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
