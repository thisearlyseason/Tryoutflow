import { LinkButton } from '../../../components/ui/link-button';
import { StatusBadge } from '../../../components/ui/status-badge';
import type { OnboardingProgress } from '../application/onboarding-progress';

const milestonePaths = {
  organization: 'organization/settings',
  settings: 'organization/settings',
  registration: 'tryouts',
  staff: 'evaluators',
  rubric: 'tryouts',
  session: 'tryouts',
  evaluation: 'evaluate',
  finalRoster: 'tryouts',
} as const;

export function OnboardingChecklist({
  organizationSlug,
  progress,
}: {
  organizationSlug?: string;
  progress: OnboardingProgress;
}) {
  return (
    <section aria-labelledby="onboarding-heading" className="card onboarding-card">
      <div className="onboarding-heading-row">
        <div>
          <p className="eyebrow">Season readiness</p>
          <h2 id="onboarding-heading">Your operations checklist</h2>
        </div>
        <strong>{progress.percent}%</strong>
      </div>
      <div
        aria-label="Onboarding progress"
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={progress.percent}
        className="onboarding-progress"
        role="progressbar"
      >
        <div style={{ width: `${progress.percent}%` }} />
      </div>
      <p className="onboarding-summary">
        {progress.completedCount} of {progress.totalCount} complete
      </p>
      <ol className="onboarding-list">
        {progress.items.map((item) => (
          <li key={item.key}>
            <span>{item.label}</span>
            <StatusBadge status={item.complete ? 'ready' : 'draft'}>
              {item.complete ? 'Complete' : 'Next'}
            </StatusBadge>
          </li>
        ))}
      </ol>
      {organizationSlug && progress.next ? (
        <div className="onboarding-next">
          <span>
            <small>Next action</small>
            <strong>{progress.next.label}</strong>
          </span>
          <LinkButton href={`/app/${organizationSlug}/${milestonePaths[progress.next.key]}`}>
            Continue setup
          </LinkButton>
        </div>
      ) : null}
    </section>
  );
}
