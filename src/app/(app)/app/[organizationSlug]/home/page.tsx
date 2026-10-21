import Link from 'next/link';
import {
  buildAppNavigation,
  flattenNavigation,
} from '@/modules/organizations/components/app-navigation-model';
import { ErrorState } from '@/components/feedback/error-state';
import { captureOperationalError } from '@/infrastructure/observability/server-observability';
import { requireOrganizationRouteContext } from '@/modules/organizations/application/organization-route-context';
import { OrganizationCommandCenter } from '@/modules/organizations/components/organization-command-center';
import { SupabaseOnboardingProgressGateway } from '@/modules/organizations/infrastructure/supabase-onboarding-progress-gateway';

export default async function OrganizationHomePage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;
  const current = await requireOrganizationRouteContext(organizationSlug);
  const canManage = ['owner', 'administrator'].includes(current.authorization.organizationRole);
  if (!canManage) {
    const { data: hasScoutingAccess } = await current.client.rpc('can_use_talent', {
      p_organization_id: current.organization.id,
    });
    const assignedIds = [
      ...new Set(current.authorization.assignments.map(({ scope }) => scope.tryoutId)),
    ];
    const names = assignedIds.length
      ? await current.client
          .from('tryouts')
          .select('id,name')
          .eq('organization_id', current.organization.id)
          .in('id', assignedIds)
      : null;
    const tasks = flattenNavigation(
      buildAppNavigation({
        authorization: current.authorization,
        organizationSlug,
        hasScoutingAccess: !!hasScoutingAccess,
        tryoutNames: Object.fromEntries((names?.data ?? []).map(({ id, name }) => [id, name])),
      }),
    );
    return (
      <section className="workspace-stack">
        <header>
          <p className="eyebrow">Your workspace</p>
          <h1>Choose your task</h1>
          <p>Open a task assigned to you. Organizer setup is separate from scoring.</p>
        </header>
        {tasks.length ? (
          <ul className="grid gap-3 sm:grid-cols-2">
            {tasks.map((task) => (
              <li className="card" key={task.href}>
                <Link className="button-primary" href={task.href} prefetch={false}>
                  {task.label}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p>No tasks are assigned yet. Ask your organizer to assign you to a tryout session.</p>
        )}
      </section>
    );
  }
  try {
    const projection = await new SupabaseOnboardingProgressGateway(current.client).load(
      current.organization.id,
    );
    const [tryouts, athletes] = canManage
      ? await Promise.all([
          current.client
            .from('tryouts')
            .select('id,name,status,updated_at')
            .eq('organization_id', current.organization.id)
            .order('updated_at', { ascending: false })
            .limit(4),
          current.client
            .from('athletes')
            .select('id,given_name,family_name,created_at')
            .eq('organization_id', current.organization.id)
            .order('created_at', { ascending: false })
            .limit(4),
        ])
      : [
          { data: null, error: null },
          { data: null, error: null },
        ];
    return projection ? (
      <OrganizationCommandCenter
        organizationSlug={current.organization.slug}
        projection={projection}
        showManagementActions={canManage}
        canScore={current.authorization.assignments.some(({ role }) => role === 'evaluator')}
        activity={{
          tryouts: tryouts.error ? null : tryouts.data,
          athletes: athletes.error ? null : athletes.data,
        }}
      />
    ) : (
      <ErrorState
        title="Onboarding unavailable"
        description="Your current role cannot view this setup progress."
      />
    );
  } catch (error) {
    captureOperationalError(error, {
      actorId: current.userId,
      organizationId: current.organization.id,
      operation: 'onboarding.load',
    });
    return (
      <ErrorState
        title="Onboarding unavailable"
        description="Refresh to load the latest durable setup progress."
      />
    );
  }
}
