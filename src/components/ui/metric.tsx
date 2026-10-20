import type { ReactNode } from 'react';

export function Metric({
  detail,
  icon,
  label,
  value,
  tone = 'blue',
}: {
  detail?: string;
  icon?: ReactNode;
  label: string;
  value: ReactNode;
  tone?: 'blue' | 'green' | 'orange' | 'navy';
}) {
  return (
    <dl className="metric-card" data-tone={tone}>
      {icon && (
        <div aria-hidden="true" className="metric-icon">
          {icon}
        </div>
      )}
      <div className="metric-copy">
        <dt className="metric-label">{label}</dt>
        <dd className="metric-value score-value">{value}</dd>
        {detail ? <dd className="metric-detail">{detail}</dd> : null}
      </div>
    </dl>
  );
}
