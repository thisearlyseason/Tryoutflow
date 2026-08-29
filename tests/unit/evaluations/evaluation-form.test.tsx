import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

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
    ['error', 'Save failed'],
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
