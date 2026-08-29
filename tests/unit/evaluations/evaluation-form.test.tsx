import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AthletePager } from '../../../src/modules/evaluations/ui/athlete-pager';
import { EvaluationForm } from '../../../src/modules/evaluations/ui/evaluation-form';
import {
  createCoalescedPulseRunner,
  shouldPreferAuthoritativeServerSnapshot,
} from '../../../src/modules/evaluations/ui/synchronized-evaluation-form';
import { EvaluationSaveState } from '../../../src/modules/evaluations/ui/save-state';
import { ScoreControl } from '../../../src/modules/evaluations/ui/score-control';

const skatingId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const competeId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const athlete = {
  registrationId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  displayName: 'Athlete A1B2C3',
  identityMode: 'blind' as const,
  tryoutNumber: 42,
  divisionName: 'U13',
  sessionName: 'Morning skills',
  groupName: 'Blue',
};

const categories = [
  {
    id: skatingId,
    name: 'Skating',
    description: 'Balance and edge control',
    guidance: 'Look for control through direction changes.',
    scaleMin: 1 as const,
    scaleMax: 5 as const,
    required: true,
  },
  {
    id: competeId,
    name: 'Compete',
    description: null,
    guidance: null,
    scaleMin: 1 as const,
    scaleMax: 5 as const,
    required: true,
  },
];

it('coalesces a 10k reconciliation storm to one in-flight and one pending durable read', async () => {
  let releaseFirst!: () => void;
  const first = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  let calls = 0;
  const runner = createCoalescedPulseRunner(async () => {
    calls += 1;
    if (calls === 1) await first;
  });
  runner.signal();
  for (let pulse = 0; pulse < 10_000; pulse += 1) runner.signal();
  expect(calls).toBe(1);
  releaseFirst();
  await waitFor(() => expect(calls).toBe(2));
  runner.close();
  runner.signal();
  await Promise.resolve();
  expect(calls).toBe(2);
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  window.sessionStorage.clear();
});

describe('ScoreControl', () => {
  it('emits an integer category score from a 44px radio target', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ScoreControl
        categoryId={skatingId}
        label="Skating"
        max={5}
        min={1}
        onChange={onChange}
        value={null}
      />,
    );

    const score = screen.getByRole('radio', { name: 'Skating score 4 of 5' });
    await user.click(score);

    expect(onChange).toHaveBeenCalledWith({ categoryId: skatingId, score: 4 });
    expect(score).toHaveClass('min-h-[44px]');
    expect(screen.getByRole('radiogroup', { name: 'Skating score' })).toHaveAttribute(
      'aria-orientation',
      'horizontal',
    );
  });

  it('supports native arrow selection and direct number keys', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(
      <ScoreControl
        categoryId={skatingId}
        label="Skating"
        max={5}
        min={1}
        onChange={onChange}
        value={3}
      />,
    );
    const selected = screen.getByRole('radio', { name: 'Skating score 3 of 5' });
    selected.focus();
    await user.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenLastCalledWith({ categoryId: skatingId, score: 4 });

    rerender(
      <ScoreControl
        categoryId={skatingId}
        label="Skating"
        max={5}
        min={1}
        onChange={onChange}
        value={4}
      />,
    );
    screen.getByRole('radio', { name: 'Skating score 4 of 5' }).focus();
    await user.keyboard('2');
    expect(onChange).toHaveBeenLastCalledWith({ categoryId: skatingId, score: 2 });
    expect(screen.getByRole('radio', { name: 'Skating score 2 of 5' })).toHaveFocus();
  });

  it('announces errors and exposes a non-color selected state', () => {
    render(
      <ScoreControl
        categoryId={skatingId}
        error="Choose a Skating score."
        label="Skating"
        max={5}
        min={1}
        onChange={vi.fn()}
        value={4}
      />,
    );
    expect(screen.getByText('Choose a Skating score.')).toHaveAttribute('role', 'alert');
    expect(screen.getByRole('radio', { name: 'Skating score 4 of 5' })).toBeChecked();
    expect(screen.getByText('Selected', { selector: 'span' })).toBeInTheDocument();
  });
});

describe('EvaluationSaveState', () => {
  it.each([
    ['idle', 'Not saved yet'],
    ['editing', 'Unsaved changes on this page'],
    ['saving', 'Saving to server'],
    ['saved_device', 'Saved on device'],
    ['needs_attention', 'Sync needs attention'],
    ['saved', 'Saved on server'],
    ['conflict', 'Server draft changed'],
    ['offline', 'Offline'],
    ['unconfirmed', 'Save not confirmed'],
  ] as const)('renders a truthful %s state', (state, message) => {
    render(<EvaluationSaveState state={state} />);
    expect(screen.getByRole('status')).toHaveTextContent(message);
  });
});

