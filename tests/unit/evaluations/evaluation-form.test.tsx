import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AthletePager } from '../../../src/modules/evaluations/ui/athlete-pager';
import { EvaluationForm } from '../../../src/modules/evaluations/ui/evaluation-form';
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

afterEach(() => {
  vi.useRealTimers();
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
    expect(screen.getByRole('status')).toHaveTextContent('Unsaved changes on this page');

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
    expect(screen.getByRole('button', { name: 'Keep my local draft' })).toBeDisabled();
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
    expect(screen.getByRole('button', { name: 'Keep my local draft' })).toBeDisabled();
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
      within(screen.getByRole('article', { name: 'Server draft loaded after reload' })).getByText(
        'New server copy',
      ),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Copy local draft' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Download local draft' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Save now' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Keep my local draft' }));
    await user.click(screen.getByRole('button', { name: 'Save now' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ note: 'Local sensitive note', expectedVersion: 2 }),
    );
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
