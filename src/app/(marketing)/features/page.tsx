import type { Metadata } from 'next';

import { marketingMetadata } from '../../../modules/marketing/content/metadata';
import { PageHero } from '../../../modules/marketing/ui/page-hero';

export const metadata: Metadata = marketingMetadata({
  path: '/features',
  title: 'Features | TryoutFlow',
  description:
    'See the TryoutFlow workflow for registration, check-in, evaluation, rankings, rosters, messages, and exports.',
});

const stages = [
  [
    'Register',
    'Publish a guardian-led registration form, review duplicates, and keep athlete accounts out of the process.',
  ],
  [
    'Check in',
    'Find registrations, assign valid tryout numbers, and place athletes into the right session or group.',
  ],
  [
    'Evaluate',
    'Scope evaluator assignments, keep peer scores private by default, and show accurate device and sync state.',
  ],
  [
    'Review',
    'Compare weighted results with completion context, filters, flags, and genuine ties left intact.',
  ],
  [
    'Build rosters',
    'Move athletes with accessible controls, review balance, and explicitly finalize or revise a version.',
  ],
  [
    'Communicate',
    'Prepare recipient-specific messages and track delivery independently from the underlying roster decision.',
  ],
] as const;

export default function FeaturesPage() {
  return (
    <>
      <PageHero eyebrow="The complete tryout path" title="One workflow from registration to roster">
        <p>
          Each stage has a clear owner, a truthful state, and an explicit handoff. TryoutFlow
          provides evidence and structure; directors still make the decisions.
        </p>
      </PageHero>
      <section
        aria-labelledby="feature-stages"
        className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8"
      >
        <h2 className="sr-only" id="feature-stages">
          TryoutFlow workflow features
        </h2>
        <ol className="grid gap-px overflow-hidden rounded-[var(--radius-surface)] border border-[var(--color-border)] bg-[var(--color-border)] md:grid-cols-2 lg:grid-cols-3">
          {stages.map(([title, detail], index) => (
            <li className="min-w-0 bg-[var(--color-surface)] p-6" key={title}>
              <p className="font-[family-name:var(--font-bib)] text-4xl text-[var(--color-primary)]">
                0{index + 1}
              </p>
              <h3 className="mt-8 text-2xl font-black">{title}</h3>
              <p className="mt-3 leading-7 text-[var(--color-text-muted)]">{detail}</p>
            </li>
          ))}
        </ol>
      </section>
      <section className="border-y border-[var(--color-border)] bg-[var(--color-text)] px-4 py-14 text-white">
        <div className="mx-auto grid max-w-5xl gap-6 sm:grid-cols-3">
          <div>
            <p className="text-3xl font-black text-[#c7f000]">Explicit</p>
            <p className="mt-2 text-sm text-[#d8dee6]">
              Publish, finalize, notify, and export remain separate confirmed actions.
            </p>
          </div>
          <div>
            <p className="text-3xl font-black text-[#c7f000]">Human</p>
            <p className="mt-2 text-sm text-[#d8dee6]">
              Rankings inform coaching judgment; they do not choose a roster.
            </p>
          </div>
          <div>
            <p className="text-3xl font-black text-[#c7f000]">Privacy-aware</p>
            <p className="mt-2 text-sm text-[#d8dee6]">
              Roles limit who can see rankings, notes, contact details, and roster work.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
