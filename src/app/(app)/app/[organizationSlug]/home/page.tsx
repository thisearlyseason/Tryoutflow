import { captureOperationalError } from '@/infrastructure/observability/server-observability';
import { requireOrganizationRouteContext } from '@/modules/organizations/application/organization-route-context';
import { OrganizationCommandCenter } from '@/modules/organizations/components/organization-command-center';
import { buildHomeTasks, recommendHomeWork } from '@/modules/organizations/application/home-work';
import { buildAppNavigation } from '@/modules/organizations/components/app-navigation-model';
import { SupabaseOnboardingProgressGateway } from '@/modules/organizations/infrastructure/supabase-onboarding-progress-gateway';
import { loadTryoutJourney } from '@/modules/tryouts/application/load-tryout-journey';
import { loadSingleTryoutLifecycle } from '@/modules/tryouts/application/single-tryout-lifecycle';

export default async function OrganizationHomePage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;
  const current = await requireOrganizationRouteContext(organizationSlug);
  const { client, organization, authorization } = current;
  const canManage = ['owner', 'administrator'].includes(authorization.organizationRole);
  if (!canManage) {
    const ids = [
      ...new Set(authorization.assignments.map((assignment) => assignment.scope.tryoutId)),
    ];
    const [scouting, tryouts] = await Promise.allSettled([
      client.rpc('can_use_talent', { p_organization_id: organization.id }),
      ids.length
        ? client
            .from('tryouts')
            .select('id,name')
            .eq('organization_id', organization.id)
            .in('id', ids.slice(0, 100))
            .limit(100)
        : Promise.resolve({ data: [], error: null }),
    ]);
    const groups = buildAppNavigation({
      authorization,
      organizationSlug: organization.slug,
      hasScoutingAccess:
        scouting.status === 'fulfilled' && !scouting.value.error && !!scouting.value.data,
    });
    return (
      <OrganizationCommandCenter
        organizationSlug={organization.slug}
        organizationName={organization.name}
        tasksUnavailable={
          (scouting.status !== 'fulfilled' || !!scouting.value.error) && ids.length === 0
        }
        tasks={buildHomeTasks(
          groups,
          new Map(
            (tryouts.status === 'fulfilled' && !tryouts.value.error
              ? (tryouts.value.data ?? [])
              : []
            ).map((tryout) => [tryout.id, tryout.name]),
          ),
        )}
      />
    );
  }
  // A failed optional summary must not hide an otherwise available event task.
  const [projection, recent, athletes, active] = await Promise.allSettled([
    new SupabaseOnboardingProgressGateway(client).load(organization.id),
    client
      .from('tryouts')
      .select('id,name,status,updated_at')
      .eq('organization_id', organization.id)
      .order('updated_at', { ascending: false })
      .limit(4),
    client
      .from('athletes')
      .select('id,given_name,family_name,created_at')
      .eq('organization_id', organization.id)
      .order('created_at', { ascending: false })
      .limit(4),
    client
      .from('tryouts')
      .select('id')
      .eq('organization_id', organization.id)
      .in('status', ['draft', 'published'])
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const recentTryouts =
    recent.status === 'fulfilled' && !recent.value.error ? recent.value.data : null;
  const recentAthletes =
    athletes.status === 'fulfilled' && !athletes.value.error ? athletes.value.data : null;
  const activeTryout =
    active.status === 'fulfilled' && !active.value.error ? active.value.data : undefined;
  let recommendation = await recommendHomeWork(
    activeTryout,
    recentTryouts?.length ?? null,
    (tryoutId) =>
      loadTryoutJourney(client, {
        organizationId: organization.id,
        organizationSlug: organization.slug,
        tryoutId,
        authorization,
      }),
  );
  if (recommendation.kind === 'journey') {
    try {
      const lifecycle = await loadSingleTryoutLifecycle(
        client,
        organization.id,
        recommendation.journey.tryout.id,
      );
      if (lifecycle.locked)
        recommendation = {
          kind: 'results',
          name: recommendation.journey.tryout.name,
          href: `/app/${organization.slug}/tryouts/${recommendation.journey.tryout.id}/reports`,
        };
    } catch (error) {
      captureOperationalError(error, {
        actorId: current.userId,
        organizationId: organization.id,
        operation: 'onboarding.load',
      });
      recommendation = { kind: 'unavailable' };
    }
  }
  return (
    <OrganizationCommandCenter
      organizationSlug={organization.slug}
      organizationName={organization.name}
      showManagementActions
      projection={projection.status === 'fulfilled' ? projection.value : null}
      recommendation={recommendation}
      activity={{ tryouts: recentTryouts, athletes: recentAthletes }}
    />
  );
}

export const metadata = { title: 'Workspace home | TryoutFlow' };
