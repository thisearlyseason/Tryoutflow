import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ save: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock('@/modules/talent/application/actions', () => ({ saveTalent: mocks.save }));
import { RecordForm, type Field } from '@/modules/talent/ui/record-form';
const fields: Field[] = [
  { name: 'title', label: 'Report title', help: 'Use a short descriptive title.' },
  { name: 'notes', label: 'Evidence', type: 'textarea' },
  {
    name: 'status',
    label: 'Review status',
    type: 'select',
    options: [{ value: 'draft', label: 'Draft' }],
  },
  { name: 'approved', label: 'Approved', type: 'checkbox' },
];
const props = {
  slug: 'club',
  table: 'scouting_records' as const,
  fields,
  defaults: { title: 'Keep me', status: 'draft' },
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.save.mockResolvedValue({ ok: true, message: 'Saved. Your workspace is up to date.' });
});
function save() {
  fireEvent.click(screen.getByRole('button', { name: 'Save report' }));
}
it('announces and focuses returned non-field failures after unlocking, including identical retries', async () => {
  mocks.save.mockResolvedValue({
    ok: false,
    message: 'Your access no longer permits this change.',
  });
  render(<RecordForm {...props} />);
  save();
  const alert = await screen.findByRole('alert');
  await waitFor(() => expect(alert).toHaveFocus());
  expect(alert).toHaveTextContent('Your access no longer permits this change.');
  expect(screen.getByRole('textbox', { name: 'Report title' })).toBeEnabled();
  screen.getByRole('textbox', { name: 'Report title' }).focus();
  save();
  await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveFocus());
  expect(screen.getByRole('textbox', { name: 'Report title' })).toHaveValue('Keep me');
  expect(mocks.refresh).not.toHaveBeenCalled();
});
it('describes a rejected request as unconfirmed and preserves the write identity for retry', async () => {
  mocks.save.mockRejectedValueOnce(new Error('connection lost')).mockResolvedValueOnce({
    ok: false,
    message: 'This record already exists. Refresh to review it.',
  });
  render(<RecordForm {...props} />);
  save();
  const alert = await screen.findByRole('alert');
  await waitFor(() => expect(alert).toHaveFocus());
  expect(alert).toHaveTextContent(
    'We could not confirm this save. Your entries are still here. Check the workspace in another tab before trying again.',
  );
  const first = mocks.save.mock.calls[0]![1];
  save();
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent('This record already exists.'),
  );
  expect(mocks.save.mock.calls[1]![1]).toEqual(first);
  expect(screen.getByRole('textbox', { name: 'Report title' })).toHaveValue('Keep me');
});
it('links only rendered field errors with human labels and focuses the first in visual order', async () => {
  mocks.save.mockResolvedValue({
    ok: false,
    message: 'Review the highlighted fields.',
    errors: {
      hidden_id: 'Unavailable.',
      approved: 'Check approval.',
      status: 'Choose a status.',
      notes: 'Add evidence.',
      title: 'Use a longer title.',
    },
  });
  render(<RecordForm {...props} />);
  save();
  const alert = await screen.findByRole('alert');
  const title = screen.getByRole('textbox', { name: 'Report title' });
  await waitFor(() => expect(title).toHaveFocus());
  expect(title).toHaveAccessibleDescription('Use a short descriptive title. Use a longer title.');
  const links = within(alert).getAllByRole('link');
  expect(links.map((link) => link.textContent)).toEqual([
    'Report title: Use a longer title.',
    'Evidence: Add evidence.',
    'Review status: Choose a status.',
    'Approved: Check approval.',
  ]);
  expect(alert).not.toHaveTextContent('hidden_id');
  for (const [label, role] of [
    ['Evidence', 'textbox'],
    ['Review status', 'combobox'],
    ['Approved', 'checkbox'],
  ] as const) {
    const control = screen.getByRole(role, { name: label });
    const link = within(alert).getByRole('link', { name: new RegExp(`^${label}:`) });
    expect(link).toHaveAttribute('href', `#${control.id}`);
    fireEvent.click(link);
    expect(control).toHaveFocus();
    expect(control).toHaveAttribute('aria-invalid', 'true');
  }
});
it('focuses the alert for hidden errors without creating broken field links', async () => {
  mocks.save.mockResolvedValue({
    ok: false,
    message: 'The selected athlete is unavailable.',
    errors: { athlete_id: 'Unavailable.' },
  });
  render(<RecordForm {...props} />);
  save();
  const alert = await screen.findByRole('alert');
  await waitFor(() => expect(alert).toHaveFocus());
  expect(within(alert).queryByRole('link')).toBeNull();
  expect(screen.getByRole('textbox', { name: 'Report title' })).toHaveAttribute(
    'aria-invalid',
    'false',
  );
});
it('keeps summary targets unique to each form instance', async () => {
  mocks.save.mockResolvedValue({
    ok: false,
    message: 'Review the highlighted fields.',
    errors: { notes: 'Add evidence.' },
  });
  const view = render(
    <>
      <RecordForm {...props} />
      <RecordForm {...props} />
    </>,
  );
  const forms = view.container.querySelectorAll('form');
  fireEvent.submit(forms[0]!);
  fireEvent.submit(forms[1]!);
  await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(2));
  const ids: string[] = [];
  for (const form of forms) {
    const control = within(form).getByRole('textbox', { name: 'Evidence' });
    expect(within(form).getByRole('link', { name: 'Evidence: Add evidence.' })).toHaveAttribute(
      'href',
      `#${control.id}`,
    );
    expect(control.id).not.toBe('');
    ids.push(control.id);
  }
  expect(new Set(ids).size).toBe(2);
});
it('does not treat inherited object keys as field errors', () => {
  render(<RecordForm {...props} fields={[{ name: 'constructor', label: 'Custom value' }]} />);
  expect(screen.getByRole('textbox', { name: 'Custom value' })).toHaveAttribute(
    'aria-invalid',
    'false',
  );
  expect(screen.queryByRole('alert')).toBeNull();
});
it('preserves edit identity/version and replaces obsolete field feedback on a later global failure', async () => {
  mocks.save
    .mockResolvedValueOnce({
      ok: false,
      message: 'Review fields.',
      errors: { title: 'Use a longer title.' },
    })
    .mockResolvedValueOnce({
      ok: false,
      message: 'This record changed. Review the workspace in another tab.',
    });
  render(<RecordForm {...props} id="existing-record" version={4} />);
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await screen.findByRole('alert');
  fireEvent.change(screen.getByRole('textbox', { name: 'Report title' }), {
    target: { value: 'A corrected title' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveFocus());
  expect(screen.queryByRole('link')).toBeNull();
  expect(screen.getByRole('textbox', { name: 'Report title' })).toHaveAttribute(
    'aria-invalid',
    'false',
  );
  expect(mocks.save.mock.calls[1]![1]).toMatchObject({
    id: 'existing-record',
    version: 4,
    values: { title: 'A corrected title' },
  });
});
it('keeps pending deduplication and confirmed save/Add another behavior without error autofocus', async () => {
  let finish!: (result: { ok: boolean; message: string }) => void;
  mocks.save.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const dirty = vi.fn();
  const view = render(<RecordForm {...props} onDirtyChange={dirty} />);
  const form = view.container.querySelector('form')!;
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(mocks.save).toHaveBeenCalledTimes(1);
  expect(form).toHaveAttribute('aria-busy', 'true');
  expect(screen.getByRole('textbox', { name: 'Report title' })).toBeDisabled();
  expect(screen.getByRole('status')).toHaveTextContent('Saving…');
  expect(screen.queryByRole('alert')).toBeNull();
  await act(async () => finish({ ok: true, message: 'Saved. Your workspace is up to date.' }));
  const status = screen.getByRole('status');
  expect(status).toHaveTextContent('Saved. Your workspace is up to date.');
  expect(status).not.toHaveFocus();
  expect(screen.getByRole('textbox', { name: 'Report title' })).toBeDisabled();
  expect(mocks.refresh).toHaveBeenCalledTimes(1);
  expect(dirty).toHaveBeenLastCalledWith(false);
  const id = mocks.save.mock.calls[0]![1].id;
  fireEvent.click(screen.getByRole('button', { name: 'Add another' }));
  expect(screen.getByRole('textbox', { name: 'Report title' })).toBeEnabled();
  expect(screen.getByRole('status')).toBeEmptyDOMElement();
  expect(screen.queryByRole('alert')).toBeNull();
  save();
  expect(mocks.save.mock.calls[1]![1].id).not.toBe(id);
});
