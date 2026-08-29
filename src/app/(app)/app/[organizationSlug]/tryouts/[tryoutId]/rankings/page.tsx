import { ErrorState } from '@/components/feedback/error-state';
import { listRankings } from '@/modules/rankings/application/list-rankings';
import { SupabaseRankingGateway } from '@/modules/rankings/infrastructure/supabase-ranking-gateway';
import { RankingsWorkspace } from '@/modules/rankings/ui/rankings-workspace';
import { requireOrganizationRouteContext } from '@/modules/organizations/application/organization-route-context';

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function RankingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationSlug: string; tryoutId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { organizationSlug, tryoutId } = await params;
  const query = await searchParams;
  const current = await requireOrganizationRouteContext(organizationSlug);
  const requestedCompletion = first(query.completion) || 'all';
  const displayedCompletion = ['all', 'complete', 'incomplete', 'unscored'].includes(
    requestedCompletion,
  )
    ? (requestedCompletion as 'all' | 'complete' | 'incomplete' | 'unscored')
    : 'all';
  const filters = {
    divisionId: first(query.division) || undefined,
    positionId: first(query.position) || undefined,
    sessionId: first(query.session) || undefined,
    groupId: first(query.group) || undefined,
    completion: displayedCompletion,
    minimumEvaluators: Number(first(query.minimumEvaluators) || 0),
    search: first(query.search) || '',
  } as const;
  const result = await listRankings(
    {
      organizationId: current.organization.id,
      tryoutId,
      ...filters,
      completion: requestedCompletion,
      page: Number(first(query.page) || 1),
      pageSize: Number(first(query.pageSize) || 25),
    },
    current.authorization,
    new SupabaseRankingGateway(current.client),
  );
  return (
    <section aria-labelledby="rankings-heading" className="min-w-0">
      <p className="eyebrow">Decision evidence</p>
      <h2 id="rankings-heading">Rankings</h2>
      <p className="mb-6 mt-2 max-w-3xl text-[var(--color-text-muted)]">
        Competition ranks use completed evaluations only. Scores inform a human decision and never
        select an athlete automatically.
      </p>
      {result.ok ? (
        <RankingsWorkspace filters={filters} initial={result.value} />
      ) : (
        <ErrorState
          description={
            result.error.code === 'forbidden'
              ? 'Your current role or scope cannot view these rankings.'
              : 'Check the filters and try again.'
          }
          title={
            result.error.code === 'forbidden' ? 'Rankings access denied' : 'Rankings unavailable'
          }
        />
      )}
    </section>
  );
}
