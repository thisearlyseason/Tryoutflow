import { installRecoveryLocks } from '../../helpers/recovery-lock';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, it, expect, vi } from 'vitest';
import { TryoutWizard } from '@/modules/tryouts/ui/tryout-wizard';
import {
  claimRecoveryOwner,
  writeRecovery,
  readRecovery,
  recoveryKey,
} from '@/modules/tryouts/ui/setup-recovery-store';
const navigation = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => navigation }));
const configuration = {
  divisions: [
    { id: 'd1', name: 'U15', description: 'Saved description' },
    { id: 'd2', name: 'U18' },
  ],
  sessions: [
    {
      id: 's1',
      name: 'Ice one',
      division_id: 'd1',
      starts_at: '2026-11-10T17:00:00Z',
      ends_at: '2026-11-10T18:00:00Z',
      location: 'Rink',
      capacity: 20,
      groups: [{ id: 'g1', name: 'Group one' }],
      rubric: null,
    },
  ],
  positions: [{ id: 'p1', name: 'Forward' }],
};
const divisionFields = {
  divisionId: 'd1',
  name: 'Unfinished division',
  description: 'Detail '.repeat(60),
  minAge: '12',
  maxAge: '14',
};
const sessionFields = {
  sessionId: 's1',
  divisionId: 'd1',
  name: 'Unfinished session',
  startsAt: '2026-11-10T10:30',
  endsAt: '2026-11-10T11:30',
  location: 'Second rink',
  capacity: '18',
  groupId: 'g1',
  groupName: 'Blue',
  positionId: 'p1',
  positionName: 'Wing',
};
function scope(step: string) {
  return { userId: 'user', organizationId: 'org', form: `${step}:event`, baseline: '3' };
}
function view(
  step: 'divisions' | 'sessions',
  action = vi.fn().mockResolvedValue({ status: 'form_error', message: 'Save failed' }),
) {
  return render(
    <TryoutWizard
      action={action}
      basics={{
        name: 'Event',
        sport: 'Hockey',
        timezone: 'America/Edmonton',
        registrationStartsAt: '',
        registrationEndsAt: '',
      }}
      name="Event"
      blockers={[]}
      step={step}
      divisions={configuration.divisions}
      configuration={configuration}
      recovery={scope(step)}
    />,
  );
}
beforeEach(async () => {
  installRecoveryLocks();
  localStorage.clear();
  await claimRecoveryOwner('user');
  vi.clearAllMocks();
});
it.each(['divisions', 'sessions'] as const)(
  'explicitly restores all %s fields and target without submitting',
  async (step) => {
    const fields = step === 'divisions' ? divisionFields : sessionFields;
    expect(writeRecovery(localStorage, scope(step), fields, null).kind).toBe('saved');
    const action = vi.fn();
    view(step, action);
    await screen.findByRole('button', { name: 'Resume recovery copy' });
    const name = screen.getByRole('textbox', {
      name: step === 'divisions' ? 'Division name' : 'Session name',
    });
    expect(name).toHaveValue(step === 'divisions' ? 'U15' : 'Ice one');
    await userEvent.click(screen.getByRole('button', { name: 'Resume recovery copy' }));
    expect(name).toHaveValue(fields.name);
    if (step === 'divisions')
      expect(screen.getByRole('textbox', { name: 'Description (optional)' })).toHaveValue(
        divisionFields.description,
      );
    else {
      expect(screen.getByRole('textbox', { name: 'Group (optional)' })).toHaveValue('Blue');
      expect(screen.getByRole('textbox', { name: 'Position (optional)' })).toHaveValue('Wing');
    }
    expect(action).not.toHaveBeenCalled();
  },
);
it.each(['divisions', 'sessions'] as const)(
  'blocks %s copy if selected record is missing',
  async (step) => {
    writeRecovery(
      localStorage,
      scope(step),
      step === 'divisions'
        ? { ...divisionFields, divisionId: 'deleted' }
        : { ...sessionFields, sessionId: 'deleted' },
      null,
    );
    view(step);
    await screen.findByRole('button', { name: 'Discard recovery copy' });
    expect(screen.queryByRole('button', { name: 'Resume recovery copy' })).toBeNull();
  },
);
it('keeps session fields attached to their original division and validates related references', async () => {
  writeRecovery(localStorage, scope('sessions'), { ...sessionFields, divisionId: 'd2' }, null);
  view('sessions');
  await screen.findByRole('button', { name: 'Discard recovery copy' });
  expect(screen.queryByRole('button', { name: 'Resume recovery copy' })).toBeNull();
});
it('retains opted-in edits after failed save and clears only after confirmed add-another', async () => {
  const action = vi
    .fn()
    .mockResolvedValueOnce({ status: 'form_error', message: 'Save failed' })
    .mockResolvedValueOnce({ status: 'saved', href: '/setup/divisions?saved=1&new=1' });
  view('divisions', action);
  await userEvent.click(await screen.findByRole('button', { name: 'Enable recovery' }));
  const name = screen.getByRole('textbox', { name: 'Division name' });
  await userEvent.clear(name);
  await userEvent.type(name, 'Local division');
  await userEvent.click(screen.getByRole('button', { name: 'Save and add another' }));
  await screen.findByText('Save failed');
  expect(readRecovery(localStorage, scope('divisions'))).toMatchObject({
    record: { fields: { name: 'Local division' } },
  });
  expect(name).toHaveValue('Local division');
  await userEvent.click(screen.getByRole('button', { name: 'Save and add another' }));
  await waitFor(() =>
    expect(navigation.push).toHaveBeenCalledWith('/setup/divisions?saved=1&new=1'),
  );
  expect(localStorage.getItem(recoveryKey(scope('divisions')))).toBeNull();
});
it('switches targets using saved fields and snapshots the newly selected identity', async () => {
  view('divisions');
  await userEvent.click(await screen.findByRole('button', { name: 'Enable recovery' }));
  await userEvent.type(screen.getByRole('textbox', { name: 'Division name' }), ' unfinished');
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Division to edit' }), 'd2');
  expect(screen.getByRole('textbox', { name: 'Division name' })).toHaveValue('U18');
  await waitFor(() =>
    expect(readRecovery(localStorage, scope('divisions'))).toMatchObject({
      record: { fields: { divisionId: 'd2', name: 'U18' } },
    }),
  );
});
it('retains unfinished division copy when continuing with already saved divisions', async () => {
  const action = vi.fn().mockResolvedValue({ status: 'saved', href: '/setup/sessions' });
  view('divisions', action);
  await userEvent.click(await screen.findByRole('button', { name: 'Enable recovery' }));
  await userEvent.click(screen.getByRole('button', { name: 'Continue with saved divisions' }));
  await waitFor(() => expect(navigation.push).toHaveBeenCalled());
  expect(localStorage.getItem(recoveryKey(scope('divisions')))).not.toBeNull();
});
it('uses only an explicit editor allowlist and refuses oversized values without truncation', () => {
  const s = scope('divisions');
  expect(
    writeRecovery(localStorage, s, { ...divisionFields, password: 'PRIVATE' }, null).kind,
  ).toBe('saved');
  expect(readRecovery(localStorage, s)).toMatchObject({ record: { fields: divisionFields } });
  expect(localStorage.getItem(recoveryKey(s))).not.toContain('PRIVATE');
  expect(
    writeRecovery(localStorage, { ...s, form: 'unknown:event' }, divisionFields, null).kind,
  ).toBe('unavailable');
  const first = readRecovery(localStorage, s);
  if (first.kind !== 'candidate') throw Error('missing');
  expect(
    writeRecovery(
      localStorage,
      s,
      { ...divisionFields, description: 'x'.repeat(2001) },
      first.record.revision,
    ).kind,
  ).toBe('unavailable');
  expect(readRecovery(localStorage, s)).toMatchObject({ record: { fields: divisionFields } });
});

