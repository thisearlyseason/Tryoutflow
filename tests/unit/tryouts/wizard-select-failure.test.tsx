import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { TryoutWizard } from '@/modules/tryouts/ui/tryout-wizard';
import type { SetupConfiguration } from '@/modules/tryouts/domain/setup-configuration';
import { installRecoveryLocks } from '../../helpers/recovery-lock';
import { claimRecoveryOwner, writeRecovery } from '@/modules/tryouts/ui/setup-recovery-store';

const config: SetupConfiguration = {
  divisions: [
    { id: 'd1', name: 'Division one' },
    { id: 'd2', name: 'Division two' },
  ],
  sessions: ['s1', 's2'].map((id, index) => ({
    id,
    name: `Session ${index + 1}`,
    division_id: index ? 'd2' : 'd1',
    starts_at: '2026-11-10T15:00:00Z',
    ends_at: '2026-11-10T16:00:00Z',
    location: 'Rink',
    capacity: 20,
    groups: [],
    rubric: {
      id: `r${index}`,
      name: `Criteria ${index + 1}`,
      versionId: `v${index}`,
      categories: [{ name: 'Skill', weight: 100, scaleMin: 1 as const, scaleMax: 5 as const }],
    },
  })),
  positions: [],
};
const basics = {
  name: 'Camp',
  sport: 'Hockey',
  timezone: 'UTC',
  registrationStartsAt: '',
  registrationEndsAt: '',
};
beforeEach(async () => {
  installRecoveryLocks();
  localStorage.clear();
  await claimRecoveryOwner('user');
});
it.each([
  ['divisions', 'Division to edit', 'd2', 'divisionId'],
  ['sessions', 'Session to edit', 's2', 'sessionId'],
  ['rubrics', 'Session', 's2', 'sessionId'],
] as const)(
  'keeps the visible %s target and resubmitted ID after failure',
  async (step, label, target, field) => {
    const submitted: FormData[] = [];
    const action = vi.fn(async (_previous: unknown, data: FormData) => {
      submitted.push(data);
      return { status: 'form_error' as const, message: 'Save unavailable' };
    });
    render(
      <TryoutWizard
        action={action}
        name="Camp"
        blockers={[]}
        basics={basics}
        step={step}
        selectedId={target}
        configuration={config}
        divisions={config.divisions}
      />,
    );
    const select = screen.getByRole('combobox', { name: label });
    expect(select).toHaveValue(target);
    await userEvent.click(screen.getByRole('button', { name: 'Save and continue' }));
    await screen.findByText('Save unavailable');
    expect(select).toHaveValue(target);
    if (step === 'sessions')
      expect(screen.getByRole('combobox', { name: 'Division' })).toHaveValue('d2');
    await userEvent.click(screen.getByRole('button', { name: 'Save and continue' }));
    await waitFor(() => expect(submitted).toHaveLength(2));
    expect(submitted.map((data) => data.get(field))).toEqual([target, target]);
    if (step === 'sessions')
      expect(submitted.map((data) => data.get('divisionId'))).toEqual(['d2', 'd2']);
  },
);
it('keeps recovered non-first session and division visible after a failed save', async () => {
  const scope = { userId: 'user', organizationId: 'org', form: 'sessions:event', baseline: '3' };
  writeRecovery(
    localStorage,
    scope,
    {
      sessionId: 's2',
      divisionId: 'd2',
      name: 'Recovered session',
      startsAt: '2026-11-10T15:00',
      endsAt: '2026-11-10T16:00',
      location: 'Rink',
      capacity: '20',
      groupId: '',
      groupName: '',
      positionId: '',
      positionName: '',
    },
    null,
  );
  const action = vi.fn(async () => ({ status: 'form_error' as const, message: 'Retry save' }));
  render(
    <TryoutWizard
      action={action}
      name="Camp"
      blockers={[]}
      basics={basics}
      step="sessions"
      configuration={config}
      divisions={config.divisions}
      recovery={scope}
    />,
  );
  await userEvent.click(await screen.findByRole('button', { name: 'Resume recovery copy' }));
  expect(screen.getByRole('combobox', { name: 'Session to edit' })).toHaveValue('s2');
  await userEvent.click(screen.getByRole('button', { name: 'Save and continue' }));
  await screen.findByText('Retry save');
  expect(screen.getByRole('combobox', { name: 'Session to edit' })).toHaveValue('s2');
  expect(screen.getByRole('combobox', { name: 'Division' })).toHaveValue('d2');
  expect(screen.getByRole('textbox', { name: 'Session name' })).toHaveValue('Recovered session');
});
