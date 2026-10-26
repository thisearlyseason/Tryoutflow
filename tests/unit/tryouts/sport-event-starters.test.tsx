import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { sportEventStarters } from '@/modules/tryouts/domain/sport-event-starters';
import { SportStarterPicker } from '@/modules/tryouts/ui/sport-starter-picker';
import type { SetupCategory } from '@/modules/tryouts/domain/setup-configuration';
function Harness() {
  const [draft, setDraft] = useState<{ name: string; categories: SetupCategory[] }>({
    name: 'Existing',
    categories: [],
  });
  return (
    <>
      <output>{draft.name}</output>
      <button onClick={() => setDraft({ ...draft, name: 'Edited' })}>Edit draft</button>
      <SportStarterPicker {...draft} onApply={setDraft} />
    </>
  );
}
describe('sport event starters', () => {
  it('has coherent anchored and weighted plans without modifying measurement units', () => {
    expect(sportEventStarters.map((s) => s.sport)).toEqual(['Basketball', 'Hockey', 'Soccer']);
    for (const starter of sportEventStarters) {
      expect(starter.categories.reduce((sum, c) => sum + c.weight, 0)).toBe(100);
      expect(
        starter.categories.every(
          (c) =>
            c.guidance?.includes('1:') && c.guidance.includes('3:') && c.guidance.includes('5:'),
        ),
      ).toBe(true);
      expect(starter.stations).toHaveLength(3);
      expect(
        starter.measurements.every((m) => m.sport === starter.sport && m.unit && m.protocol),
      ).toBe(true);
    }
  });
  it('requires preview and confirmation, preserves edits on cancellation, and supports undo', () => {
    render(<Harness />);
    expect(screen.queryByRole('button', { name: 'Copy rubric to draft' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Preview starter' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel preview' }));
    expect(screen.getByText('Existing', { selector: 'output' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Preview starter' }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy rubric to draft' }));
    expect(
      screen.getByText('Basketball skills and game decisions', { selector: 'output' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copy rubric to draft' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Undo starter' }));
    expect(screen.getByText('Existing', { selector: 'output' })).toBeInTheDocument();
  });
  it('invalidates confirmation when the draft changes after preview', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Preview starter' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit draft' }));
    expect(screen.getByRole('button', { name: 'Copy rubric to draft' })).toBeDisabled();
  });
  it('does not undo across subsequent manual edits or carry a preview across sport changes', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Preview starter' }));
    fireEvent.change(screen.getByLabelText('Sport starter'), { target: { value: 'Hockey' } });
    expect(screen.queryByRole('button', { name: 'Copy rubric to draft' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Preview starter' }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy rubric to draft' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit draft' }));
    expect(screen.getByRole('button', { name: 'Undo starter' })).toBeDisabled();
    expect(screen.getByText('Edited', { selector: 'output' })).toBeInTheDocument();
  });
});
