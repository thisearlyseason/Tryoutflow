import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import {
  DivisionEditor,
  SessionEditor,
  RubricEditor,
} from '@/modules/tryouts/ui/setup-configuration-editor';

const divisions = [{ id: 'division-1', name: 'U15' }];
const sessions = [
  {
    id: 'session-1',
    name: 'Skills',
    division_id: 'division-1',
    starts_at: '2026-09-15T00:00:00Z',
    ends_at: '2026-09-15T02:00:00Z',
    location: 'Arena',
    capacity: 40,
    groups: [{ id: 'group-1', name: 'Blue' }],
    rubric: {
      id: 'rubric-1',
      name: 'Skills scoring',
      versionId: 'version-1',
      categories: [
        { name: 'Skating', weight: 60, scaleMin: 1 as const, scaleMax: 5 as const },
        { name: 'Passing', weight: 40, scaleMin: 1 as const, scaleMax: 10 as const },
      ],
    },
  },
];
describe('saved setup editors', () => {
  it('selects an existing division and sends its identity when renamed', () => {
    const { container } = render(
      <form>
        <DivisionEditor divisions={divisions} />
      </form>,
    );
    expect(screen.getByLabelText('Division name')).toHaveValue('U15');
    fireEvent.change(screen.getByLabelText('Division name'), { target: { value: 'U16' } });
    const data = new FormData(container.querySelector('form')!);
    expect(data.get('divisionId')).toBe('division-1');
    expect(data.get('name')).toBe('U16');
    fireEvent.change(screen.getByLabelText('Division to edit'), { target: { value: '' } });
    expect(screen.getByLabelText('Division name')).toHaveValue('');
  });
  it('loads saved session details in its timezone and preserves linked IDs', () => {
    const { container } = render(
      <form>
        <SessionEditor
          sessions={sessions}
          divisions={divisions}
          positions={[]}
          timezone="America/Edmonton"
        />
      </form>,
    );
    expect(screen.getByLabelText('Session name')).toHaveValue('Skills');
    expect(screen.getByLabelText('Starts')).toHaveValue('2026-09-14T18:00');
    expect(screen.getByLabelText('Location (optional)')).toHaveValue('Arena');
    const data = new FormData(container.querySelector('form')!);
    expect(data.get('sessionId')).toBe('session-1');
    expect(data.get('groupId')).toBe('group-1');
  });
  it('loads all existing rubric criteria and submits edited weights and scales', () => {
    const { container } = render(
      <form>
        <RubricEditor sessions={sessions} />
      </form>,
    );
    expect(screen.getByLabelText('Rubric name')).toHaveValue('Skills scoring');
    expect(screen.getByLabelText('Category 1 name')).toHaveValue('Skating');
    expect(screen.getByLabelText('Category 2 name')).toHaveValue('Passing');
    fireEvent.change(screen.getByLabelText('Category 1 name'), { target: { value: 'Speed' } });
    const data = new FormData(container.querySelector('form')!);
    expect(JSON.parse(String(data.get('categories')))).toEqual([
      { name: 'Speed', weight: 60, scaleMin: 1, scaleMax: 5 },
      { name: 'Passing', weight: 40, scaleMin: 1, scaleMax: 10 },
    ]);
  });
});

it('retains attempted saved-record edits after an unsuccessful action reset', async () => {
  const action = vi.fn(async () => {});
  render(
    <form action={action}>
      <SessionEditor
        sessions={sessions}
        divisions={divisions}
        positions={[]}
        timezone="America/Edmonton"
      />
      <button type="submit">Save</button>
    </form>,
  );
  fireEvent.change(screen.getByLabelText('Session name'), { target: { value: 'Attempted edit' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(action).toHaveBeenCalledOnce());
  expect(screen.getByLabelText('Session name')).toHaveValue('Attempted edit');
});

it('returns to the selected saved division after a successful redirect', () => {
  render(
    <DivisionEditor
      divisions={[...divisions, { id: 'division-2', name: 'U17' }]}
      selectedId="division-2"
    />,
  );
  expect(screen.getByLabelText('Division name')).toHaveValue('U17');
});
