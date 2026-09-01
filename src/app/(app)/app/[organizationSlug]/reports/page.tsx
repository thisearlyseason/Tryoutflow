import { ErrorState } from '@/components/feedback/error-state';
import { captureOperationalError } from '@/infrastructure/observability/server-observability';
import { requireOrganizationRouteContext } from '@/modules/organizations/application/organization-route-context';
import { SupabaseReportGateway } from '@/modules/reports/infrastructure/supabase-report-gateway';
import { ReportsPage } from '@/modules/reports/ui/reports-page';

export default async function OrganizationReportsPage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;
  const current = await requireOrganizationRouteContext(organizationSlug);
  try {
    const summary = await new SupabaseReportGateway(current.client).summary(
      current.organization.id,
    );
    return summary?.kind === 'manager' ? (
      <ReportsPage organizationId={current.organization.id} access={summary} />
    ) : (
      <ErrorState
        title="Reports unavailable"
        description="Your current role cannot view organization reports."
      />
    );
  } catch (error) {
    captureOperationalError(error, {
      actorId: current.userId,
      organizationId: current.organization.id,
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
