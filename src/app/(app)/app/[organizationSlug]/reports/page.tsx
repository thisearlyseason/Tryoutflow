import { loadWorkspaceNavigation } from '@/modules/organizations/application/team-workspaces';
import { billingUpgradePrompt } from '@/modules/subscriptions/ui/server-feature-gate';
import { FileText, TrendingUp, Download } from 'lucide-react';
import Link from 'next/link';
import { ErrorState } from '@/components/feedback/error-state';
import { captureOperationalError } from '@/infrastructure/observability/server-observability';
import { requireOrganizationRouteContext } from '@/modules/organizations/application/organization-route-context';
import { SupabaseReportGateway } from '@/modules/reports/infrastructure/supabase-report-gateway';
import { ReportsPage } from '@/modules/reports/ui/reports-page';
import { PageHeader } from '@/components/layout/page-header';

export default async function OrganizationReportsPage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;
  const current = await requireOrganizationRouteContext(organizationSlug);
  const upgrade = await billingUpgradePrompt(
    current.organization.id,
    organizationSlug,
    'organization_reporting',
  );
  if (upgrade) {
    const scoutingUpgrade = await billingUpgradePrompt(
      current.organization.id,
      organizationSlug,
      'advanced_scouting',
    );
    const { data: tryouts, error } = await current.client
      .from('tryouts')
      .select('id,name')
      .eq('organization_id', current.organization.id)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (
      <div className="workspace-stack">
        <PageHeader
          title="Reports"
          description="Open a tryout for the reports and exports included in its plan."
        />
        <div className="grid gap-4 sm:grid-cols-2">
          {tryouts.map((t) => (
            <Link
              className="workspace-card"
              key={t.id}
              href={`/app/${organizationSlug}/tryouts/${t.id}/reports`}
            >
              {t.name} →
            </Link>
          ))}
        </div>
        {!scoutingUpgrade && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Link className="workspace-card" href={`/app/${organizationSlug}/reports/scouting`}>
              Scouting &amp; performance report →
            </Link>
            <Link className="workspace-card" href={`/app/${organizationSlug}/reports/exports`}>
              Performance exports →
            </Link>
          </div>
        )}
        {upgrade}
      </div>
    );
  }

  const workspace = await loadWorkspaceNavigation(current.client, current.organization.id);
  try {
    const summary = await new SupabaseReportGateway(current.client).summary(
      current.organization.id,
    );
    return summary?.kind === 'manager' ? (
      <div className="workspace-stack">
        <PageHeader
          description="Use live evaluation and registration data to make roster decisions with confidence."
          eyebrow="Insights"
          title="Reports"
        />
        <div className="talent-report-links">
          <Link className="talent-report-link" href={`/app/${organizationSlug}/reports/scouting`}>
            <FileText size={22} aria-hidden="true" />
            <strong>Scouting & performance</strong>
            <p>
              Review shared evidence, follow-up priorities and athlete performance in one report.
            </p>
            <span>Open scouting report →</span>
          </Link>
          {!workspace.isTeam || workspace.parent?.canManage ? (
            <Link
              className="talent-report-link"
              href={`/app/${organizationSlug}/organization/teams`}
            >
              <strong>Team overview</strong>
              <span>Organization administrators can review activity across team workspaces.</span>
            </Link>
          ) : null}
          <Link className="talent-report-link" href={`/app/${organizationSlug}/reports/program`}>
            <TrendingUp size={22} aria-hidden="true" />
            <strong>Program progression</strong>
            <p>See participation, attendance and movement through your prospect pipeline.</p>
            <span>View program report →</span>
          </Link>
          <Link className="talent-report-link" href={`/app/${organizationSlug}/reports/exports`}>
            <Download size={22} aria-hidden="true" />
            <strong>Performance exports</strong>
            <p>Prepare a measurement export and return to download it when it is ready.</p>
            <span>Prepare an export →</span>
          </Link>
        </div>
        <ReportsPage organizationId={current.organization.id} access={summary} />
      </div>
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
