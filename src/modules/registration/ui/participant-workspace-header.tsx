import Link from 'next/link';

import { PageHeader } from '../../../components/layout/page-header';
import { TryoutJourneyNavigation } from '../../tryouts/ui/tryout-journey';

export function ParticipantWorkspaceHeader({
  importHref,
  overviewHref,
  participantCount,
  tryoutName,
}: {
  importHref: string;
  overviewHref: string;
  participantCount: number | null;
  tryoutName: string;
}) {
  const overviewRoute = overviewHref.includes('#')
    ? overviewHref.slice(0, overviewHref.indexOf('#'))
    : overviewHref;
  const tryoutBase = overviewRoute.endsWith('/overview')
    ? overviewRoute.slice(0, -'/overview'.length)
    : overviewRoute;
  return (
    <div className="participant-workspace-header">
      <TryoutJourneyNavigation
        nextAction={{ label: 'Review sessions', href: `${tryoutBase}/sessions` }}
        overviewHref={overviewRoute}
      />
      <PageHeader
        context={
          <Link href={overviewRoute} prefetch={false}>
            Back to tryout overview
          </Link>
        }
        description="Add someone directly, reuse an existing athlete, or invite families to register themselves."
        eyebrow="Participants"
        title={`${tryoutName} participants`}
      />
      <div className="participant-summary-row">
        <strong>
          {participantCount === null ? 'Count unavailable' : `${participantCount} registered`}
        </strong>
        <span>Choose the intake path that matches the person in front of you.</span>
      </div>
      <nav aria-label="Participant intake options" className="participant-quick-actions">
        <a className="button-primary" href="#add-participant">
          Add a new participant
        </a>
        <a className="button-secondary" href="#returning-participant">
          Find a returning athlete
        </a>
        <Link className="button-secondary" href={overviewHref} prefetch={false}>
          Share registration link
        </Link>
        <Link className="button-quiet" href={importHref} prefetch={false}>
          Import CSV
        </Link>
      </nav>
    </div>
  );
}
