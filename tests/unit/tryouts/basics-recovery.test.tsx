import { installRecoveryLocks } from '../../helpers/recovery-lock';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, it, expect, vi } from 'vitest';
import { TryoutWizard } from '@/modules/tryouts/ui/tryout-wizard';
import {
  claimRecoveryOwner,
  writeRecovery,
  recoveryKey,
} from '@/modules/tryouts/ui/setup-recovery-store';
const navigation = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => navigation }));
const scope = { userId: 'user', organizationId: 'org', form: 'basics:event', baseline: '3' };
const basics = {
  name: 'Saved event',
  sport: 'Hockey',
  timezone: 'UTC',
  registrationStartsAt: '2026-11-10T10:00',
  registrationEndsAt: '2026-11-11T10:00',
};
beforeEach(async () => {
  installRecoveryLocks();
  localStorage.clear();
  await claimRecoveryOwner('user');
  vi.clearAllMocks();
});
it('resumes local Basics only by choice, without saving or losing current server defaults', async () => {
  writeRecovery(localStorage, scope, { ...basics, name: 'Unfinished edit' }, null);
  const action = vi.fn();
  render(
    <TryoutWizard
      action={action}
      basics={basics}
      blockers={[]}
      name={basics.name}
      step="basics"
      recovery={scope}
    />,
  );
  await screen.findByRole('button', { name: 'Resume recovery copy' });
  expect(screen.getByRole('textbox', { name: 'Tryout name' })).toHaveValue('Saved event');
  await userEvent.click(screen.getByRole('button', { name: 'Resume recovery copy' }));
  expect(screen.getByRole('textbox', { name: 'Tryout name' })).toHaveValue('Unfinished edit');
  expect(action).not.toHaveBeenCalled();
});
it('blocks stale recovery against a newer saved version', async () => {
  writeRecovery(localStorage, { ...scope, baseline: '2' }, { ...basics, name: 'Old edit' }, null);
  render(
    <TryoutWizard
      action={vi.fn()}
      basics={basics}
      blockers={[]}
      name={basics.name}
      step="basics"
      recovery={scope}
    />,
  );
  await screen.findByText(/saved tryout changed/);
  expect(screen.queryByRole('button', { name: 'Resume recovery copy' })).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Discard recovery copy' }));
  expect(screen.getByRole('textbox', { name: 'Tryout name' })).toHaveValue('Saved event');
});
it('clears Basics only when save is confirmed, and never offers recovery on publishing', async () => {
  const action = vi
    .fn()
    .mockResolvedValue({ status: 'saved', href: '/app/club/tryouts/event/setup/divisions' });
  const view = render(
    <TryoutWizard
      action={action}
      basics={basics}
      blockers={[]}
      name={basics.name}
      step="basics"
      recovery={scope}
    />,
  );
  await userEvent.click(await screen.findByRole('button', { name: 'Enable recovery' }));
  await userEvent.click(screen.getByRole('button', { name: 'Save and continue' }));
  await waitFor(() => expect(navigation.push).toHaveBeenCalled());
  expect(localStorage.getItem(recoveryKey(scope))).toBeNull();
  view.unmount();
  render(
    <TryoutWizard
      action={vi.fn()}
      basics={basics}
      blockers={[]}
      name={basics.name}
      step="publish"
      recovery={scope}
    />,
  );
  expect(screen.queryByRole('region', { name: 'Device recovery' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Enable recovery' })).toBeNull();
});
