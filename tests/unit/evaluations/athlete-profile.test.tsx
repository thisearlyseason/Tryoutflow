import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { profileRows, formatProfileScore } from '@/modules/evaluations/domain/athlete-profile';
import { AthleteRadarChart } from '@/modules/evaluations/ui/athlete-radar-chart';
import { EvaluationForm } from '@/modules/evaluations/ui/evaluation-form';
import { AthleteComparisonRadar } from '@/modules/rankings/ui/athlete-comparison-radar';

const criteria = ['Agility', 'Control', 'Vision', 'Defense'].map((name, index) => ({
  id: `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa${index}`,
  name,
  scaleMin: 1 as const,
  scaleMax: 5 as const,
  required: true,
  weight: '25',
  description: null,
  guidance: null,
}));
const scores = criteria.slice(0, 3).map((criterion) => ({ categoryId: criterion.id, value: 4 }));
afterEach(cleanup);

describe('athlete profile projection', () => {
  it('binds by criterion ID, keeps form order and preserves unanswered criteria as null', () => {
    const rows = profileRows(criteria, [...scores, { categoryId: 'other-template', value: 5 }]);
    expect(rows.map((row) => row.name)).toEqual(['Agility', 'Control', 'Vision', 'Defense']);
    expect(rows.map((row) => row.normalized)).toEqual([80, 80, 80, null]);
    expect(formatProfileScore(rows[3]!.value, 5)).toBe('Not scored');
  });
  it('normalizes mixed configured scales without changing the raw tooltip values', () => {
    const rows = profileRows(
      [
        { id: 'a', name: 'A', scaleMin: 1, scaleMax: 5 },
        { id: 'b', name: 'B', scaleMin: 1, scaleMax: 10 },
        { id: 'c', name: 'C', scaleMin: 0, scaleMax: 100 },
      ],
      [
        { categoryId: 'a', value: 4 },
        { categoryId: 'b', value: 8 },
        { categoryId: 'c', value: 0 },
      ],
    );
    expect(rows.map((row) => row.normalized)).toEqual([80, 80, 0]);
    expect(formatProfileScore(rows[0]!.value, 5)).toBe('4 / 5');
    expect(formatProfileScore(rows[2]!.value, 100)).toBe('0 / 100');
  });
  it('retains fractional averages and rejects invalid or out-of-range chart values', () => {
    expect(
      profileRows(criteria, [{ categoryId: criteria[0]!.id, value: 3.75 }])[0]!.normalized,
    ).toBe(75);
    for (const value of [NaN, Infinity, -1, 6, 0]) {
      expect(profileRows(criteria, [{ categoryId: criteria[0]!.id, value }])[0]!.value).toBeNull();
    }
  });
  it('aligns comparison by ID and never substitutes the other athlete for a missing score', () => {
    const rows = profileRows(criteria, scores, [{ categoryId: criteria[3]!.id, value: 5 }]);
    expect(rows[0]).toMatchObject({ value: 4, comparisonValue: null });
    expect(rows[3]).toMatchObject({ value: null, comparisonValue: 5 });
  });
});

it('shows the exact threshold message and accessible raw scores without a polygon', () => {
  render(<AthleteRadarChart criteria={criteria} scores={scores.slice(0, 2)} />);
  expect(
    screen.getByText('Score at least 3 criteria to generate the Athlete Profile.'),
  ).toBeVisible();
  expect(screen.queryByTestId('athlete-radar-plot')).toBeNull();
  expect(screen.getAllByText('Not scored')).toHaveLength(2);
});

