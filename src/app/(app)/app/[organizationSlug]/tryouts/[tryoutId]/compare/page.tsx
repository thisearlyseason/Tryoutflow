import Link from 'next/link';

import { ErrorState } from '@/components/feedback/error-state';
import { compareAthletes } from '@/modules/rankings/application/compare-athletes';
import { SupabaseRankingGateway } from '@/modules/rankings/infrastructure/supabase-ranking-gateway';
import { AthleteComparison } from '@/modules/rankings/ui/athlete-comparison';
import { requireOrganizationRouteContext } from '@/modules/organizations/application/organization-route-context';

export default async function ComparePage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationSlug: string; tryoutId: string }>;
  searchParams: Promise<{ athletes?: string | string[] }>;
}) {
  const { organizationSlug, tryoutId } = await params;
  const query = await searchParams;
  const raw = Array.isArray(query.athletes) ? query.athletes[0] : query.athletes;
  const current = await requireOrganizationRouteContext(organizationSlug);
  const result = await compareAthletes(
    { organizationId: current.organization.id, tryoutId, athleteIds: raw?.split(',') ?? [] },
    current.authorization,
    new SupabaseRankingGateway(current.client),
  );
  return (
    <section aria-labelledby="comparison-heading" className="min-w-0">
      <p className="eyebrow">Side-by-side evidence</p>
      <h2 id="comparison-heading">Athlete comparison</h2>
      <p className="mb-6 mt-2 text-[var(--color-text-muted)]">
        Compare two to four athletes without exposing individual evaluator work or private notes.
      </p>
      {result.ok ? (
        <AthleteComparison comparison={result.value} />
      ) : (
        <ErrorState
          title="Comparison unavailable"
          description={
            result.error.code === 'forbidden'
              ? 'Your current role or scope cannot compare these athletes.'
              : 'Select two to four athletes from the rankings workspace.'
          }
        />
      )}
      <Link
        className="mt-6 inline-flex min-h-11 items-center font-bold text-[var(--color-primary)]"
        href="./rankings"
      >
        Back to rankings
      </Link>
    </section>
  );
}