describe('EvaluationForm', () => {
  it('prefers SSR only when it is exact authoritative evidence newer than a synced local snapshot', () => {
    const local = {
      evaluationId: 'aaaaaaaa-0000-4000-8000-000000000001',
      version: 2,
      state: 'draft' as const,
      scores: [{ categoryId: skatingId, value: 4 }],
      note: 'exact local receipt',
    };
    expect(
      shouldPreferAuthoritativeServerSnapshot({
        lineageState: 'synced',
        local,
        server: { ...local, version: 1 },
      }),
    ).toBe(false);
    expect(
      shouldPreferAuthoritativeServerSnapshot({
        lineageState: 'synced',
        local,
        server: { ...local, version: 2 },
      }),
    ).toBe(false);
    expect(
      shouldPreferAuthoritativeServerSnapshot({
        lineageState: 'synced',
        local,
        server: { ...local, version: 2, note: 'same version authoritative correction' },
      }),
    ).toBe(true);
    expect(
      shouldPreferAuthoritativeServerSnapshot({
        lineageState: 'synced',
        local,
        server: { ...local, version: 3 },
      }),
    ).toBe(true);
    expect(
      shouldPreferAuthoritativeServerSnapshot({
        lineageState: 'saved_device',
        local,
        server: { ...local, version: 99 },
      }),
    ).toBe(false);
  });

  it('truthfully accepts a durable device save while offline and blocks server completion', async () => {
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    const user = userEvent.setup();
    const onSave = vi.fn(async () => ({
      outcome: 'saved_device' as const,
      evaluationId: 'aaaaaaaa-0000-4000-8000-000000000001',
      version: 1,
    }));
    const onComplete = vi.fn();
    render(
      <EvaluationForm
        athlete={athlete}
        categories={categories}
        durableDeviceSave
        initialDraft={{ evaluationId: null, version: 0, state: 'draft', scores: [], note: '' }}
        onComplete={onComplete}
        onSave={onSave}
      />,
    );
    await user.click(screen.getByRole('radio', { name: 'Skating score 4 of 5' }));
    await user.click(screen.getByRole('button', { name: 'Save now' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Saved on device'));
    expect(onSave).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('radio', { name: 'Compete score 4 of 5' }));
    await user.click(screen.getByRole('button', { name: 'Complete evaluation' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('does not treat an older server receipt as confirmation for queued work', () => {
    const onComplete = vi.fn();
    render(
      <EvaluationForm
        athlete={athlete}
        categories={categories}
        durableDeviceSave
        initialDraft={{
          evaluationId: 'aaaaaaaa-0000-4000-8000-000000000001',
          version: 2,
          state: 'draft',
          scores: [
            { categoryId: skatingId, value: 4 },
            { categoryId: competeId, value: 4 },
          ],
        }}
        onComplete={onComplete}
        onSave={vi.fn()}
        serverConfirmation={{
          evaluationId: 'aaaaaaaa-0000-4000-8000-000000000001',
          version: 1,
        }}
      />,
    );
    expect(screen.getByRole('button', { name: 'Complete evaluation' })).toBeDisabled();
    expect(onComplete).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('Saved on device');
  });

  it('keeps editable controls disabled in server HTML until interaction handlers hydrate', () => {
    const html = renderToString(
      <EvaluationForm
        athlete={athlete}
        categories={categories}
        initialDraft={{ evaluationId: null, version: 0, state: 'draft', scores: [], note: '' }}
        onComplete={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    expect(html).toMatch(/<textarea[^>]*disabled=""/u);
    expect(html).toMatch(/<input[^>]*disabled=""[^>]*type="radio"/u);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Save now/u);
  });

  it('keeps blind identity prominent and never renders a hidden full name', () => {
    render(
      <EvaluationForm
        athlete={athlete}
        categories={categories}
        initialDraft={{ evaluationId: null, version: 0, state: 'draft', scores: [], note: '' }}
        onComplete={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    expect(screen.getByText('#42')).toHaveClass('font-[var(--font-bib)]');
    expect(screen.getByRole('heading', { name: 'Athlete A1B2C3' })).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('Ava Smith');
    expect(screen.getByText('Blind evaluation')).toBeInTheDocument();
  });

  it('marks an edit locally, autosaves the exact scores and preserves a note', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onSave = vi.fn(async () => ({
      outcome: 'saved' as const,
      evaluationId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      version: 1,
    }));
    render(
      <EvaluationForm
        athlete={athlete}
        categories={categories}
        initialDraft={{ evaluationId: null, version: 0, state: 'draft', scores: [], note: '' }}
        onComplete={vi.fn()}
        onSave={onSave}
      />,
    );

    await user.type(screen.getByLabelText('Private evaluator note'), 'Strong edge control');
    await user.click(screen.getByRole('radio', { name: 'Skating score 4 of 5' }));
    expect(screen.getByText('Unsaved changes on this page')).toBeVisible();

    await act(async () => vi.advanceTimersByTime(700));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith({
      scores: [{ categoryId: skatingId, value: 4 }],
      note: 'Strong edge control',
      noteTagIds: [],
      flags: [],
      expectedVersion: 0,
    });
    expect(screen.getByLabelText('Private evaluator note')).toHaveValue('Strong edge control');
    expect(await screen.findByRole('status')).toHaveTextContent('Saved on server');
    vi.useRealTimers();
  });

  it('validates required scores, focuses the first missing category, and keeps the note', async () => {
    const user = userEvent.setup();
    render(
      <EvaluationForm
        athlete={athlete}
        categories={categories}
        initialDraft={{
          evaluationId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          version: 2,
          state: 'draft',
          scores: [{ categoryId: skatingId, value: 4 }],
          note: 'Keep this note',
        }}
        onComplete={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Complete evaluation' }));
    expect(screen.getByText('Choose a Compete score.')).toHaveAttribute('role', 'alert');
    expect(screen.getByRole('radiogroup', { name: 'Compete score' })).toHaveFocus();
    expect(screen.getByLabelText('Private evaluator note')).toHaveValue('Keep this note');
  });

  it('retains local changes and does not retry with a guessed version after a conflict', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onSave = vi.fn(async () => ({ outcome: 'conflict' as const }));
    render(
      <EvaluationForm
        athlete={athlete}
        categories={categories}
        initialDraft={{ evaluationId: null, version: 0, state: 'draft', scores: [], note: '' }}
        onComplete={vi.fn()}
        onSave={onSave}
      />,
    );
    await user.type(screen.getByLabelText('Private evaluator note'), 'Do not lose this');
    await act(async () => vi.advanceTimersByTime(700));
    expect(await screen.findByRole('status')).toHaveTextContent('Server draft changed');
    expect(screen.getByLabelText('Private evaluator note')).toHaveValue('Do not lose this');
    expect(
      screen.queryByRole('button', { name: 'Reload and compare safely' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('exists on this page only');
    expect(screen.queryByRole('button', { name: 'Keep my local draft' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Use server draft' })).toBeDisabled();
    await act(async () => vi.advanceTimersByTime(5_000));
    expect(onSave).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('restores an in-page navigation draft as unsaved and lets the evaluator save it', async () => {
    const user = userEvent.setup();
    const first = render(
      <EvaluationForm
        athlete={athlete}
        categories={categories}
        draftCacheKey="navigation-draft"
        serverSnapshotToken="navigation-render-one"
        initialDraft={{ evaluationId: null, version: 0, state: 'draft', scores: [], note: '' }}
        onComplete={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    await user.type(screen.getByLabelText('Private evaluator note'), 'Preserve between athletes');
    first.unmount();

    const onSave = vi.fn(async () => ({
      outcome: 'saved' as const,
      evaluationId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      version: 1,
    }));
    render(
      <EvaluationForm
        athlete={athlete}
        categories={categories}
        draftCacheKey="navigation-draft"
        serverSnapshotToken="navigation-render-two"
        initialDraft={{ evaluationId: null, version: 0, state: 'draft', scores: [], note: '' }}
        onComplete={vi.fn()}
        onSave={onSave}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Unsaved changes on this page');
    expect(screen.getByLabelText('Private evaluator note')).toHaveValue(
      'Preserve between athletes',
    );
    await user.click(screen.getByRole('button', { name: 'Save now' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ note: 'Preserve between athletes', expectedVersion: 0 }),
    );
  });

  it('queues an edit made during a save behind the confirmed CAS version', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    let resolveFirst:
      ((value: { outcome: 'saved'; evaluationId: string; version: number }) => void) | undefined;
    const firstSave = new Promise<{
      outcome: 'saved';
      evaluationId: string;
      version: number;
    }>((resolve) => {
      resolveFirst = resolve;
    });
    const onSave = vi
      .fn()
      .mockImplementationOnce(() => firstSave)
      .mockResolvedValueOnce({
        outcome: 'saved' as const,
        evaluationId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        version: 2,
      });
    render(
      <EvaluationForm
        athlete={athlete}
        categories={categories}
        initialDraft={{ evaluationId: null, version: 0, state: 'draft', scores: [], note: '' }}
        onComplete={vi.fn()}
        onSave={onSave}
      />,
    );
    const note = screen.getByLabelText('Private evaluator note');
    await user.type(note, 'First');
    await act(async () => vi.advanceTimersByTime(700));
    expect(onSave).toHaveBeenCalledTimes(1);
    await user.type(note, ' second');
    await act(async () => vi.advanceTimersByTime(700));
    expect(onSave).toHaveBeenCalledTimes(1);
    await act(async () =>
      resolveFirst?.({
        outcome: 'saved',
        evaluationId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        version: 1,
      }),
    );
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
    expect(onSave).toHaveBeenLastCalledWith(
      expect.objectContaining({ note: 'First second', expectedVersion: 1 }),
    );
    vi.useRealTimers();
  });

  it('drains the active save and newest queued revision before one double-click-safe completion', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const first = deferred<{
      outcome: 'saved';
      evaluationId: string;
      version: number;
    }>();
    const second = deferred<{
      outcome: 'saved';
      evaluationId: string;
      version: number;
    }>();
    const completion = deferred<{ outcome: 'completed'; version: number }>();
    const onSave = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const onComplete = vi.fn(() => completion.promise);
    render(
      <EvaluationForm
        athlete={athlete}
        categories={categories}
        draftCacheKey="queue-drain"
        serverSnapshotToken="queue-drain-render"
        initialDraft={{
          evaluationId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          version: 1,
          state: 'draft',
          scores: [
            { categoryId: skatingId, value: 4 },
            { categoryId: competeId, value: 4 },
          ],
          note: '',
        }}
        onComplete={onComplete}
        onSave={onSave}
      />,
    );

    const note = screen.getByLabelText('Private evaluator note');
    await user.type(note, 'First');
    await act(async () => vi.advanceTimersByTime(700));
    expect(onSave).toHaveBeenCalledTimes(1);

    await user.type(note, ' queued');
    const completeButton = screen.getByRole('button', { name: 'Complete evaluation' });
    expect(completeButton).toBeEnabled();
    await user.dblClick(completeButton);
    expect(completeButton).toBeDisabled();
    expect(onComplete).not.toHaveBeenCalled();

    await act(async () =>
      first.resolve({
        outcome: 'saved',
        evaluationId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        version: 2,
      }),
    );
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
    expect(onSave).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ note: 'First queued', expectedVersion: 2 }),
    );
    expect(onComplete).not.toHaveBeenCalled();

    await act(async () =>
      second.resolve({
        outcome: 'saved',
        evaluationId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        version: 3,
      }),
    );
    await waitFor(() =>
      expect(onComplete).toHaveBeenCalledWith({
        evaluationId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        expectedVersion: 3,
      }),
    );
    expect(onComplete).toHaveBeenCalledTimes(1);
    await act(async () => completion.resolve({ outcome: 'completed', version: 4 }));
    expect(await screen.findByRole('button', { name: 'Evaluation completed' })).toBeDisabled();
  });

  it('does not complete when the server locks an active save', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const save = deferred<{ outcome: 'locked' }>();
    const onComplete = vi.fn();
    const first = render(
      <EvaluationForm
        athlete={athlete}
        categories={categories}
        draftCacheKey="server-lock"
        serverSnapshotToken="server-lock-before"
        initialDraft={{
          evaluationId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          version: 1,
          state: 'draft',
          scores: [
            { categoryId: skatingId, value: 4 },
            { categoryId: competeId, value: 4 },
          ],
          note: '',
        }}
        onComplete={onComplete}
        onSave={() => save.promise}
      />,
    );
    await user.type(screen.getByLabelText('Private evaluator note'), 'Changed');
    await act(async () => vi.advanceTimersByTime(700));
    await user.click(screen.getByRole('button', { name: 'Complete evaluation' }));
    await act(async () => save.resolve({ outcome: 'locked' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Evaluation locked');
    expect(onComplete).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Private evaluator note')).toBeDisabled();
    first.unmount();

    render(
      <EvaluationForm
        athlete={athlete}
        categories={categories}
        draftCacheKey="server-lock"
        serverSnapshotToken="server-lock-after"
        initialDraft={{
          evaluationId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          version: 2,
          state: 'locked',
          scores: [
            { categoryId: skatingId, value: 4 },
            { categoryId: competeId, value: 4 },
          ],
          note: 'Server copy',
        }}
        onComplete={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    expect(
      await screen.findByRole('heading', { name: 'Review local and server drafts' }),
    ).toBeVisible();
    expect(screen.getByRole('article', { name: 'Local draft' })).toHaveTextContent('Changed');
    expect(screen.queryByRole('button', { name: 'Keep my local draft' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Use server draft' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Copy local draft' })).toBeVisible();
  });

  it('keeps a queued later edit dirty until that exact revision is confirmed', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const first = deferred<{
      outcome: 'saved';
      evaluationId: string;
      version: number;
    }>();
    const second = deferred<{
      outcome: 'saved';
      evaluationId: string;
      version: number;
    }>();
    const onSave = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    render(
      <EvaluationForm
        athlete={athlete}
        categories={categories}
        draftCacheKey="later-edit"
        serverSnapshotToken="later-edit-render"
        initialDraft={{ evaluationId: null, version: 0, state: 'draft', scores: [] }}
        onComplete={vi.fn()}
        onSave={onSave}
      />,
    );
    const note = screen.getByLabelText('Private evaluator note');
    await user.type(note, 'One');
    await act(async () => vi.advanceTimersByTime(700));
    await user.type(note, ' two');
    await act(async () =>
      first.resolve({
        outcome: 'saved',
        evaluationId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        version: 1,
      }),
    );
    expect(await screen.findByRole('status')).not.toHaveTextContent('Saved on server');
    expect(window.sessionStorage.length).toBe(1);
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
    await act(async () =>
      second.resolve({
        outcome: 'saved',
        evaluationId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        version: 2,
      }),
    );
    expect(await screen.findByRole('status')).toHaveTextContent('Saved on server');
    expect(window.sessionStorage.length).toBe(0);
  });

  it('clears a confirmed draft so returning does not issue a redundant CAS save', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const firstSave = vi.fn(async () => ({
      outcome: 'saved' as const,
      evaluationId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      version: 1,
    }));
    const first = render(
      <EvaluationForm
        athlete={athlete}
        categories={categories}
        draftCacheKey="confirmed-return"
        serverSnapshotToken="confirmed-return-one"
        initialDraft={{ evaluationId: null, version: 0, state: 'draft', scores: [] }}
        onComplete={vi.fn()}
        onSave={firstSave}
      />,
    );
    await user.type(screen.getByLabelText('Private evaluator note'), 'Confirmed');
    await act(async () => vi.advanceTimersByTime(700));
    expect(await screen.findByRole('status')).toHaveTextContent('Saved on server');
    first.unmount();

    const returnSave = vi.fn();
    render(
      <EvaluationForm
        athlete={athlete}
        categories={categories}
        draftCacheKey="confirmed-return"
        serverSnapshotToken="confirmed-return-two"
        initialDraft={{
          evaluationId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          version: 1,
          state: 'draft',
          scores: [],
          note: 'Confirmed',
        }}
        onComplete={vi.fn()}
        onSave={returnSave}
      />,
    );
    await act(async () => vi.advanceTimersByTime(2_000));
    expect(screen.getByRole('status')).toHaveTextContent('Saved on server');
    expect(returnSave).not.toHaveBeenCalled();
  });

  it('retains a conflict draft across reload and requires explicit reconciliation before overwrite', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const first = render(
      <EvaluationForm
        athlete={athlete}
        categories={categories}
        draftCacheKey="conflict-reload"
        serverSnapshotToken="snapshot-before-conflict"
        initialDraft={{
          evaluationId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          version: 1,
          state: 'draft',
          scores: [],
          note: 'Old server copy',
        }}
        onComplete={vi.fn()}
        onSave={async () => ({ outcome: 'conflict' })}
      />,
    );
    const note = screen.getByLabelText('Private evaluator note');
    await user.clear(note);
    await user.type(note, 'Local sensitive note');
    await act(async () => vi.advanceTimersByTime(700));
    expect(await screen.findByRole('status')).toHaveTextContent('Server draft changed');
    first.unmount();

    const onSave = vi.fn(async () => ({
      outcome: 'saved' as const,
      evaluationId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      version: 3,
    }));
    render(
      <EvaluationForm
        athlete={athlete}
        categories={categories}
        draftCacheKey="conflict-reload"
        serverSnapshotToken="snapshot-before-conflict"
        initialDraft={{
          evaluationId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          version: 2,
          state: 'draft',
          scores: [],
          note: 'New server copy',
        }}
        onComplete={vi.fn()}
        onSave={onSave}
      />,
    );
    expect(
      await screen.findByRole('heading', { name: 'Review local and server drafts' }),
    ).toBeVisible();
    expect(
      within(screen.getByRole('article', { name: 'Local draft' })).getByText(
        'Local sensitive note',
      ),
    ).toBeVisible();
    expect(
      within(screen.getByRole('article', { name: 'Server draft from page load' })).getByText(
        'New server copy',
      ),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Copy local draft' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Download local draft' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Save now' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Keep my local draft' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Use server draft' })).toBeDisabled();

    cleanup();
    render(
      <EvaluationForm
        athlete={athlete}
        categories={categories}
        draftCacheKey="conflict-reload"
        serverSnapshotToken="snapshot-after-reload"
        initialDraft={{
          evaluationId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          version: 2,
          state: 'draft',
          scores: [],
          note: 'New server copy',
        }}
        onComplete={vi.fn()}
        onSave={onSave}
      />,
    );
    expect(
      await screen.findByRole('article', { name: 'Server draft loaded after reload' }),
    ).toHaveTextContent('New server copy');

    await user.click(screen.getByRole('button', { name: 'Use server draft' }));
    await user.click(screen.getByRole('button', { name: 'Confirm use server draft' }));
    const restoredNote = screen.getByLabelText('Private evaluator note');
    await user.clear(restoredNote);
    await user.type(restoredNote, 'Local sensitive note');
    await user.click(screen.getByRole('button', { name: 'Save now' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ note: 'Local sensitive note', expectedVersion: 2 }),
    );
  });

  it.each(['conflict', 'unexpected'] as const)(
    'preserves the newest queued edit when a deferred %s response arrives',
    async (outcome) => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const pending = deferred<{ outcome: typeof outcome }>();
      const onSave = vi.fn(() => pending.promise);
      const clipboard = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
      const createObjectUrl = vi
        .spyOn(URL, 'createObjectURL')
        .mockReturnValue('blob:queued-recovery');
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

      render(
        <EvaluationForm
          athlete={athlete}
          categories={categories}
          draftCacheKey={`queued-${outcome}`}
          serverSnapshotToken={`snapshot-${outcome}`}
          initialDraft={{ evaluationId: null, version: 0, state: 'draft', scores: [] }}
          onComplete={vi.fn()}
          onSave={onSave}
        />,
      );
      const note = screen.getByLabelText('Private evaluator note');
      await user.type(note, 'Sent request');
      await act(async () => vi.advanceTimersByTime(700));
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ note: 'Sent request' }));

      await user.type(note, ' plus queued edit');
      await act(async () => pending.resolve({ outcome }));

      expect(
        within(await screen.findByRole('article', { name: 'Local draft' })).getByText(
          'Sent request plus queued edit',
        ),
      ).toBeVisible();
      const stored = JSON.parse(
        window.sessionStorage.getItem(`tryoutflow:evaluation-draft:v1:queued-${outcome}`) ?? '{}',
      ) as { draft?: { note?: string }; lastRequest?: { note?: string } };
      expect(stored.draft?.note).toBe('Sent request plus queued edit');
      expect(stored.lastRequest?.note).toBe('Sent request');

      await user.click(screen.getByRole('button', { name: 'Copy local draft' }));
      expect(JSON.parse(clipboard.mock.calls.at(-1)?.[0] ?? '{}')).toMatchObject({
        note: 'Sent request plus queued edit',
        request: { note: 'Sent request', expectedVersion: 0 },
      });
      await user.click(screen.getByRole('button', { name: 'Download local draft' }));
      const exported = createObjectUrl.mock.calls.at(-1)?.[0];
      expect(exported).toBeInstanceOf(Blob);
      expect(JSON.parse(await (exported as Blob).text())).toMatchObject({
        note: 'Sent request plus queued edit',
        request: { note: 'Sent request', expectedVersion: 0 },
      });
      vi.useRealTimers();
    },
  );

  it('keeps the newest queued edit visible and exportable when sessionStorage is unavailable', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const pending = deferred<{ outcome: 'unexpected' }>();
    const onSave = vi.fn(() => pending.promise);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('storage denied', 'SecurityError');
    });
    const clipboard = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    const createObjectUrl = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:no-storage-recovery');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    render(
      <EvaluationForm
        athlete={athlete}
        categories={categories}
        draftCacheKey="unavailable-storage"
        serverSnapshotToken="storage-failure-snapshot"
        initialDraft={{ evaluationId: null, version: 0, state: 'draft', scores: [] }}
        onComplete={vi.fn()}
        onSave={onSave}
      />,
    );
    const note = screen.getByLabelText('Private evaluator note');
    await user.type(note, 'Request snapshot');
    await act(async () => vi.advanceTimersByTime(700));
    await user.type(note, ' newest edit');
    await act(async () => pending.resolve({ outcome: 'unexpected' }));

    expect(await screen.findByRole('article', { name: 'Local draft' })).toHaveTextContent(
      'Request snapshot newest edit',
    );
    expect(
      screen.queryByRole('button', { name: 'Reload and compare safely' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('exists on this page only');
    await user.click(screen.getByRole('button', { name: 'Copy local draft' }));
    expect(JSON.parse(clipboard.mock.calls.at(-1)?.[0] ?? '{}')).toMatchObject({
      note: 'Request snapshot newest edit',
      request: { note: 'Request snapshot' },
    });
    await user.click(screen.getByRole('button', { name: 'Download local draft' }));
    const exported = createObjectUrl.mock.calls.at(-1)?.[0];
    expect(JSON.parse(await (exported as Blob).text())).toMatchObject({
      note: 'Request snapshot newest edit',
      request: { note: 'Request snapshot' },
    });
    vi.useRealTimers();
  });

  it('removes automatic keep-local recovery and requires reconfirmation after a local edit', async () => {
    const user = userEvent.setup();
    const resolved = deferred<{
      outcome: 'resolved';
      evaluationId: string;
      version: number;
    }>();
    const evaluationId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    window.sessionStorage.setItem(
      'tryoutflow:evaluation-draft:v1:resolve-exact-local',
      JSON.stringify({
        draft: {
          scores: [{ categoryId: skatingId, value: 4 }],
          note: 'exact newest recovery edit 🚀',
          noteTagIds: [],
          flags: [],
        },
        baseVersion: 1,
        evaluationId,
        revision: 2,
        recovery: 'conflict',
        serverSnapshotToken: 'older-server-snapshot',
      }),
    );
    const onResolveRecovery = vi.fn(() => resolved.promise);
    render(
      <EvaluationForm
        athlete={athlete}
        categories={categories}
        draftCacheKey="resolve-exact-local"
        serverSnapshotToken="fresh-server-snapshot"
        initialDraft={{ evaluationId, version: 2, state: 'draft', scores: [] }}
        onComplete={vi.fn()}
        onResolveRecovery={onResolveRecovery}
        onSave={vi.fn()}
      />,
    );
    const note = await screen.findByLabelText('Private evaluator note');
    expect(screen.queryByRole('button', { name: /keep my local draft/i })).not.toBeInTheDocument();
    expect(screen.getByText(/automatic keep-local recovery is deferred/i)).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Use server draft' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent(/permanently replaces/i);
    await user.type(note, ' changed after opening');
    await user.click(screen.getByRole('button', { name: 'Confirm use server draft' }));
    expect(onResolveRecovery).not.toHaveBeenCalled();
    expect(screen.getByText(/changed after confirmation opened/i)).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Use server draft' }));
    await user.click(screen.getByRole('button', { name: 'Confirm use server draft' }));
    expect(note).toBeDisabled();
    expect(onResolveRecovery).toHaveBeenCalledWith({
      action: 'use_server',
      local: expect.objectContaining({
        note: 'exact newest recovery edit 🚀 changed after opening',
      }),
    });
    await act(async () => resolved.resolve({ outcome: 'resolved', evaluationId, version: 2 }));
    expect(screen.getByText(/server draft restored/i)).toBeVisible();
  });

  it('shows a newer durable sibling draft and requires a new two-step server confirmation', async () => {
    const user = userEvent.setup();
    const evaluationId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    window.sessionStorage.setItem(
      'tryoutflow:evaluation-draft:v1:stale-use-server-dialog',
      JSON.stringify({
        draft: { scores: [], note: 'older dialog draft', noteTagIds: [], flags: [] },
        baseVersion: 1,
        evaluationId,
        revision: 1,
        recovery: 'conflict',
        serverSnapshotToken: 'older-snapshot',
      }),
    );
    const onResolveRecovery = vi.fn().mockResolvedValue({
      outcome: 'stale_local_draft' as const,
      local: {
        scores: [{ categoryId: skatingId, value: 5 }],
        note: 'newer durable sibling draft',
        noteTagIds: [],
        flags: [],
      },
    });
    render(
      <EvaluationForm
        athlete={athlete}
        categories={categories}
        draftCacheKey="stale-use-server-dialog"
        serverSnapshotToken="fresh-snapshot"
        initialDraft={{ evaluationId, version: 2, state: 'draft', scores: [] }}
        onComplete={vi.fn()}
        onResolveRecovery={onResolveRecovery}
        onSave={vi.fn()}
      />,
    );
    await user.click(await screen.findByRole('button', { name: 'Use server draft' }));
    await user.click(screen.getByRole('button', { name: 'Confirm use server draft' }));
    expect(await screen.findByLabelText('Private evaluator note')).toHaveValue(
      'newer durable sibling draft',
    );
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByText(/newer local draft was saved in another tab/i)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Use server draft' }));
    expect(screen.getByRole('alertdialog')).toBeVisible();
    expect(onResolveRecovery).toHaveBeenCalledTimes(1);
  });

  it('accepts only a receipt-bound sibling-tab resolution as the confirmed winner', async () => {
    const evaluationId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    window.sessionStorage.setItem(
      'tryoutflow:evaluation-draft:v1:sibling-resolution',
      JSON.stringify({
        draft: { scores: [], note: 'older tab-local conflict', noteTagIds: [], flags: [] },
        baseVersion: 1,
        evaluationId,
        revision: 1,
        recovery: 'conflict',
        serverSnapshotToken: 'older-snapshot',
      }),
    );
    const shared = {
      athlete,
      categories,
      draftCacheKey: 'sibling-resolution',
      serverSnapshotToken: 'fresh-snapshot',
      initialDraft: { evaluationId, version: 2, state: 'draft' as const, scores: [] },
      onComplete: vi.fn(),
      onSave: vi.fn(),
    };
    const view = render(<EvaluationForm {...shared} />);
    expect(
      await screen.findByRole('heading', { name: 'Review local and server drafts' }),
    ).toBeVisible();
    view.rerender(
      <EvaluationForm
        {...shared}
        backgroundSaveResult={{
          token: 1,
          outcome: 'resolved_elsewhere',
          draft: {
            scores: [{ categoryId: skatingId, value: 5 }],
            note: 'newest durable sibling winner',
            noteTagIds: [],
            flags: [],
          },
          evaluationId,
          version: 3,
          resolutionIdentity: 'resolution-sibling-winner',
          resultDigest: 'a'.repeat(64),
        }}
        serverConfirmation={{ evaluationId, version: 3 }}
      />,
    );
    await waitFor(() =>
      expect(
        screen.queryByRole('heading', { name: 'Review local and server drafts' }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByLabelText('Private evaluator note')).toHaveValue(
      'newest durable sibling winner',
    );
    expect(screen.getByText('Saved on server')).toBeVisible();
    expect(
      window.sessionStorage.getItem('tryoutflow:evaluation-draft:v1:sibling-resolution'),
    ).toBeNull();
  });

  it('does not overwrite an edit made after recovery opened when a sibling resolution arrives', async () => {
    const user = userEvent.setup();
    const evaluationId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    window.sessionStorage.setItem(
      'tryoutflow:evaluation-draft:v1:sibling-resolution-new-edit',
      JSON.stringify({
        draft: { scores: [], note: 'conflicted local', noteTagIds: [], flags: [] },
        baseVersion: 1,
        evaluationId,
        revision: 1,
        recovery: 'conflict',
        serverSnapshotToken: 'older-snapshot',
      }),
    );
    const shared = {
      athlete,
      categories,
      draftCacheKey: 'sibling-resolution-new-edit',
      serverSnapshotToken: 'fresh-snapshot',
      initialDraft: { evaluationId, version: 2, state: 'draft' as const, scores: [] },
      onComplete: vi.fn(),
      onSave: vi.fn(),
    };
    const view = render(<EvaluationForm {...shared} />);
    const note = await screen.findByLabelText('Private evaluator note');
    await user.type(note, ' newest edit while sibling resolves');
    view.rerender(
      <EvaluationForm
        {...shared}
        backgroundSaveResult={{
          token: 2,
          outcome: 'resolved_elsewhere',
          draft: { scores: [], note: 'sibling winner', noteTagIds: [], flags: [] },
          evaluationId,
          version: 3,
          resolutionIdentity: 'resolution-sibling-winner',
          resultDigest: 'a'.repeat(64),
        }}
        serverConfirmation={{ evaluationId, version: 3 }}
      />,
    );
    await waitFor(() =>
      expect(
        screen.queryByRole('heading', { name: 'Review local and server drafts' }),
      ).not.toBeInTheDocument(),
    );
    expect(note).toHaveValue('conflicted local newest edit while sibling resolves');
    expect(screen.getByText('Unsaved changes on this page')).toBeVisible();
    expect(
      window.sessionStorage.getItem('tryoutflow:evaluation-draft:v1:sibling-resolution-new-edit'),
    ).toContain('newest edit while sibling resolves');
  });

  it('preserves a newer local edit across one hundred repeated sibling-resolution polls and reload', async () => {
    const user = userEvent.setup();
    const evaluationId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    const cacheKey = 'sibling-resolution-repeated-new-edit';
    window.sessionStorage.setItem(
      `tryoutflow:evaluation-draft:v1:${cacheKey}`,
      JSON.stringify({
        draft: { scores: [], note: 'conflicted local', noteTagIds: [], flags: [] },
        baseVersion: 1,
        evaluationId,
        revision: 1,
        recovery: 'conflict',
        serverSnapshotToken: 'older-snapshot',
      }),
    );
    const shared = {
      athlete,
      categories,
      draftCacheKey: cacheKey,
      serverSnapshotToken: 'fresh-snapshot',
      initialDraft: { evaluationId, version: 2, state: 'draft' as const, scores: [] },
      onComplete: vi.fn(),
      onSave: vi.fn(async () => ({
        outcome: 'saved_device' as const,
        evaluationId,
        version: 4,
        confirmationToken: 'newer-local-receipt',
      })),
    };
    const view = render(<EvaluationForm {...shared} />);
    const note = await screen.findByLabelText('Private evaluator note');
    await user.type(note, ' newest edit while sibling resolves');

    for (let pulse = 1; pulse <= 100; pulse += 1) {
      view.rerender(
        <EvaluationForm
          {...shared}
          backgroundSaveResult={{
            token: pulse,
            outcome: 'resolved_elsewhere',
            draft: {
              scores: [],
              note: pulse % 2 === 0 ? 'changed sibling winner' : 'sibling winner',
              noteTagIds: [],
              flags: [],
            },
            evaluationId,
            version: pulse % 2 === 0 ? 4 : 3,
            resolutionIdentity:
              pulse % 2 === 0 ? 'resolution-changed-winner' : 'resolution-sibling-winner',
            resultDigest: (pulse % 2 === 0 ? 'b' : 'a').repeat(64),
          }}
          serverConfirmation={{ evaluationId, version: 4 }}
        />,
      );
      await waitFor(() =>
        expect(screen.getByLabelText('Private evaluator note')).toHaveValue(
          'conflicted local newest edit while sibling resolves',
        ),
      );
    }
    expect(screen.getByText('Unsaved changes on this page')).toBeVisible();
    expect(window.sessionStorage.getItem(`tryoutflow:evaluation-draft:v1:${cacheKey}`)).toContain(
      'newest edit while sibling resolves',
    );

    view.unmount();
    const reloaded = render(
      <EvaluationForm
        {...shared}
        backgroundSaveResult={{
          token: 101,
          outcome: 'resolved_elsewhere',
          draft: { scores: [], note: 'changed sibling winner', noteTagIds: [], flags: [] },
          evaluationId,
          version: 4,
          resolutionIdentity: 'resolution-changed-winner',
          resultDigest: 'b'.repeat(64),
        }}
        serverConfirmation={{ evaluationId, version: 4 }}
      />,
    );
    expect(await screen.findByLabelText('Private evaluator note')).toHaveValue(
      'conflicted local newest edit while sibling resolves',
    );
    expect(window.sessionStorage.getItem(`tryoutflow:evaluation-draft:v1:${cacheKey}`)).toContain(
      'newest edit while sibling resolves',
    );
    await waitFor(
      () =>
        expect(shared.onSave).toHaveBeenCalledWith(
          expect.objectContaining({ note: 'conflicted local newest edit while sibling resolves' }),
        ),
      { timeout: 2_000 },
    );
    await waitFor(() => expect(screen.getByText('Saved on device')).toBeVisible());
    expect(window.sessionStorage.getItem(`tryoutflow:evaluation-draft:v1:${cacheKey}`)).toContain(
      'newer-local-receipt',
    );
    reloaded.rerender(
      <EvaluationForm
        {...shared}
        serverConfirmation={{
          evaluationId,
          version: 4,
          confirmationToken: 'newer-local-receipt',
        }}
      />,
    );
    await waitFor(() => expect(screen.getByText('Saved on server')).toBeVisible());
    expect(window.sessionStorage.getItem(`tryoutflow:evaluation-draft:v1:${cacheKey}`)).toBeNull();
  });

  it('does not trust a changed snapshot token when the server version went backwards', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const first = render(
      <EvaluationForm
        athlete={athlete}
        categories={categories}
        draftCacheKey="stale-server-snapshot"
        serverSnapshotToken="snapshot-v2"
        initialDraft={{
          evaluationId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          version: 2,
          state: 'draft',
          scores: [],
        }}
        onComplete={vi.fn()}
        onSave={async () => ({ outcome: 'unexpected' })}
      />,
    );
    await user.type(screen.getByLabelText('Private evaluator note'), 'Keep newest');
    await act(async () => vi.advanceTimersByTime(700));
    first.unmount();

    render(
      <EvaluationForm
        athlete={athlete}
        categories={categories}
        draftCacheKey="stale-server-snapshot"
        serverSnapshotToken="snapshot-v1-new-render"
        initialDraft={{
          evaluationId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          version: 1,
          state: 'draft',
          scores: [],
        }}
        onComplete={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Keep my local draft' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Use server draft' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Copy local draft' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Download local draft' })).toBeEnabled();
    vi.useRealTimers();
  });

  it('migrates a tokenless browser-session recovery without losing or prematurely trusting it', async () => {
    window.sessionStorage.setItem(
      'tryoutflow:evaluation-draft:v1:legacy-tokenless-recovery',
      JSON.stringify({
        draft: {
          scores: [],
          note: 'Legacy local draft',
          noteTagIds: [],
          flags: [],
        },
        baseVersion: 1,
        evaluationId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        revision: 1,
        recovery: 'conflict',
        lastRequest: {
          scores: [],
          note: 'Legacy local draft',
          noteTagIds: [],
          flags: [],
          expectedVersion: 1,
          revision: 1,
        },
      }),
    );
    const first = render(
      <EvaluationForm
        athlete={athlete}
        categories={categories}
        draftCacheKey="legacy-tokenless-recovery"
        serverSnapshotToken="legacy-baseline-render"
        initialDraft={{
          evaluationId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          version: 2,
          state: 'draft',
          scores: [],
          note: 'Server draft',
        }}
        onComplete={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    expect(await screen.findByRole('article', { name: 'Local draft' })).toHaveTextContent(
      'Legacy local draft',
    );
    expect(screen.getByRole('button', { name: 'Use server draft' })).toBeDisabled();
    expect(
      JSON.parse(
        window.sessionStorage.getItem('tryoutflow:evaluation-draft:v1:legacy-tokenless-recovery') ??
          '{}',
      ),
    ).toMatchObject({
      draft: { note: 'Legacy local draft' },
      serverSnapshotToken: 'legacy-baseline-render',
    });
    first.unmount();

    render(
      <EvaluationForm
        athlete={athlete}
        categories={categories}
        draftCacheKey="legacy-tokenless-recovery"
        serverSnapshotToken="legacy-fresh-render"
        initialDraft={{
          evaluationId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          version: 2,
          state: 'draft',
          scores: [],
          note: 'Server draft',
        }}
        onComplete={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    expect(await screen.findByRole('button', { name: 'Use server draft' })).toBeEnabled();
  });

  it.each([
    ['forbidden', 'Access removed', true],
    ['invalid_input', 'Draft validation failed', false],
    ['invalid_context', 'Evaluation context changed', true],
    ['invalid_score', 'Score not accepted', false],
    ['invalid_note_tag', 'Tag no longer available', false],
    ['locked', 'Evaluation locked', true],
    ['unexpected', 'Save not confirmed', false],
  ] as const)(
    'maps save outcome %s to truthful recovery and editability',
    async (outcome, message, disabled) => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(
        <EvaluationForm
          athlete={athlete}
          categories={categories}
          draftCacheKey={`outcome-${outcome}`}
          serverSnapshotToken={`outcome-${outcome}-render`}
          initialDraft={{ evaluationId: null, version: 0, state: 'draft', scores: [] }}
          onComplete={vi.fn()}
          onSave={async () => ({ outcome })}
        />,
      );
      await user.type(screen.getByLabelText('Private evaluator note'), 'Retained');
      await act(async () => vi.advanceTimersByTime(700));
      expect(await screen.findByRole('status')).toHaveTextContent(message);
      expect(screen.getByLabelText('Private evaluator note')).toHaveValue('Retained');
      expect(screen.getByLabelText('Private evaluator note')).toHaveProperty('disabled', disabled);
      expect(window.sessionStorage.length).toBe(1);
    },
  );

  it.each([
    ['forbidden', 'Access removed', true, false],
    ['required_scores_missing', 'Required scores missing', false, false],
    ['locked', 'Evaluation locked', true, false],
    ['conflict', 'Server draft changed', false, true],
    ['unexpected', 'Save not confirmed', false, true],
  ] as const)(
    'maps completion outcome %s without claiming success',
    async (outcome, message, disabled, reviews) => {
      const user = userEvent.setup();
      const onComplete = vi.fn(async () => ({ outcome }));
      render(
        <EvaluationForm
          athlete={athlete}
          categories={categories}
          draftCacheKey={`completion-${outcome}`}
          serverSnapshotToken={`completion-${outcome}-render`}
          initialDraft={{
            evaluationId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
            version: 2,
            state: 'draft',
            scores: [
              { categoryId: skatingId, value: 4 },
              { categoryId: competeId, value: 4 },
            ],
            note: 'Confirmed draft',
          }}
          onComplete={onComplete}
          onSave={vi.fn()}
        />,
      );
      await user.click(screen.getByRole('button', { name: 'Complete evaluation' }));
      expect(await screen.findByRole('status')).toHaveTextContent(message);
      expect(onComplete).toHaveBeenCalledWith({
        evaluationId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        expectedVersion: 2,
      });
      expect(screen.getByLabelText('Private evaluator note')).toHaveProperty('disabled', disabled);
      if (reviews) {
        expect(
          screen.getByRole('heading', { name: 'Review local and server drafts' }),
        ).toBeVisible();
        expect(window.sessionStorage.length).toBe(1);
      }
    },
  );

  it('renders configured tags and evaluator-owned flags as touch-sized controls', async () => {
    const user = userEvent.setup();
    render(
      <EvaluationForm
        athlete={athlete}
        categories={categories}
        initialDraft={{ evaluationId: null, version: 0, state: 'draft', scores: [], note: '' }}
        noteTags={[{ id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', label: 'Quick feet' }]}
        onComplete={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    const tag = screen.getByRole('checkbox', { name: 'Quick feet' });
    const flag = screen.getByRole('checkbox', { name: 'Needs another look' });
    await user.click(tag);
    await user.click(flag);
    expect(tag).toBeChecked();
    expect(flag).toBeChecked();
    expect(tag).toHaveClass('min-h-[44px]');
    expect(flag).toHaveClass('min-h-[44px]');
  });

  it('disables editing for a completed evaluation', () => {
    render(
      <EvaluationForm
        athlete={athlete}
        categories={categories}
        initialDraft={{ evaluationId: 'evaluation-1', version: 3, state: 'completed', scores: [] }}
        onComplete={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    expect(screen.getByRole('radio', { name: 'Skating score 1 of 5' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Evaluation completed' })).toBeDisabled();
  });
});

describe('AthletePager', () => {
  it('provides immediate previous/next links without a modal interruption', () => {
    render(
      <AthletePager
        currentIndex={1}
        nextHref="/athletes/next"
        previousHref="/athletes/previous"
        total={3}
      />,
    );
    expect(screen.getByRole('link', { name: 'Previous athlete' })).toHaveAttribute(
      'href',
      '/athletes/previous',
    );
    expect(screen.getByRole('link', { name: 'Next athlete' })).toHaveAttribute(
      'href',
      '/athletes/next',
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(
      within(screen.getByRole('navigation', { name: 'Athlete navigation' })).getByText('2 of 3'),
    ).toBeInTheDocument();
  });
});
