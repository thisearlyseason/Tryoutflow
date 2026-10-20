import { billingUpgradePrompt } from '@/modules/subscriptions/ui/server-feature-gate';
import Link from 'next/link';
import { ErrorState } from '@/components/feedback/error-state';
import { captureOperationalError } from '@/infrastructure/observability/server-observability';
import { requireOrganizationRouteContext } from '@/modules/organizations/application/organization-route-context';
import { requireCapability } from '@/modules/organizations/application/require-capability';
import { SupabaseReportGateway } from '@/modules/reports/infrastructure/supabase-report-gateway';
import { ReportsPage } from '@/modules/reports/ui/reports-page';
import { TryoutJourneyNavigation } from '@/modules/tryouts/ui/tryout-journey';

export default async function TryoutReportsPage({
  params,
}: {
  params: Promise<{ organizationSlug: string; tryoutId: string }>;
}) {
  const { organizationSlug, tryoutId } = await params;
  const current = await requireOrganizationRouteContext(organizationSlug);
  const upgrade = await billingUpgradePrompt(
    current.organization.id,
    organizationSlug,
    'export_reports',
    tryoutId,
  );
  if (upgrade) return upgrade;
  const auditAction = requireCapability(current.authorization, 'audit:read', {
    organizationId: current.organization.id,
  }).ok
    ? {
        label: 'Review audit history',
        href: `/app/${organizationSlug}/organization/audit`,
      }
    : undefined;
  const journeyNavigation = (
    <TryoutJourneyNavigation
      nextAction={auditAction}
      overviewHref={`/app/${organizationSlug}/tryouts/${tryoutId}/overview`}
    />
  );
  try {
    const summary = await new SupabaseReportGateway(current.client).summary(
      current.organization.id,
      tryoutId,
    );
    return (
      <section className="min-w-0">
        {journeyNavigation}
        {['owner', 'administrator'].includes(current.authorization.organizationRole) && (
          <Link
            className="button-secondary"
            prefetch={false}
            href={`/app/${organizationSlug}/tryouts/${tryoutId}/reports/decision-packet`}
          >
            Open director decision packet
          </Link>
        )}
        {summary ? (
          <ReportsPage
            organizationId={current.organization.id}
            access={summary}
            tryoutId={tryoutId}
          />
        ) : (
          <ErrorState
            title="Reports unavailable"
            description="Your current role or scope cannot view this report."
          />
        )}
      </section>
    );
  } catch (error) {
    captureOperationalError(error, {
      actorId: current.userId,
      organizationId: current.organization.id,
      tryoutId,
      operation: 'report.load',
    });
    return (
      <section className="min-w-0">
        {journeyNavigation}
        <ErrorState
          title="Reports unavailable"
          description="Refresh to load the latest report summary."
        />
      </section>
    );
  }
}
