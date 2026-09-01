import type { ReactNode } from 'react';

export function Metric({
  detail,
  label,
  value,
}: {
  detail?: string;
  label: string;
  value: ReactNode;
}) {
  return (
    <dl className="metric-card">
      <dd className="score-value m-0 text-3xl text-[var(--color-text)]">{value}</dd>
      <dt className="mt-1 text-xs font-black uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
        {label}
      </dt>
      {detail ? <dd className="metric-detail">{detail}</dd> : null}
    </dl>
  );
}
