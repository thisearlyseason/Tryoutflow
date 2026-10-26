import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { EvaluationForm } from '../../../src/modules/evaluations/ui/evaluation-form';
import { EvaluatorWorkspace } from '../../../src/modules/evaluations/ui/evaluator-workspace';
import {
  athletesAtStation,
  filterEvaluatorDestinations,
  nextUnscoredAthlete,
} from '../../../src/modules/evaluations/domain/evaluator-workspace';
import type { AssignedAthleteSummary } from '../../../src/modules/staffing/domain/assignment';
import type { OwnEvaluationSummary } from '../../../src/modules/evaluations/infrastructure/evaluator-session-loader';
const athletes: AssignedAthleteSummary[] = ['Blue', 'Red', 'Blue'].map((groupName, i) => ({
  registrationId: `athlete-${i}`,
  divisionId: 'division',
  sessionId: 'session',
  groupId: groupName,
  displayName: `Player ${i}`,
  divisionName: 'U14',
  sessionName: 'Skills',
  groupName,
  tryoutNumber: i + 1,
  identityMode: 'blind',
}));
const evaluations: OwnEvaluationSummary[] = [
  {
    id: 'evaluation',
    registrationId: 'athlete-0',
    rubricVersionId: 'rubric',
    state: 'completed',
    version: 1,
  },
];
const station = {
  id: 'station',
  name: 'Shooting',
  location: 'Court 1',
  instructions: 'Observe footwork.',
  groupLabel: ' blue ',
};
afterEach(cleanup);
it('intersects station group labels with existing assignments and selects only incomplete athletes', () => {
  expect(athletesAtStation(athletes, station).map((a) => a.registrationId)).toEqual([
    'athlete-0',
    'athlete-2',
  ]);
  expect(athletesAtStation(athletes, { ...station, groupLabel: 'Unassigned group' })).toEqual([]);
  expect(nextUnscoredAthlete(athletes, evaluations)?.registrationId).toBe('athlete-1');
  expect(nextUnscoredAthlete(athletes, evaluations, 'athlete-1')?.registrationId).toBe('athlete-2');
});
it('switches stations, searches and incomplete filters without creating scores or assignments', async () => {
  const user = userEvent.setup();
  render(
    <EvaluatorWorkspace
      athletes={athletes}
      evaluations={evaluations}
      basePath="/session"
      stations={[station]}
    />,
  );
  await user.click(screen.getByRole('button', { name: 'By station' }));
  await user.selectOptions(screen.getByLabelText('Station'), 'station');
  expect(screen.queryByText('Player 1')).toBeNull();
  expect(screen.getByText('Player 2')).toBeTruthy();
  await user.click(screen.getByRole('checkbox', { name: 'Incomplete only' }));
  expect(screen.queryByText('Player 0')).toBeNull();
  await user.type(screen.getByRole('searchbox'), '3');
  expect(screen.getByText('Player 2')).toBeTruthy();
  await user.clear(screen.getByRole('searchbox'));
  await user.click(screen.getByRole('button', { name: 'Overview grid' }));
  expect(screen.getByRole('table')).toBeTruthy();
  expect(screen.getAllByRole('link', { name: 'Open scoring' })[0]?.getAttribute('href')).toBe(
    '/session/athletes/athlete-1',
  );
  expect(screen.getByText(/Device drafts may still/)).toBeTruthy();
});
it('shows station failures without granting a new athlete or hiding authorized athletes', async () => {
  const user = userEvent.setup();
  render(
    <EvaluatorWorkspace
      athletes={athletes}
      evaluations={[]}
      basePath="/session"
      stationsUnavailable
    />,
  );
  await user.click(screen.getByRole('button', { name: 'By station' }));
  expect(screen.getByText(/Station details could not/)).toBeTruthy();
  expect(screen.getByText('Player 0')).toBeTruthy();
});

it('clears to missing and undoes through the ordinary draft save pipeline', async () => {
  const user = userEvent.setup();
  const categoryId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const save = vi.fn().mockResolvedValue({
    outcome: 'saved',
    evaluationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    version: 2,
  });
  render(
    <EvaluationForm
      athlete={{
        registrationId: 'athlete',
        displayName: 'Player',
        identityMode: 'blind',
        tryoutNumber: 1,
        divisionName: 'U14',
        sessionName: 'Skills',
        groupName: null,
      }}
      categories={[
        {
          id: categoryId,
          name: 'Shooting',
          description: null,
          guidance: null,
          scaleMin: 1,
          scaleMax: 5,
          required: true,
        },
      ]}
      initialDraft={{
        evaluationId: null,
        version: 0,
        state: 'draft',
        scores: [{ categoryId, value: 3 }],
      }}
      onSave={save}
      onComplete={vi.fn()}
    />,
  );
  await user.click(await screen.findByRole('button', { name: 'Clear Shooting score' }));
  expect(screen.getByRole('radio', { name: 'Shooting score 3 of 5' })).not.toBeChecked();
  expect(screen.getAllByText('Not scored').length).toBeGreaterThan(0);
  await user.click(screen.getByRole('button', { name: 'Undo last cleared score' }));
  expect(screen.getByRole('radio', { name: 'Shooting score 3 of 5' })).toBeChecked();
  await user.click(screen.getByRole('button', { name: 'Save now' }));
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({ scores: [{ categoryId, value: 3 }] }),
  );
});

it('selected event is an exact intersection and cannot silently broaden assignments', () => {
  const allowed = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const destinations = [
    { tryoutId: allowed, sessionId: 's1' },
    { tryoutId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', sessionId: 's2' },
  ];
  expect(filterEvaluatorDestinations(destinations, allowed)).toEqual([destinations[0]]);
  expect(filterEvaluatorDestinations(destinations, undefined)).toEqual(destinations);
  for (const requested of ['', 'other', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', [allowed, allowed]])
    expect(filterEvaluatorDestinations(destinations, requested)).toEqual([]);
});

it('does not describe an unmatched station group as completed or create assignments', async () => {
  const user = userEvent.setup();
  render(
    <EvaluatorWorkspace
      athletes={athletes}
      evaluations={evaluations}
      basePath="/session"
      stations={[{ ...station, groupLabel: 'Unknown group' }]}
    />,
  );
  await user.click(screen.getByRole('button', { name: 'By station' }));
  await user.selectOptions(screen.getByLabelText('Station'), 'station');
  expect(screen.getByText('No assigned athletes in this view.')).toBeTruthy();
  expect(screen.queryByText('All assigned evaluations in this view are complete.')).toBeNull();
  expect(screen.queryByText('Player 0')).toBeNull();
  expect(screen.queryByRole('link', { name: /Next unscored/ })).toBeNull();
  expect(screen.getByText('0 of 0 assigned athletes shown')).toBeTruthy();
});
