import Link from 'next/link';

import { marketingLinkClassName } from '../../../components/layout/marketing-shell';
import { PLAN_CATALOG } from '../../subscriptions/domain/plan-catalog';
import type { PaidPlanKey } from '../../subscriptions/domain/plans';

const details: Record<PaidPlanKey, { audience: string; points: readonly string[] }> = {
  team: {
    audience: 'For one team running a focused tryout.',
    points: [
      'Registration and check-in',
      'Independent evaluator scoring',
      'Rankings, roster, and messages',
    ],
  },
  club: {
    audience: 'For clubs coordinating multiple teams.',
    points: ['Everything in Team', 'Multi-team tryout operations', 'Shared club workflow'],
  },
  association: {
    audience: 'For association-wide tryout programs.',
    points: [
      'Everything in Club',
      'Association-scale coordination',
      'Centralized operational oversight',
    ],
  },
};

const paidPlanKeys = ['team', 'club', 'association'] as const satisfies readonly PaidPlanKey[];

export function PricingTable() {
  return (
    <div className="grid min-w-0 gap-5 lg:grid-cols-3">
      {paidPlanKeys.map((key) => {
        const plan = PLAN_CATALOG[key];
        const detail = details[key];
        return (
          <article
            className={`flex min-w-0 flex-col rounded-[var(--radius-surface)] border bg-[var(--color-surface)] p-6 shadow-[var(--shadow-surface)] ${
              key === 'club'
                ? 'border-2 border-[var(--color-primary)]'
                : 'border-[var(--color-border)]'
            }`}
            key={key}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-2xl font-black">{plan.name}</h2>
                <p className="mt-2 text-sm text-[var(--color-text-muted)]">{detail.audience}</p>
              </div>
              {key === 'club' ? (
                <span className="rounded-full bg-[var(--color-performance)] px-3 py-2 text-xs font-black uppercase tracking-wide">
                  Multi-team
                </span>
              ) : null}
            </div>
            <p className="mt-7 flex flex-wrap items-baseline gap-x-2">
              <span className="font-[family-name:var(--font-score)] text-5xl font-black">
                ${plan.monthlyPriceCad}
              </span>
              <span className="text-sm font-bold text-[var(--color-text-muted)]">CAD / month</span>
            </p>
            <ul className="my-7 flex-1 space-y-3 border-y border-[var(--color-border)] py-6 text-sm">
              {detail.points.map((point) => (
                <li className="flex gap-3" key={point}>
                  <span aria-hidden="true" className="font-black text-[var(--color-primary)]">
                    ✓
                  </span>
                  <span>{point}</span>
                </li>
              ))}
            </ul>
            <Link
              className={`${marketingLinkClassName} bg-[var(--color-primary)] text-[var(--color-primary-foreground)] hover:no-underline`}
              href="/start"
            >
              Start with {plan.name}
            </Link>
          </article>
        );
      })}
    </div>
  );
}