it('updates from the unsaved draft and shows the canonical weighted total and private note after completion', async () => {
  const user = userEvent.setup();
  let resolveSave!: (value: { outcome: 'saved'; evaluationId: string; version: number }) => void;
  const save = vi.fn(
    () =>
      new Promise<{ outcome: 'saved'; evaluationId: string; version: number }>((resolve) => {
        resolveSave = resolve;
      }),
  );
  render(
    <EvaluationForm
      athlete={{
        registrationId: 'athlete',
        displayName: 'Athlete 42',
        identityMode: 'blind',
        tryoutNumber: 42,
        divisionName: 'Open',
        sessionName: 'Skills',
        groupName: null,
      }}
      categories={criteria}
      initialDraft={{
        evaluationId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        version: 1,
        state: 'draft',
        scores: criteria.map((criterion) => ({ categoryId: criterion.id, value: 4 })),
        note: 'Good control',
      }}
      onSave={save}
      onComplete={async () => ({ outcome: 'completed', version: 3 })}
    />,
  );
  await user.click(screen.getByText('Athlete Profile', { selector: '.profile-title' }));
  await user.click(screen.getByRole('radio', { name: 'Agility score 5 of 5' }));
  const profile = within(screen.getByTestId('athlete-radar-profile'));
  expect(profile.getByText('5 / 5')).toBeVisible();
  expect(screen.getByTestId('profile-overall')).toHaveAttribute('data-value', '85.0000');
  expect(screen.getByTestId('profile-overall')).toHaveTextContent('85.0 / 100');
  await user.click(screen.getByRole('button', { name: 'Save now' }));
  expect(save).toHaveBeenCalledTimes(1);
  expect(profile.getByText('5 / 5')).toBeVisible();
  await act(async () =>
    resolveSave({
      outcome: 'saved',
      evaluationId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      version: 2,
    }),
  );
  await user.click(screen.getByRole('button', { name: 'Complete evaluation' }));
  expect(await screen.findByText('Good control', { selector: 'p' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Evaluation completed' })).toBeDisabled();
});

it('does not overlay identically named criteria from different template versions', () => {
  const athlete = (id: string) => ({
    athleteId: id,
    displayName: id,
    tryoutNumber: 1,
    divisionName: 'Open',
    positionName: null,
    overall: '80.00',
    completedEvaluators: 1,
    expectedEvaluators: 1,
    completionPercent: 100,
    scoreRange: null,
    flags: [],
    sessions: [],
    categories: criteria.map((criterion) => ({
      categoryId: `${id}-${criterion.id}`,
      name: criterion.name,
      normalizedAverage: '80.00',
      scaleMax: 5 as const,
    })),
  });
  render(<AthleteComparisonRadar athletes={[athlete('One'), athlete('Two')]} />);
  expect(screen.getByText(/At least 3 scored criteria from the same form version/)).toBeVisible();
  expect(screen.queryByTestId('athlete-radar-plot')).toBeNull();
});

it('loads the completed average on demand, refreshes it, and preserves my unsaved scores', async () => {
  const { AthleteProfilePanel } = await import('@/modules/evaluations/ui/athlete-profile-panel');
  const user = userEvent.setup();
  const loadAverage = vi.fn(async () => ({
    evaluationCount: 2,
    scores: [{ categoryId: criteria[0]!.id, value: 3.5, count: 2 }],
  }));
  render(
    <AthleteProfilePanel
      athleteName="Athlete 42"
      categories={criteria}
      scores={scores}
      completed={false}
      note=""
      loadAverage={loadAverage}
    />,
  );
  expect(loadAverage).not.toHaveBeenCalled();
  await user.click(screen.getByText('Athlete Profile', { selector: '.profile-title' }));
  await user.click(screen.getByRole('button', { name: 'Evaluator Average' }));
  expect(await screen.findByText('3.5 / 5')).toBeVisible();
  expect(screen.getByText(/2 completed evaluations/)).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Refresh average' }));
  expect(loadAverage).toHaveBeenCalledTimes(2);
  await user.click(screen.getByRole('button', { name: 'My Evaluation' }));
  expect(screen.getAllByText('4 / 5')).toHaveLength(3);
  expect(screen.queryByText('3.5 / 5')).toBeNull();
});

it('keeps scoring usable when an average request fails or a recovered draft contains an invalid score', async () => {
  const { AthleteProfilePanel } = await import('@/modules/evaluations/ui/athlete-profile-panel');
  const user = userEvent.setup();
  render(
    <AthleteProfilePanel
      athleteName="Athlete 42"
      categories={criteria}
      scores={[{ categoryId: criteria[0]!.id, value: 99 }]}
      completed={false}
      note=""
      loadAverage={async () => {
        throw new Error('Offline');
      }}
    />,
  );
  await user.click(screen.getByText('Athlete Profile', { selector: '.profile-title' }));
  expect(screen.getByText('Pending')).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Evaluator Average' }));
  expect(await screen.findByText(/Evaluator average is unavailable/)).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'My Evaluation' }));
  expect(screen.getAllByText('Not scored')).toHaveLength(4);
});

it('opens a collapsed mobile profile when crossing into desktop layout', async () => {
  const { AthleteProfilePanel } = await import('@/modules/evaluations/ui/athlete-profile-panel');
  let matches = false;
  let notify = () => {};
  vi.stubGlobal('matchMedia', () => ({
    matches,
    addEventListener: (_event: string, listener: () => void) => {
      notify = listener;
    },
    removeEventListener: () => {},
  }));
  try {
    const { container } = render(
      <AthleteProfilePanel
        athleteName="Athlete 42"
        categories={criteria}
        scores={[]}
        completed={false}
        note=""
      />,
    );
    expect(container.querySelector('details')).not.toHaveAttribute('open');
    await act(async () => {
      matches = true;
      notify();
    });
    expect(container.querySelector('details')).toHaveAttribute('open');
    await act(async () => {
      matches = false;
      notify();
    });
    expect(container.querySelector('details')).not.toHaveAttribute('open');
  } finally {
    cleanup();
    vi.unstubAllGlobals();
  }
});
