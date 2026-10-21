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
  canScore = false,
}: {
  organizationSlug?: string;
  projection: OrganizationDashboardProjection;
  activity?: DashboardActivityData;
  showManagementActions?: boolean;
  canScore?: boolean;
}) {
  const base = organizationSlug && showManagementActions ? `/app/${organizationSlug}` : null;
  return (
    <div className="workspace-stack dashboard-workspace workflow-dashboard">
      <header className="workflow-page-heading">
        <div>
          <p className="eyebrow">Your workspace</p>
          <h1>What would you like to do?</h1>
          <p>
            Organize a tryout or open your assigned scoring sessions. These are separate tasks, even
            when you are both an organizer and an evaluator.
          </p>
        </div>
        {base ? (
          <LinkButton
            href={`${base}/tryouts/new`}
            variant={activity?.tryouts?.length ? 'secondary' : 'primary'}
          >
            <Plus size={18} aria-hidden="true" />
            Create tryout
          </LinkButton>
        ) : null}
      </header>
      {base ? (
        <section className="workflow-launches" aria-label="Continue your work">
          <Link
            href={
              activity?.tryouts?.[0]
                ? `${base}/tryouts/${activity.tryouts[0].id}/overview`
                : `${base}/tryouts`
            }
            prefetch={false}
          >
            <strong>
              {activity?.tryouts?.[0]
                ? `Continue ${activity.tryouts[0].name} →`
                : 'Organize a tryout →'}
            </strong>
            <span>Set up sessions, add athletes, assign evaluators and review results.</span>
          </Link>
          {canScore ? (
            <Link href={`${base}/evaluate`} prefetch={false}>
              <strong>My scoring →</strong>
              <span>Choose an assigned session and open an athlete’s scorecard.</span>
            </Link>
          ) : (
            <Link
              href={
                activity?.tryouts?.[0]
                  ? `${base}/tryouts/${activity.tryouts[0].id}/staff`
                  : `${base}/tryouts`
              }
              prefetch={false}
            >
              <strong>Set up evaluator assignments →</strong>
              <span>
                To score athletes, you also need an evaluator assignment. Being an organizer does
                not assign you automatically.
              </span>
            </Link>
          )}
          <Link href={`${base}/athletes`} prefetch={false}>
            <strong>Manage athletes →</strong>
            <span>Add one athlete or import a spreadsheet.</span>
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
        These are organization totals. Open a tryout’s Run Tryout dashboard to check arrivals,
        scoring progress and save status.
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