it('restores a new session and submits local times and new related names without retargeting an existing session', async () => {
  const fields = {
    ...sessionFields,
    sessionId: '',
    divisionId: 'd2',
    groupId: '',
    groupName: 'New group',
    positionId: '',
    positionName: 'New position',
  };
  writeRecovery(localStorage, scope('sessions'), fields, null);
  const action = vi.fn().mockResolvedValue({ status: 'saved', href: '/setup/registration' });
  view('sessions', action);
  await userEvent.click(await screen.findByRole('button', { name: 'Resume recovery copy' }));
  expect(screen.getByRole('combobox', { name: 'Session to edit' })).toHaveValue('');
  expect(screen.getByRole('combobox', { name: 'Division' })).toHaveValue('d2');
  expect(action).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Save and continue' }));
  await waitFor(() => expect(action).toHaveBeenCalledOnce());
  const submitted = action.mock.calls[0]![1] as FormData;
  for (const [key, value] of Object.entries(fields)) expect(submitted.get(key)).toBe(value);
  await waitFor(() => expect(localStorage.getItem(recoveryKey(scope('sessions')))).toBeNull());
});
it.each([{ groupId: 'missing' }, { positionId: 'missing' }])(
  'blocks missing session related record %j',
  async (missing) => {
    writeRecovery(localStorage, scope('sessions'), { ...sessionFields, ...missing }, null);
    view('sessions');
    await screen.findByRole('button', { name: 'Discard recovery copy' });
    expect(screen.queryByRole('button', { name: 'Resume recovery copy' })).toBeNull();
  },
);
