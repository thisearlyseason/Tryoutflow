import type { ReactNode } from 'react';

export function Metric({ label, value }: { label: string; value: ReactNode }) {
  return (
    <dl className="m-0">
      <dd className="score-value m-0 text-3xl text-[var(--color-text)]">{value}</dd>
      <dt className="mt-1 text-xs font-black uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
        {label}
      </dt>
    </dl>
  );
}
