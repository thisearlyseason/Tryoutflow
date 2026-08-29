import { ErrorState } from '@/components/feedback/error-state';
import { requireOrganizationRouteContext } from '@/modules/organizations/application/organization-route-context';
import {
  getLiveDashboard,
  SupabaseLiveDashboardGateway,
} from '@/modules/tryouts/application/get-live-dashboard';

export default async function LivePage({
  params,
}: {
  params: Promise<{ organizationSlug: string; tryoutId: string }>;
}) {
  const { organizationSlug, tryoutId } = await params;
  const current = await requireOrganizationRouteContext(organizationSlug);
  const result = await getLiveDashboard(
    { organizationId: current.organization.id, tryoutId },
    current.authorization,
    new SupabaseLiveDashboardGateway(current.client),
  );
  if (!result.ok)
    return (
      <ErrorState
        title="Live dashboard unavailable"
        description={
          result.error.code === 'forbidden'
            ? 'Your current role cannot view live operations.'
            : 'Refresh and try again.'
        }
      />
    );
  const cards = [
    ['Registrations', result.value.registrations],
    ['Checked in', result.value.checkedIn],
    ['Active evaluators', result.value.activeEvaluators],
    ['Completed evaluations', result.value.completedEvaluations],
    ['Expected evaluations', result.value.expectedEvaluations],
    ['Sync needs attention', result.value.syncNeedsAttention],
  ] as const;
  return (
    <section aria-labelledby="live-heading">
      <p className="eyebrow">Operational snapshot</p>
      <h2 id="live-heading">Live dashboard</h2>
      <p className="mt-2 text-[var(--color-text-muted)]">
        Current assignment coverage is a live operational view and can change when staffing changes.
      </p>
      <dl className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map(([label, value]) => (
          <div
            className="rounded-[var(--radius-surface)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
            key={label}
          >
            <dt className="text-sm text-[var(--color-text-muted)]">{label}</dt>
            <dd className="mt-1 font-[var(--font-bib)] text-3xl tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
