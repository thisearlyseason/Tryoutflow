export type Metric = {
  id: string;
  name: string;
  unit: string;
  direction: string;
  aggregation: string;
  protocol: string;
  sport: string;
  value_kind?: string;
};
export type Result = {
  athlete_id: string;
  metric_id: string;
  status: string;
  value: number | null;
  measured_at: string;
  trial: number;
  verified: boolean;
  numerator?: number | null;
  denominator?: number | null;
};
export function summarizeResults(metric: Metric, results: readonly Result[]) {
  const eligible = results.filter(
    (r) =>
      r.metric_id === metric.id &&
      r.status === 'valid' &&
      r.value !== null &&
      Number.isFinite(r.value),
  );
  const groups = new Map<string, Result[]>();
  for (const r of eligible) groups.set(r.athlete_id, [...(groups.get(r.athlete_id) ?? []), r]);
  const rows = [...groups].map(([athleteId, rs]) => {
    const sorted = [...rs].sort(
      (a, b) => a.measured_at.localeCompare(b.measured_at) || a.trial - b.trial,
    );
    const values = rs.map((r) => r.value!);
    const ratioTotal = rs.reduce((sum, r) => sum + (r.denominator ?? 0), 0);
    const ratioMean =
      metric.value_kind === 'ratio' && ratioTotal > 0
        ? (rs.reduce((sum, r) => sum + (r.numerator ?? 0), 0) / ratioTotal) * 100
        : null;
    const value =
      metric.aggregation === 'latest'
        ? sorted.at(-1)!.value!
        : metric.aggregation === 'mean'
          ? (ratioMean ?? values.reduce((a, b) => a + b, 0) / values.length)
          : metric.direction === 'lower'
            ? Math.min(...values)
            : Math.max(...values);
    return {
      athleteId,
      value,
      attempts: rs.length,
      verified: rs.every((r) => r.verified),
      latest: sorted.at(-1)!.measured_at,
    };
  });
  rows.sort((a, b) => (metric.direction === 'lower' ? a.value - b.value : b.value - a.value));
  return rows.map((r) => ({
    ...r,
    rank:
      metric.direction === 'neutral'
        ? null
        : 1 +
          rows.filter((x) => (metric.direction === 'lower' ? x.value < r.value : x.value > r.value))
            .length,
    percentile:
      metric.direction === 'neutral' || rows.length < 5
        ? null
        : Math.round(
            (100 *
              (rows.filter((x) =>
                metric.direction === 'lower' ? x.value > r.value : x.value < r.value,
              ).length +
                0.5 * rows.filter((x) => x.value === r.value).length)) /
              rows.length,
          ),
    cohortSize: rows.length,
  }));
}
export function formatMeasurement(value: number | null, unit: string) {
  return value === null
    ? 'Not measured'
    : `${new Intl.NumberFormat('en-CA', { maximumFractionDigits: 3 }).format(value)} ${unit}`;
}
export const sportTemplates = [
  {
    name: '20 m skating sprint',
    sport: 'Hockey',
    unit: 's',
    value_kind: 'duration',
    direction: 'lower',
    aggregation: 'best',
    protocol: 'Standing start, straight 20 m on ice; electronic timing; record all valid attempts.',
    minimum: 1,
    maximum: 30,
  },
  {
    name: 'Shot velocity',
    sport: 'Hockey',
    unit: 'km/h',
    value_kind: 'speed',
    direction: 'higher',
    aggregation: 'best',
    protocol:
      'Stationary puck, calibrated radar behind target; same shot type and distance for the cohort.',
    minimum: 0,
    maximum: 250,
  },
  {
    name: 'Target shooting accuracy',
    sport: 'Hockey',
    unit: '%',
    value_kind: 'ratio',
    direction: 'higher',
    aggregation: 'mean',
    protocol: 'Record target hits and total shots from the same marked distance.',
    minimum: 0,
    maximum: 100,
  },
  {
    name: 'Free throw accuracy',
    sport: 'Basketball',
    unit: '%',
    value_kind: 'ratio',
    direction: 'higher',
    aggregation: 'mean',
    protocol: 'Unopposed free throws from regulation line; record successes and attempts.',
    minimum: 0,
    maximum: 100,
  },
  {
    name: 'Standing vertical jump',
    sport: 'Basketball',
    unit: 'cm',
    value_kind: 'distance',
    direction: 'higher',
    aggregation: 'best',
    protocol:
      'Standing start; measured jump reach minus standing reach; same device across cohort.',
    minimum: 0,
    maximum: 150,
  },
  {
    name: '20 m sprint',
    sport: 'Soccer',
    unit: 's',
    value_kind: 'duration',
    direction: 'lower',
    aggregation: 'best',
    protocol: 'Standing start on same surface; electronic timing over 20 m.',
    minimum: 1,
    maximum: 30,
  },
] as const;
