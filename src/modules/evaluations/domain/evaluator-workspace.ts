import type { AssignedAthleteSummary } from '../../staffing/domain/assignment';
import type { OwnEvaluationSummary } from '../infrastructure/evaluator-session-loader';

export type EvaluatorStation = {
  id: string;
  name: string;
  location: string;
  instructions: string;
  groupLabel: string;
};

// Station labels organize an already authorized list. They never add an assignment.
export function athletesAtStation(athletes: AssignedAthleteSummary[], station: EvaluatorStation) {
  const group = station.groupLabel.trim().toLocaleLowerCase();
  return group
    ? athletes.filter((athlete) => athlete.groupName?.trim().toLocaleLowerCase() === group)
    : athletes;
}

export function nextUnscoredAthlete(
  athletes: AssignedAthleteSummary[],
  evaluations: OwnEvaluationSummary[],
  excludeRegistrationId?: string,
) {
  const completed = new Set(
    evaluations
      .filter((item) => item.state === 'completed' || item.state === 'locked')
      .map((item) => item.registrationId),
  );
  return athletes.find(
    (item) => item.registrationId !== excludeRegistrationId && !completed.has(item.registrationId),
  );
}

export function filterEvaluatorDestinations<T extends { tryoutId: string }>(
  destinations: T[],
  requested: string | string[] | undefined,
) {
  if (requested === undefined) return destinations;
  // Explicit malformed/unknown selection stays empty; never broaden to other events.
  if (
    typeof requested !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requested)
  )
    return [];
  return destinations.filter((destination) => destination.tryoutId === requested);
}
