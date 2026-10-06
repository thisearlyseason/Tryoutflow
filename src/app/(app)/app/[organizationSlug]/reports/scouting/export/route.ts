import { loadTalent } from '@/modules/talent/application/workspace';
import { serializeCsv } from '@/modules/reports/application/csv';
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ organizationSlug: string }> },
) {
  const { organizationSlug } = await params;
  const w = await loadTalent(organizationSlug);
  if (w.results.length > 5000)
    return new Response(
      'Export exceeds 5,000 trials. Select an athlete report or narrow the performance dataset.',
      { status: 413, headers: { 'Cache-Control': 'private, no-store' } },
    );
  const csv = serializeCsv(
    [
      'athlete_id',
      'athlete',
      'metric',
      'sport',
      'unit',
      'protocol',
      'value',
      'successes',
      'attempts',
      'status',
      'trial',
      'measured_at',
      'source',
      'verified',
      'note',
    ],
    w.results.map((r) => {
      const a = w.athletes.find((a) => a.id === r.athlete_id);
      const m = w.metrics.find((m) => m.id === r.metric_id);
      return [
        r.athlete_id,
        a ? `${a.given_name} ${a.family_name}` : '',
        m?.name ?? '',
        m?.sport ?? '',
        m?.unit ?? '',
        m?.protocol ?? '',
        r.value,
        r.numerator,
        r.denominator,
        r.status,
        r.trial,
        r.measured_at,
        r.source,
        r.verified ? 'true' : 'false',
        r.note,
      ];
    }),
  );
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="performance-results.csv"',
      'Cache-Control': 'private, no-store',
    },
  });
}
