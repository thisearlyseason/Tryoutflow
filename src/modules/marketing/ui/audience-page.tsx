import Link from 'next/link';

import { marketingLinkClassName } from '../../../components/layout/marketing-shell';
import { PageHero } from './page-hero';

export type AudiencePageProps = Readonly<{
  eyebrow: string;
  title: string;
  summary: string;
  outcomes: readonly Readonly<{ title: string; detail: string }>[];
  operatingModel: string;
}>;

export function AudiencePage({
  eyebrow,
  operatingModel,
  outcomes,
  summary,
  title,
}: AudiencePageProps) {
  return (
    <>
      <PageHero eyebrow={eyebrow} title={title}>
        <p>{summary}</p>
      </PageHero>
      <section
        aria-labelledby="audience-outcomes"
        className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8"
      >
        <div className="grid gap-8 lg:grid-cols-[.75fr_1.25fr]">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.18em] text-[var(--color-primary)]">
              Operational fit
            </p>
            <h2 className="mt-2 text-3xl font-black sm:text-5xl" id="audience-outcomes">
              A clear handoff at every stage
            </h2>
            <p className="mt-5 text-[var(--color-text-muted)]">{operatingModel}</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            {outcomes.map((outcome, index) => (
              <article
                className="border-t-4 border-[var(--color-text)] bg-[var(--color-surface)] p-5 shadow-[var(--shadow-surface)]"
                key={outcome.title}
              >
                <p className="font-[family-name:var(--font-bib)] text-3xl text-[var(--color-primary)]">
                  0{index + 1}
                </p>
                <h3 className="mt-8 text-xl font-black">{outcome.title}</h3>
                <p className="mt-2 text-sm leading-6 text-[var(--color-text-muted)]">
                  {outcome.detail}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>
      <section className="bg-[var(--color-performance)] px-4 py-12 text-[var(--color-performance-foreground)]">
        <div className="mx-auto flex max-w-5xl flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.18em]">See the workflow</p>
            <h2 className="mt-2 text-3xl font-black">Bring the whole tryout into focus.</h2>
          </div>
          <Link
            className={`${marketingLinkClassName} bg-[var(--color-text)] px-5 text-white hover:no-underline`}
            href="/pricing"
          >
            Compare plans
          </Link>
        </div>
      </section>
    </>
  );
}
