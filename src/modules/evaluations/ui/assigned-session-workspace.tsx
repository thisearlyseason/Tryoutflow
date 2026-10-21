import Link from 'next/link';
import { firstIncompleteAssignedAthlete } from '../application/list-evaluator-destinations';
import { AssignedAthleteList } from './session-state';
import type { AssignedAthleteSummary } from '../../staffing/domain/assignment';
import type { OwnEvaluationSummary } from '../infrastructure/evaluator-session-loader';

export function AssignedSessionWorkspace({
  athletes,
  evaluations,
  sessionName,
  basePath,
}: {
  athletes: AssignedAthleteSummary[];
  evaluations: OwnEvaluationSummary[];
  sessionName: string;
  basePath: string;
}) {
  const completed = evaluations.filter(
    (evaluation) => evaluation.state === 'completed' || evaluation.state === 'locked',
  ).length;
  const nextIncomplete = firstIncompleteAssignedAthlete(athletes, evaluations);
  return (
    <section aria-labelledby="evaluator-session-heading" className="grid min-w-0 gap-6">
      <header>
        <p className="eyebrow">Evaluator session</p>
        <h1 id="evaluator-session-heading">{sessionName}</h1>
        <p className="mt-2 text-[var(--color-text-muted)]">
          {completed} of {athletes.length} evaluations confirmed complete on the server.
        </p>
      </header>
      <p className="text-sm text-[var(--color-text-muted)]">
        Device drafts may still need to sync. Open an athlete to check device and server save
        states. A missing score is not a zero, absence or skipped observation.
      </p>
      <section aria-labelledby="assigned-athletes-heading" className="grid gap-3">
        <h2 id="assigned-athletes-heading">Choose an athlete</h2>
        <p>
          Scores save automatically as drafts. Complete an evaluation only when you have finished
          scoring that athlete.
        </p>
        <AssignedAthleteList athletes={athletes} evaluations={evaluations} basePath={basePath} />
      </section>
      <div className="grid gap-3 sm:grid-cols-3">
        <Link
          className="min-h-[44px] rounded-xl bg-[var(--color-primary)] p-5 font-bold text-[var(--color-primary-foreground)]"
          href={nextIncomplete ? `${basePath}/athletes/${nextIncomplete}` : `${basePath}/progress`}
          prefetch={false}
        >
          {nextIncomplete ? 'Continue an unfinished evaluation' : 'Review completed session'}
        </Link>
        <Link
          className="min-h-[44px] rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 font-bold"
          href={`${basePath}/athletes`}
          prefetch={false}
        >
          Search athletes or score by station
        </Link>
        <Link
          className="min-h-[44px] rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 font-bold"
          href={`${basePath}/progress`}
          prefetch={false}
        >
          Your progress
        </Link>
      </div>
    </section>
  );
}
