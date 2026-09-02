import Link from 'next/link';

import { StatusBadge } from '../../../components/ui/status-badge';
import type {
  JourneyAction,
  JourneyStageStatus,
  TryoutJourney as TryoutJourneyModel,
} from '../application/load-tryout-journey';

const statusLabels: Record<JourneyStageStatus, string> = {
  'not-started': 'Not started',
  'in-progress': 'In progress',
  ready: 'Ready',
  complete: 'Complete',
  unavailable: 'Unavailable',
};

export function TryoutJourney({ journey }: { journey: TryoutJourneyModel }) {
  const recommended = journey.stages.find((stage) => stage.id === journey.nextStage);
  if (!recommended) return null;
  return (
    <section aria-labelledby="tryout-journey-heading" className="tryout-action-plan">
      <div className="tryout-plan-heading">
        <div>
          <p className="eyebrow">Your operating plan</p>
          <h2 id="tryout-journey-heading">Tryout journey</h2>
        </div>
        <p className="workspace-note">
          These stages come from saved tryout records. Return here whenever you need direction.
        </p>
      </div>
      <section aria-label="Recommended next action" className="tryout-journey-recommendation">
        <div>
          <p className="eyebrow">Recommended next</p>
          <h3>{recommended.title}</h3>
          <p>{recommended.supportingText}</p>
        </div>
        <Link className="button-primary" href={journey.primaryAction.href} prefetch={false}>
          {journey.primaryAction.label}
        </Link>
      </section>
      <ol className="tryout-plan-grid">
        {journey.stages.map((stage, index) => (
          <li
            className={`tryout-plan-card ${stage.id === journey.nextStage ? 'tryout-plan-primary' : ''}`}
            key={stage.id}
          >
            <div className="tryout-journey-stage-heading">
              <span className="tryout-plan-number">{index + 1}</span>
              <StatusBadge status={stage.status}>{statusLabels[stage.status]}</StatusBadge>
            </div>
            <div>
              <h3>{stage.title}</h3>
              <p>{stage.purpose}</p>
            </div>
            <strong className="tryout-journey-supporting">{stage.supportingText}</strong>
            {stage.blocker ? <p className="tryout-journey-blocker">{stage.blocker}</p> : null}
            <Link className="button-secondary" href={stage.primaryAction.href} prefetch={false}>
              {stage.primaryAction.label}
            </Link>
            {stage.secondaryActions.length > 0 ? (
              <div className="tryout-plan-links">
                {stage.secondaryActions.map((action) => (
                  <Link href={action.href} key={`${stage.id}-${action.label}`} prefetch={false}>
                    {action.label}
                  </Link>
                ))}
              </div>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

export function TryoutJourneyNavigation({
  nextAction,
  overviewHref,
}: {
  nextAction: JourneyAction;
  overviewHref: string;
}) {
  return (
    <nav aria-label="Tryout journey" className="tryout-journey-navigation">
      <Link className="button-quiet" href={overviewHref} prefetch={false}>
        Back to overview
      </Link>
      <Link className="button-secondary" href={nextAction.href} prefetch={false}>
        Next: {nextAction.label}
      </Link>
    </nav>
  );
}
