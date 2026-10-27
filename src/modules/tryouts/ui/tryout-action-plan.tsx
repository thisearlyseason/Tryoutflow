import Link from 'next/link';

import { StatusBadge } from '../../../components/ui/status-badge';

type TryoutStatus = 'draft' | 'published' | 'finalized';

function participantCopy(count: number | null) {
  if (count === null) return 'Registration count unavailable';
  return `${count} registered`;
}

export function TryoutActionPlan({
  baseHref,
  participantCount,
  status,
}: {
  baseHref: string;
  participantCount: number | null;
  status: TryoutStatus;
}) {
  const intakeAvailable = status !== 'draft';
  return (
    <section aria-labelledby="tryout-plan-heading" className="tryout-action-plan">
      <div className="tryout-plan-heading">
        <div>
          <p className="eyebrow">Your operating plan</p>
          <h2 id="tryout-plan-heading">What to do next</h2>
        </div>
        <p className="workspace-note">
          Work from left to right. Return here whenever you need direction.
        </p>
      </div>
      <ol className="tryout-plan-grid">
        <li className="tryout-plan-card">
          <span className="tryout-plan-number">1</span>
          <div>
            <h3>Prepare</h3>
            <p>Basics, divisions, forms, sessions, rubrics, and staff.</p>
          </div>
          {status === 'draft' ? (
            <>
              <StatusBadge status="in-progress">Recommended next</StatusBadge>
              <Link className="button-primary" href={`${baseHref}/setup/basics`} prefetch={false}>
                Continue setup
              </Link>
            </>
          ) : (
            <StatusBadge status="complete">Ready</StatusBadge>
          )}
        </li>
        <li className="tryout-plan-card tryout-plan-primary">
          <span className="tryout-plan-number">2</span>
          <div>
            <h3>Participants</h3>
            <p>
              {intakeAvailable ? participantCopy(participantCount) : 'Available after publishing'}
            </p>
          </div>
          {intakeAvailable ? (
            <>
              {status === 'published' ? (
                <StatusBadge status="in-progress">Recommended next</StatusBadge>
              ) : null}
              <Link
                className="button-primary"
                href={`${baseHref}/registration#add-participant`}
                prefetch={false}
              >
                Add participant
              </Link>
              <Link className="tryout-plan-secondary-link" href="#registration-share">
                Share registration link
              </Link>
            </>
          ) : (
            <span className="workspace-note">Finish setup to open registration.</span>
          )}
        </li>
        <li className="tryout-plan-card">
          <span className="tryout-plan-number">3</span>
          <div>
            <h3>Run tryout</h3>
            <p>Check in athletes, manage sessions, and collect evaluations.</p>
          </div>
          {intakeAvailable ? (
            <div className="tryout-plan-links">
              <Link href={`${baseHref}/check-in`} prefetch={false}>
                Check-in
              </Link>
              <Link href={`${baseHref}/live`} prefetch={false}>
                Live dashboard
              </Link>
            </div>
          ) : null}
        </li>
        <li className="tryout-plan-card">
          <span className="tryout-plan-number">4</span>
          <div>
            <h3>Make decisions</h3>
            <p>Review evidence, rank athletes, and build rosters.</p>
          </div>
          {intakeAvailable ? (
            <div className="tryout-plan-links">
              <Link href={`${baseHref}/rankings`} prefetch={false}>
                Rankings
              </Link>
              <Link href={`${baseHref}/rosters`} prefetch={false}>
                Rosters
              </Link>
            </div>
          ) : null}
        </li>
        <li className="tryout-plan-card">
          <span className="tryout-plan-number">5</span>
          <div>
            <h3>Complete</h3>
            <p>Send decisions, review reports, and preserve the final record.</p>
          </div>
          {intakeAvailable ? (
            <div className="tryout-plan-links">
              <Link href={`${baseHref}/messages`} prefetch={false}>
                Messages
              </Link>
              <Link href={`${baseHref}/reports`} prefetch={false}>
                Reports
              </Link>
            </div>
          ) : null}
        </li>
      </ol>
    </section>
  );
}
