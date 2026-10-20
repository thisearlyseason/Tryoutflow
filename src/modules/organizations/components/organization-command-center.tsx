import { CalendarDays, ClipboardCheck, Plus, Trophy, Users } from 'lucide-react';
import Link from 'next/link';
import { Metric } from '../../../components/ui/metric';
import { LinkButton } from '../../../components/ui/link-button';
import type { OrganizationDashboardProjection } from '../application/onboarding-progress';
import { DashboardActivity, type DashboardActivityData } from './dashboard-activity';
import { OnboardingChecklist } from './onboarding-checklist';

export function OrganizationCommandCenter({
  organizationSlug,
  projection,
  activity,
  showManagementActions = false,
}: {
  organizationSlug?: string;
  projection: OrganizationDashboardProjection;
  activity?: DashboardActivityData;
  showManagementActions?: boolean;
}) {
  const base = organizationSlug && showManagementActions ? `/app/${organizationSlug}` : null;
  return (
    <div className="workspace-stack dashboard-workspace workflow-dashboard">
      <header className="workflow-page-heading">
        <div>
          <p className="eyebrow">Your workspace</p>
          <h1>Ready for the next tryout</h1>
          <p>
            Choose an event above to continue setup, run the floor, review evidence or share
            approved results.
          </p>
        </div>
        {base ? (
          <LinkButton href={`${base}/tryouts/new`}>
            <Plus size={18} aria-hidden="true" />
            Create tryout
          </LinkButton>
        ) : null}
      </header>
      {base ? (
        <section className="workflow-launches" aria-label="Continue your work">
          <Link href={`${base}/tryouts`} prefetch={false}>
            <strong>Open an event →</strong>
            <span>Setup · Run Tryout · Review Results · Share Results</span>
          </Link>
          <Link href={`${base}/athletes/import`} prefetch={false}>
            <strong>Import players →</strong>
            <span>Map columns, preview changes, then confirm.</span>
          </Link>
          <Link href={`${base}/evaluators`} prefetch={false}>
            <strong>Check staffing →</strong>
            <span>Assignments, readiness and calibration.</span>
          </Link>
        </section>
      ) : null}
      <section
        aria-label="Organization performance metrics"
        className="metric-grid workflow-metrics"
      >
        <Metric
          icon={<Users size={20} />}
          detail="Active assignments"
          label="Staff ready"
          value={projection.facts.activeStaffCount}
        />
        <Metric
          icon={<CalendarDays size={20} />}
          detail="Scheduled across your program"
          label="Sessions"
          value={projection.facts.sessionCount}
        />
        <Metric
          icon={<ClipboardCheck size={20} />}
          detail="Completed scorecards"
          label="Evaluations complete"
          value={projection.facts.completedEvaluationCount}
        />
        <Metric
          icon={<Trophy size={20} />}
          detail="Confirmed team rosters"
          label="Finalized rosters"
          value={projection.facts.finalizedRosterCount}
        />
      </section>
      <p className="workspace-note">
        These are program totals. Open an event’s Run Tryout dashboard for check-in, observation
        coverage and recorded sync receipts.
      </p>
      {base && activity ? (
        <div className="dashboard-columns">
          <DashboardActivity data={activity} organizationSlug={organizationSlug!} />
        </div>
      ) : null}
      {showManagementActions ? (
        <details
          className="card workflow-setup-progress"
          open={projection.progress.completedCount === 0}
        >
          <summary>
            Program setup · {projection.progress.completedCount} of {projection.progress.totalCount}{' '}
            complete
          </summary>
          <OnboardingChecklist organizationSlug={organizationSlug} progress={projection.progress} />
        </details>
      ) : null}
    </div>
  );
}
