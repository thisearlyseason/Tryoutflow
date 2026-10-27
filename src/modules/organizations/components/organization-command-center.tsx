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
          <p>Manage tryouts, score athletes and review results.</p>
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
            <CalendarDays className="workflow-launch-icon" size={22} aria-hidden="true" />
            <strong>
              {activity?.tryouts?.[0]
                ? `Continue ${activity.tryouts[0].name} →`
                : 'Organize a tryout →'}
            </strong>
            <span>Sessions, athletes and results.</span>
          </Link>
          {canScore ? (
            <Link href={`${base}/evaluate`} prefetch={false}>
              <ClipboardCheck className="workflow-launch-icon" size={22} aria-hidden="true" />
              <strong>My scoring →</strong>
              <span>Open your assigned scorecards.</span>
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
              <ClipboardCheck className="workflow-launch-icon" size={22} aria-hidden="true" />
              <strong>Set up evaluator assignments →</strong>
              <span>Scoring requires an evaluator assignment.</span>
            </Link>
          )}
          <Link href={`${base}/athletes`} prefetch={false}>
            <Users className="workflow-launch-icon" size={22} aria-hidden="true" />
            <strong>Manage athletes →</strong>
            <span>Add athletes or import a roster.</span>
          </Link>
        </section>
      ) : null}
      <section
        aria-label="Organization performance metrics"
        className="metric-grid workflow-metrics"
      >
        <Metric
          icon={<Users size={20} />}
          label="Staff ready"
          value={projection.facts.activeStaffCount}
        />
        <Metric
          icon={<CalendarDays size={20} />}
          label="Sessions"
          value={projection.facts.sessionCount}
        />
        <Metric
          icon={<ClipboardCheck size={20} />}
          label="Evaluations complete"
          value={projection.facts.completedEvaluationCount}
        />
        <Metric
          icon={<Trophy size={20} />}
          label="Finalized rosters"
          value={projection.facts.finalizedRosterCount}
        />
      </section>
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
