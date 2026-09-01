import { Metric } from '../../../components/ui/metric';
import { PageHeader } from '../../../components/layout/page-header';
import type { OrganizationDashboardProjection } from '../application/onboarding-progress';
import { OnboardingChecklist } from './onboarding-checklist';

export function OrganizationCommandCenter({
  organizationSlug,
  projection,
}: {
  organizationSlug?: string;
  projection: OrganizationDashboardProjection;
}) {
  return (
    <div className="workspace-stack">
      <PageHeader
        description="Track the durable operating signals that move a tryout from setup to final roster."
        eyebrow="Command center"
        title="Operations overview"
      />
      <section aria-label="Organization performance metrics" className="metric-grid">
        <Metric
          detail="Active assignments"
          label="Staff ready"
          value={projection.facts.activeStaffCount}
        />
        <Metric detail="Scheduled events" label="Sessions" value={projection.facts.sessionCount} />
        <Metric
          detail="Durable scorecards"
          label="Evaluations complete"
          value={projection.facts.completedEvaluationCount}
        />
        <Metric
          detail="Immutable snapshots"
          label="Finalized rosters"
          value={projection.facts.finalizedRosterCount}
        />
      </section>
      <OnboardingChecklist organizationSlug={organizationSlug} progress={projection.progress} />
    </div>
  );
}
