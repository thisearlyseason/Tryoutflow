import { installRecoveryLocks } from '../../helpers/recovery-lock';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, it, expect, vi } from 'vitest';
import { NewTryoutForm } from '@/modules/tryouts/ui/new-tryout-form';
import {
  claimRecoveryOwner,
  recoveryKey,
  RECOVERY_TTL,
  RECOVERY_OWNER,
  clearAllSetupRecovery,
  writeRecovery,
} from '@/modules/tryouts/ui/setup-recovery-store';
const navigation = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => navigation }));
const scope = { userId: 'user-a', organizationId: 'org-a', form: 'new', baseline: 'new' };
const props = {
  seasons: [{ id: 'season', name: '2026 season' }],
  defaultSport: 'Hockey',
  timezone: 'UTC',
  defaultCycleName: '2026 season',
  recovery: scope,
};
const fields = {
  name: 'Recovered event',
  sport: 'Hockey',
  timezone: 'UTC',
  seasonId: 'season',
  newSeasonName: '',
  registrationStartsAt: '',
  registrationEndsAt: '',
};
beforeEach(async () => {
  installRecoveryLocks();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  localStorage.clear();
  await claimRecoveryOwner('user-a');
});
it('is off by default, offers an explicit Resume after reload, and never submits on Resume', async () => {
  const action = vi.fn();
  let view = render(<NewTryoutForm {...props} action={action} />);
  const name = screen.getByRole('textbox', { name: 'Tryout name' });
  await userEvent.type(name, 'Fall event');
  expect(localStorage.getItem(recoveryKey(scope))).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Enable recovery' }));
  await waitFor(() => expect(localStorage.getItem(recoveryKey(scope))).toContain('Fall event'));
  view.unmount();
  view = render(<NewTryoutForm {...props} action={action} />);
  expect(await screen.findByRole('button', { name: 'Resume recovery copy' })).toBeVisible();
  expect(screen.getByRole('textbox', { name: 'Tryout name' })).toHaveValue('');
  await userEvent.click(screen.getByRole('button', { name: 'Resume recovery copy' }));
  expect(screen.getByRole('textbox', { name: 'Tryout name' })).toHaveValue('Fall event');
  expect(action).not.toHaveBeenCalled();
});
it('discards without applying a copy and prevents expired copies from returning', async () => {
  writeRecovery(localStorage, scope, fields, null);
  const view = render(<NewTryoutForm {...props} action={vi.fn()} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Discard recovery copy' }));
  expect(localStorage.getItem(recoveryKey(scope))).toBeNull();
  expect(screen.getByRole('textbox', { name: 'Tryout name' })).toHaveValue('');
  view.unmount();
  const now = Date.now();
  writeRecovery(localStorage, scope, fields, null, now - RECOVERY_TTL);
  render(<NewTryoutForm {...props} action={vi.fn()} />);
  await screen.findByRole('button', { name: 'Enable recovery' });
  expect(screen.queryByRole('button', { name: 'Resume recovery copy' })).toBeNull();
  expect(localStorage.getItem(recoveryKey(scope))).toBeNull();
});
it('does not restore a removed cycle or overwrite another account', async () => {
  writeRecovery(localStorage, scope, { ...fields, seasonId: 'removed' }, null);
  const view = render(<NewTryoutForm {...props} action={vi.fn()} />);
  expect(await screen.findByText(/cycle is no longer available/)).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Resume recovery copy' })).toBeNull();
  view.unmount();
  await claimRecoveryOwner('user-b');
  render(<NewTryoutForm {...props} recovery={{ ...scope, userId: 'user-b' }} action={vi.fn()} />);
  expect(screen.queryByRole('button', { name: 'Resume recovery copy' })).toBeNull();
  expect(screen.getByRole('textbox', { name: 'Tryout name' })).toHaveValue('');
});
it('purges on logout and cannot write a new copy from the old mounted form', async () => {
  render(<NewTryoutForm {...props} action={vi.fn()} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Enable recovery' }));
  await userEvent.type(screen.getByRole('textbox', { name: 'Tryout name' }), 'Private event');
  await clearAllSetupRecovery();
  await userEvent.type(screen.getByRole('textbox', { name: 'Tryout name' }), ' more');
  expect(localStorage.getItem(recoveryKey(scope))).toBeNull();
  expect(localStorage.getItem(RECOVERY_OWNER)).toBeNull();
});
it('keeps the ordinary form usable when storage is blocked', async () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw Error('blocked');
  });
  const action = vi
    .fn()
    .mockResolvedValue({ status: 'created', href: '/app/club/tryouts/event/setup/divisions' });
  render(<NewTryoutForm {...props} action={action} />);
  expect(await screen.findByText(/Recovery is unavailable/)).toBeVisible();
  await userEvent.type(screen.getByRole('textbox', { name: 'Tryout name' }), 'Normal event');
  expect(screen.getByRole('textbox', { name: 'Tryout name' })).toHaveValue('Normal event');
  expect(screen.getByRole('button', { name: 'Create draft' })).toBeEnabled();
  await userEvent.click(screen.getByRole('button', { name: 'Create draft' }));
  await waitFor(() =>
    expect(navigation.push).toHaveBeenCalledWith('/app/club/tryouts/event/setup/divisions'),
  );
  expect(action).toHaveBeenCalledOnce();
});
it('retains a copy on validation failure and clears only after a confirmed create', async () => {
  const action = vi
    .fn()
    .mockResolvedValueOnce({ status: 'error', message: 'Check dates' })
    .mockResolvedValueOnce({ status: 'created', href: '/app/club/tryouts/event/setup/divisions' });
  render(<NewTryoutForm {...props} action={action} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Enable recovery' }));
  await userEvent.type(screen.getByRole('textbox', { name: 'Tryout name' }), 'Event');
  await userEvent.click(screen.getByRole('button', { name: 'Create draft' }));
  await screen.findByRole('alert');
  expect(localStorage.getItem(recoveryKey(scope))).toContain('Event');
  await userEvent.click(screen.getByRole('button', { name: 'Create draft' }));
  await waitFor(() => expect(navigation.push).toHaveBeenCalled());
  expect(localStorage.getItem(recoveryKey(scope))).toBeNull();
});

it('does not erase a newer tab copy when an earlier submission finishes', async () => {
  let finish!: (value: { status: 'created'; href: string }) => void;
  const action = vi.fn(
    () =>
      new Promise<{ status: 'created'; href: string }>((resolve) => {
        finish = resolve;
      }),
  );
  render(<NewTryoutForm {...props} action={action} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Enable recovery' }));
  await userEvent.type(screen.getByRole('textbox', { name: 'Tryout name' }), 'Submitted event');
  await userEvent.click(screen.getByRole('button', { name: 'Create draft' }));
  await waitFor(() => expect(action).toHaveBeenCalled());
  const entry = JSON.parse(localStorage.getItem(recoveryKey(scope))!);
  writeRecovery(localStorage, scope, { ...fields, name: 'Other tab newer copy' }, entry.revision);
  fireEvent(window, new StorageEvent('storage', { key: recoveryKey(scope) }));
  finish({ status: 'created', href: '/app/club/tryouts/event/setup/divisions' });
  await waitFor(() => expect(navigation.push).toHaveBeenCalled());
  expect(localStorage.getItem(recoveryKey(scope))).toContain('Other tab newer copy');
});

it('keeps consent and entered values when the server supplies equivalent scope props', async () => {
  const action = vi.fn();
  const view = render(<NewTryoutForm {...props} action={action} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Enable recovery' }));
  await userEvent.type(screen.getByRole('textbox', { name: 'Tryout name' }), 'Retained');
  await act(async () =>
    view.rerender(<NewTryoutForm {...props} recovery={{ ...scope }} action={action} />),
  );
  expect(screen.getByRole('textbox', { name: 'Tryout name' })).toBeEnabled();
  expect(screen.queryByRole('button', { name: 'Resume recovery copy' })).toBeNull();
});
