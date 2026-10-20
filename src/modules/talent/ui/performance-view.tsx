import { EmptyState } from './workspace-ui';
import Link from 'next/link';
import { summarizeResults, formatMeasurement } from '../domain/performance';
import type { Row } from '../application/workspace';
export function PerformanceView({
  metrics,
  results,
  athletes,
  slug,
  athleteId,
}: {
  metrics: Row<'performance_metrics'>[];
  results: Row<'performance_results'>[];
  athletes: { id: string; given_name: string; family_name: string }[];
  slug: string;
  athleteId?: string;
}) {
  const active = metrics.filter((m) => results.some((r) => r.metric_id === m.id));
  if (!active.length)
    return (
      <EmptyState
        title="No measurements in this view"
        description="Record a trial using a defined metric, or adjust your filters to see existing results."
      />
    );
  return (
    <div className="talent-stack">
      {active.map((m) => {
        const rows = summarizeResults(m, results);
        const history = results
          .filter((r) => r.metric_id === m.id && (!athleteId || r.athlete_id === athleteId))
          .sort((a, b) => a.measured_at.localeCompare(b.measured_at) || a.trial - b.trial);
        const valid = history.filter((r) => r.status === 'valid' && r.value !== null);
        return (
          <section className="talent-card" key={m.id}>
            <div className="talent-toolbar">
              <div>
                <p className="eyebrow">
                  {m.sport} · {m.unit}
                </p>
                <h3>{m.name}</h3>
              </div>
              <span className="talent-tag">
                {m.aggregation} trial result ·{' '}
                {m.direction === 'neutral' ? 'Descriptive' : `${m.direction} is better`}
              </span>
            </div>
            <p className="talent-meta">Protocol: {m.protocol}</p>
            {athleteId ? (
              <>
                <p>
                  {history.length} attempts · {valid.length} valid
                </p>
                {valid.length > 1 && (
                  <>
                    <div
                      className="talent-chart"
                      role="img"
                      aria-label={`${m.name} trial history. Exact values are listed in the table below.`}
                    >
                      {valid.slice(-20).map((r) => (
                        <div
                          key={r.id}
                          title={`${r.measured_at}: ${formatMeasurement(r.value, m.unit)}`}
                          style={{
                            height: `${Math.max(4, ((r.value ?? 0) / Math.max(1, ...valid.map((v) => v.value ?? 0))) * 100)}%`,
                          }}
                        />
                      ))}
                    </div>
                    <p className="talent-meta">
                      Trial history in date order. Protocol and units are unchanged.
                    </p>
                  </>
                )}
                <div className="talent-table">
                  <table>
                    <caption className="sr-only">{m.name} trial history</caption>
                    <thead>
                      <tr>
                        <th>Date (UTC)</th>
                        <th>Trial</th>
                        <th>Result</th>
                        <th>Source</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((r) => (
                        <tr key={r.id}>
                          <td>{r.measured_at.slice(0, 16).replace('T', ' ')}</td>
                          <td>{r.trial}</td>
                          <td>
                            {r.status === 'valid'
                              ? formatMeasurement(r.value, m.unit)
                              : r.status.replaceAll('_', ' ')}
                          </td>
                          <td>
                            {r.source} · {r.verified ? 'Verified' : 'Unverified'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <>
                <p className="talent-meta">
                  Cohort: {rows.length} athletes with valid results in the selected filters.
                  Percentiles appear for at least 5 athletes and use mid-rank ties.
                </p>
                <div className="talent-table">
                  <table>
                    <caption className="sr-only">{m.name} comparison</caption>
                    <thead>
                      <tr>
                        <th>Rank</th>
                        <th>Athlete</th>
                        <th>Result</th>
                        <th>Trials</th>
                        <th>Percentile</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.athleteId}>
                          <td>{r.rank ?? '—'}</td>
                          <td>
                            <Link href={`/app/${slug}/athletes/${r.athleteId}?tab=stats`}>
                              {athletes.find((a) => a.id === r.athleteId)?.given_name}{' '}
                              {athletes.find((a) => a.id === r.athleteId)?.family_name}
                            </Link>
                          </td>
                          <td>
                            {formatMeasurement(r.value, m.unit)}
                            <br />
                            <small>{r.verified ? 'Verified' : 'Includes unverified results'}</small>
                          </td>
                          <td>{r.attempts}</td>
                          <td>
                            {m.direction === 'neutral'
                              ? 'Descriptive metric'
                              : r.percentile === null
                                ? 'Insufficient cohort'
                                : `${r.percentile}th`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>
        );
      })}
    </div>
  );
}
export function resultFields(
  athletes: { value: string; label: string }[],
  metrics: Row<'performance_metrics'>[],
  sessions: { value: string; label: string }[],
  fixedAthlete = false,
) {
  return [
    ...(!fixedAthlete
      ? [
          {
            name: 'athlete_id',
            label: 'Athlete',
            type: 'select' as const,
            required: true,
            options: athletes,
          },
        ]
      : []),
    {
      name: 'metric_id',
      label: 'Metric and protocol',
      type: 'select' as const,
      required: true,
      options: metrics.map((m) => ({ value: m.id, label: `${m.sport} · ${m.name} (${m.unit})` })),
    },
    { name: 'session_id', label: 'Session', type: 'select' as const, options: sessions },
    {
      name: 'status',
      label: 'Attempt status',
      type: 'select' as const,
      required: true,
      options: ['valid', 'invalid', 'not_observed', 'did_not_participate'].map((value) => ({
        value,
        label: value.replaceAll('_', ' '),
      })),
    },
    {
      name: 'value',
      label: 'Measured value',
      type: 'number' as const,
      help: 'Use the metric unit. For a ratio, fill successes and attempts instead.',
    },
    { name: 'numerator', label: 'Successes (ratio only)', type: 'number' as const },
    { name: 'denominator', label: 'Attempts (ratio only)', type: 'number' as const },
    { name: 'trial', label: 'Trial number', type: 'number' as const, required: true, step: '1' },
    {
      name: 'measured_at',
      label: 'Measured at (UTC)',
      type: 'datetime-local' as const,
      required: true,
    },
    { name: 'source', label: 'Source / operator / device', required: true },
    { name: 'verified', label: 'Verified against source', type: 'checkbox' as const },
    { name: 'note', label: 'Conditions or correction reason', type: 'textarea' as const },
  ];
}
