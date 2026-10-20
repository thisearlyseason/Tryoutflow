import Link from 'next/link';

import type { AssignedAthleteSummary } from '../../staffing/domain/assignment';
import type { OwnEvaluationSummary } from '../infrastructure/evaluator-session-loader';

export function EvaluationRouteMessage({
  outcome,
}: {
  outcome: 'forbidden' | 'unexpected' | 'empty' | 'empty_assignments';
}) {
  const content =
    outcome === 'forbidden'
      ? {
          heading: 'Session unavailable',
          detail:
            'Your evaluator assignment does not include this session, or it is no longer active.',
        }
      : outcome === 'empty'
        ? {
            heading: 'No assigned athletes',
            detail: 'There are no eligible athletes in your current session assignment.',
          }
        : outcome === 'empty_assignments'
          ? {
              heading: 'No active evaluator assignments',
              detail: 'Ask an organizer to assign you to a tryout, division, session, or group.',
            }
          : {
              heading: 'Evaluation workspace unavailable',
              detail: 'The session could not be loaded. Refresh the page or try again shortly.',
            };
  return (
    <section
      aria-labelledby="evaluation-state-heading"
      className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5"
    >
      <p className="eyebrow">Evaluator workspace</p>
      <h2 id="evaluation-state-heading">{content.heading}</h2>
      <p className="mt-2 text-[var(--color-text-muted)]">{content.detail}</p>
    </section>
  );
}

export function AssignedAthleteList({
  athletes,
  basePath,
  evaluations,
}: {
  athletes: AssignedAthleteSummary[];
  basePath: string;
  evaluations: OwnEvaluationSummary[];
}) {
  const evaluationByRegistration = new Map(
    evaluations.map((evaluation) => [evaluation.registrationId, evaluation]),
  );
  return (
    <ul className="grid min-w-0 gap-3">
      {athletes.map((athlete) => {
        const evaluation = evaluationByRegistration.get(athlete.registrationId);
        const state = evaluation?.state ?? 'not started';
        return (
          <li
            className="grid min-w-0 gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 sm:grid-cols-[auto_1fr_auto] sm:items-center"
            key={athlete.registrationId}
          >
            <p className="font-[var(--font-bib)] text-3xl tabular-nums">
              {athlete.tryoutNumber === null ? '—' : `#${athlete.tryoutNumber}`}
            </p>
            <div className="min-w-0">
              <h3 className="break-words font-bold">{athlete.displayName}</h3>
              <p className="break-words text-sm text-[var(--color-text-muted)]">
                {athlete.divisionName} ·{' '}
                {athlete.groupName ?? athlete.sessionName ?? 'Assigned session'}
              </p>
              <p className="mt-1 text-sm font-bold capitalize">Your evaluation: {state}</p>
            </div>
            <Link
              className="min-h-[44px] rounded-lg bg-[var(--color-primary)] px-4 py-3 text-center font-bold text-[var(--color-primary-foreground)] focus:outline-3 focus:outline-offset-2 focus:outline-[var(--color-focus)]"
              href={`${basePath}/athletes/${athlete.registrationId}`}
              prefetch={false}
            >
              {evaluation ? 'Open evaluation' : 'Start evaluation'}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
