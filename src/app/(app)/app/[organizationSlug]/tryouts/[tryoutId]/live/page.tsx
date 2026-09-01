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
    ['Recorded sync exceptions', result.value.recordedSyncExceptions],
  ] as const;
  return (
    <section
      aria-labelledby="live-heading"
      className="theme-game-day rounded-[var(--radius-surface)] bg-[var(--color-canvas)] p-4 text-[var(--color-text)] shadow-[var(--shadow-raised)] sm:p-6"
    >
      <p className="eyebrow">Operational snapshot</p>
      <h2 id="live-heading">Live dashboard</h2>
      <p className="mt-2 text-[var(--color-text-muted)]">
        Current assignment coverage is a live operational view and can change when staffing changes.
        Recorded sync exceptions are historical non-synced receipts (including conflicts and
        forbidden outcomes), not a count of currently unresolved work.
      </p>
      <dl className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map(([label, value]) => (
          <div
            className="rounded-[var(--radius-surface)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-5 shadow-[var(--shadow-surface)]"
            key={label}
          >
            <dt className="text-sm text-[var(--color-text-muted)]">{label}</dt>
            <dd className="mt-2 font-[var(--font-bib)] text-5xl tabular-nums text-[var(--color-performance)]">
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
