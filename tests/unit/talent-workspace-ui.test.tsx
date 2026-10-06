import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  refresh: vi.fn(),
  push: vi.fn(),
  path: '/app/test/tryouts/event/coverage',
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mocks.refresh, push: mocks.push }),
  usePathname: () => mocks.path,
}));
vi.mock('@/modules/talent/application/actions', () => ({ saveTalent: mocks.save }));
import { EditRecord } from '@/modules/talent/ui/record-form';
import { EventNavigation } from '@/modules/talent/ui/event-navigation';
const props = {
  slug: 'test',
  table: 'scouting_records' as const,
  title: 'Add report',
  defaults: { title: '' },
  fields: [{ name: 'title', label: 'Report title', required: true }],
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.save.mockResolvedValue({ ok: true, message: 'Report saved.' });
});
describe('focused record editing', () => {
  it('opens a named editor and keeps a draft when dismissal is cancelled', () => {
    render(<EditRecord {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add report' }));
    expect(screen.getByRole('dialog', { name: 'Add report' })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Report title' }), {
      target: { value: 'Keep this draft' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Close editor' }));
    expect(screen.getByRole('alert')).toHaveTextContent('unsaved changes');
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(screen.getByRole('textbox', { name: 'Report title' })).toHaveValue('Keep this draft');
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it('discards only the unsaved draft and opens cleanly again', async () => {
    render(<EditRecord {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add report' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Report title' }), {
      target: { value: 'Discard me' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Close editor' }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add report' }));
    expect(screen.getByRole('textbox', { name: 'Report title' })).toHaveValue('');
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it('prevents dismissal and duplicate writes while a save is pending', async () => {
    let finish!: (result: { ok: boolean; message: string }) => void;
    mocks.save.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render(<EditRecord {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add report' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Report title' }), {
      target: { value: 'Observation' },
    });
    const form = screen.getByRole('textbox', { name: 'Report title' }).closest('form')!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Close editor' })).toBeDisabled();
    expect(screen.getByRole('textbox', { name: 'Report title' })).toBeDisabled();
    finish({ ok: true, message: 'Report saved.' });
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Report saved.'));
    fireEvent.click(screen.getByRole('button', { name: 'Close editor' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });
  it('associates server field errors, focuses the correction and retains entries', async () => {
    mocks.save.mockResolvedValue({
      ok: false,
      message: 'Correct the highlighted fields.',
      errors: { title: 'Use a descriptive title.' },
    });
    render(<EditRecord {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add report' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Report title' }), {
      target: { value: 'X' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save report' }));
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Report title' })).toHaveFocus(),
    );
    expect(screen.getByRole('textbox', { name: 'Report title' })).toHaveAccessibleDescription(
      'Use a descriptive title.',
    );
    expect(screen.getByRole('textbox', { name: 'Report title' })).toHaveValue('X');
  });
});
describe('event navigation', () => {
  it('shows the active workflow and preserves role-filtered destinations', () => {
    render(
      <EventNavigation
        base="/app/test/tryouts/event"
        links={[
          ['live', 'Live'],
          ['coverage', 'Coverage'],
          ['rankings', 'Rankings'],
        ]}
      />,
    );
    const workflows = screen.getByRole('navigation', { name: 'Tryout workflow' });
    expect(within(workflows).getByRole('link', { name: 'Run event' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(screen.getByRole('navigation', { name: 'Tryout workspace' })).toHaveTextContent(
      'Coverage',
    );
    expect(screen.queryByRole('link', { name: 'Prepare' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Coverage' })).toHaveAttribute('aria-current', 'page');
    fireEvent.change(screen.getByRole('combobox', { name: 'Tryout section' }), {
      target: { value: 'rankings' },
    });
    expect(mocks.push).toHaveBeenCalledWith('/app/test/tryouts/event/rankings');
  });
});
