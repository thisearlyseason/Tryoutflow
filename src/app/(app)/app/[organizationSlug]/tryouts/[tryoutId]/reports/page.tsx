import { ErrorState } from '@/components/feedback/error-state';
import { captureOperationalError } from '@/infrastructure/observability/server-observability';
import { requireOrganizationRouteContext } from '@/modules/organizations/application/organization-route-context';
import { SupabaseReportGateway } from '@/modules/reports/infrastructure/supabase-report-gateway';
import { ReportsPage } from '@/modules/reports/ui/reports-page';

export default async function TryoutReportsPage({
  params,
}: {
  params: Promise<{ organizationSlug: string; tryoutId: string }>;
}) {
  const { organizationSlug, tryoutId } = await params;
  const current = await requireOrganizationRouteContext(organizationSlug);
  try {
    const summary = await new SupabaseReportGateway(current.client).summary(
      current.organization.id,
      tryoutId,
    );
    return summary ? (
      <ReportsPage organizationId={current.organization.id} access={summary} tryoutId={tryoutId} />
    ) : (
      <ErrorState
        title="Reports unavailable"
        description="Your current role or scope cannot view this report."
      />
    );
  } catch (error) {
    captureOperationalError(error, {
      actorId: current.userId,
      organizationId: current.organization.id,
      tryoutId,
      operation: 'report.load',
    });
    return (
      <ErrorState
        title="Reports unavailable"
        description="Refresh to load the latest report summary."
      />
    );
  }
}
