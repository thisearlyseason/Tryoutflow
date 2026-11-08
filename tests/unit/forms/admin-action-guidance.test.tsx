import { Component, type ReactNode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ create: vi.fn(), assess: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', async (original) => ({
  ...(await original<typeof import('next/navigation')>()),
  useRouter: () => ({ refresh: mocks.refresh }),
}));
vi.mock('@/modules/talent/application/calibration-actions', () => ({
  createCalibration: mocks.create,
  submitCalibration: mocks.assess,
}));
import { InviteMemberForm } from '@/modules/organizations/components/invite-member-form';
import { CreateTeamWorkspaceForm } from '@/modules/organizations/components/create-team-workspace-form';
import { CalibrationForm } from '@/modules/talent/ui/calibration-forms';
beforeEach(() => {
  vi.clearAllMocks();
  mocks.create.mockResolvedValue({ ok: false, message: 'Review the case.' });
  mocks.assess.mockResolvedValue({ ok: false, message: 'Review the assessment.' });
});
function fillCase() {
  for (const [name, value] of [
    ['Title', 'QA case'],
    ['Observation / evidence to assess', 'Keep this observation'],
    ['Rubric anchors and scale guidance', 'Use the same rubric'],
    ['Reference score (1–10)', '7'],
    ['Reference reasoning', 'Keep the reasoning'],
  ])
    fireEvent.change(screen.getByLabelText(name!), { target: { value } });
}
function fillAssessment() {
  fireEvent.change(screen.getByLabelText('Score (1–10)'), { target: { value: '6' } });
  fireEvent.change(screen.getByLabelText('Evidence and rationale'), {
    target: { value: 'Keep this rationale' },
  });
}
it('retains invitation email and role on returned failures and refocuses identical retries', async () => {
  const action = vi.fn(async (_s: unknown, _d: FormData) => ({
    status: 'error' as const,
    message: 'Review this invitation.',
  }));
  const user = userEvent.setup();
  render(<InviteMemberForm action={action} />);
  await user.type(screen.getByLabelText('Email'), 'coach@example.test');
  await user.selectOptions(screen.getByLabelText('Role'), 'administrator');
  await user.click(screen.getByRole('button', { name: 'Create invitation' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveFocus());
  expect(screen.getByLabelText('Email')).toHaveValue('coach@example.test');
  expect(screen.getByLabelText('Role')).toHaveValue('administrator');
  screen.getByLabelText('Email').focus();
  await user.click(screen.getByRole('button', { name: 'Create invitation' }));
  await waitFor(() => expect(action).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveFocus());
  expect(action.mock.calls[1]![1].get('email')).toBe('coach@example.test');
});
it('retains invitation entries and focuses an unconfirmed result on rejection', async () => {
  const user = userEvent.setup();
  render(<InviteMemberForm action={vi.fn().mockRejectedValue(new Error('lost connection'))} />);
  await user.type(screen.getByLabelText('Email'), 'coach@example.test');
  await user.click(screen.getByRole('button', { name: 'Create invitation' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveFocus());
  expect(screen.getByRole('alert')).toHaveTextContent('We could not confirm this invitation.');
  expect(screen.getByLabelText('Email')).toHaveValue('coach@example.test');
});
it.each(['manual_share', 'notifier_enqueued'] as const)(
  'locks invitation fields with complete payload, then preserves %s confirmation and resets inputs',
  async (status) => {
    let resolve!: (r: { status: typeof status; shareUrl: string; expiresAt: string }) => void;
    const action = vi.fn(
      (_state: unknown, _data: FormData) =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const user = userEvent.setup();
    render(<InviteMemberForm action={action as never} />);
    await user.type(screen.getByLabelText('Email'), 'coach@example.test');
    await user.selectOptions(screen.getByLabelText('Role'), 'administrator');
    await user.click(screen.getByRole('button', { name: 'Create invitation' }));
    expect(screen.getByLabelText('Email')).toBeDisabled();
    expect(screen.getByLabelText('Role')).toBeDisabled();
    expect(screen.getByLabelText('Email').closest('form')).toHaveAttribute('aria-busy', 'true');
    expect(action.mock.calls[0]![1].get('email')).toBe('coach@example.test');
    expect(action.mock.calls[0]![1].get('role')).toBe('administrator');
    await act(async () =>
      resolve({
        status,
        shareUrl: 'https://example.test/invite/synthetic',
        expiresAt: '2026-12-01T12:00:00Z',
      }),
    );
    expect(screen.getByRole('heading', { name: 'Invitation created' })).toBeVisible();
    expect(screen.getByLabelText('One-time invitation link')).toHaveValue(
      'https://example.test/invite/synthetic',
    );
    expect(
      screen.getByText(
        status === 'manual_share' ? /Email delivery is not configured yet/ : /Delivery was queued/,
      ),
    ).toBeVisible();
    expect(screen.getByLabelText('Email')).toHaveValue('');
    expect(screen.getByLabelText('Role')).toHaveValue('member');
    expect(screen.getByLabelText('Email')).toBeEnabled();
    expect(screen.queryByRole('alert')).toBeNull();
  },
);
it('retains team name/custom address and refocuses repeated returned errors', async () => {
  const action = vi.fn(async (_state: unknown, _data: FormData) => ({
    error: 'That workspace address is taken.',
  }));
  const user = userEvent.setup();
  render(<CreateTeamWorkspaceForm action={action} parentSlug="club" />);
  await user.type(screen.getByRole('textbox', { name: 'Team name' }), 'Falcons');
  await user.clear(screen.getByRole('textbox', { name: /^Workspace address/ }));
  await user.type(screen.getByRole('textbox', { name: /^Workspace address/ }), 'custom-falcons');
  await user.click(screen.getByRole('button', { name: 'Create team workspace' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveFocus());
  expect(screen.getByRole('textbox', { name: 'Team name' })).toHaveValue('Falcons');
  expect(screen.getByRole('textbox', { name: /^Workspace address/ })).toHaveValue('custom-falcons');
  await user.type(screen.getByRole('textbox', { name: 'Team name' }), ' U13');
  expect(screen.getByRole('textbox', { name: /^Workspace address/ })).toHaveValue('custom-falcons');
  await user.click(screen.getByRole('button', { name: 'Create team workspace' }));
  await waitFor(() => expect(action).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveFocus());
});
it('locks team fields without dropping captured values and focuses rejected creation after unlocking', async () => {
  let reject!: (e: Error) => void;
  const action = vi.fn(
    (_s: unknown, _d: FormData) =>
      new Promise((_resolve, r) => {
        reject = r;
      }),
  );
  const user = userEvent.setup();
  render(<CreateTeamWorkspaceForm action={action as never} parentSlug="club" />);
  await user.type(screen.getByRole('textbox', { name: 'Team name' }), 'Falcons');
  await user.click(screen.getByRole('button', { name: 'Create team workspace' }));
  expect(screen.getByRole('textbox', { name: 'Team name' })).toBeDisabled();
  expect(screen.getByRole('textbox', { name: /^Workspace address/ })).toBeDisabled();
  expect(action.mock.calls[0]![1].get('name')).toBe('Falcons');
  expect(action.mock.calls[0]![1].get('slug')).toBe('club-falcons');
  await act(async () => reject(new Error('connection lost')));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveFocus());
  expect(screen.getByRole('alert')).toHaveTextContent('We could not confirm this workspace.');
  expect(screen.getByRole('textbox', { name: 'Team name' })).toBeEnabled();
  expect(screen.getByRole('textbox', { name: /^Workspace address/ })).toHaveValue('club-falcons');
});
it.each(['create', 'assessment'] as const)(
  'focuses %s calibration failures, retains entries and retries the same target',
  async (mode) => {
    const assessment = mode === 'assessment';
    const user = userEvent.setup();
    render(<CalibrationForm slug="club" caseId={assessment ? 'case-id' : undefined} />);
    assessment ? fillAssessment() : fillCase();
    const button = () =>
      screen.getByRole('button', { name: assessment ? 'Submit assessment' : 'Create case' });
    const action = assessment ? mocks.assess : mocks.create;
    await user.click(button());
    await waitFor(() => expect(screen.getByRole('alert')).toHaveFocus());
    const field = screen.getByLabelText(
      assessment ? 'Evidence and rationale' : 'Observation / evidence to assess',
    );
    expect(field).toBeEnabled();
    expect(field).toHaveValue(assessment ? 'Keep this rationale' : 'Keep this observation');
    field.focus();
    await user.click(button());
    await waitFor(() => expect(action).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveFocus());
    expect(action.mock.calls[1]![1]).toEqual(action.mock.calls[0]![1]);
  },
);
it.each(['create', 'assessment'] as const)(
  'locks %s calibration pending/saved fields and blocks duplicate/post-success writes',
  async (mode) => {
    const assessment = mode === 'assessment';
    let finish!: (r: { ok: boolean; message: string }) => void;
    const action = assessment ? mocks.assess : mocks.create;
    action.mockImplementation(
      () =>
        new Promise((r) => {
          finish = r;
        }),
    );
    const view = render(
      <CalibrationForm slug="club" caseId={assessment ? 'case-id' : undefined} />,
    );
    assessment ? fillAssessment() : fillCase();
    const form = view.container.querySelector('form')!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(action).toHaveBeenCalledTimes(1);
    expect(form).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByLabelText(assessment ? 'Score (1–10)' : 'Title')).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Saving…');
    await act(async () => finish({ ok: true, message: 'Confirmed saved.' }));
    expect(screen.getByRole('status')).toHaveTextContent('Confirmed saved.');
    expect(screen.getByRole('status')).not.toHaveFocus();
    expect(screen.getByLabelText(assessment ? 'Score (1–10)' : 'Title')).toBeDisabled();
    fireEvent.submit(form);
    expect(action).toHaveBeenCalledTimes(1);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    if (assessment) expect(screen.queryByRole('button', { name: 'Create another' })).toBeNull();
    else {
      const first = action.mock.calls[0]![1].id;
      fireEvent.click(screen.getByRole('button', { name: 'Create another' }));
      expect(screen.getByLabelText('Title')).toHaveValue('');
      expect(screen.getByRole('status')).toBeEmptyDOMElement();
      fillCase();
      fireEvent.submit(view.container.querySelector('form')!);
      expect(action.mock.calls[1]![1].id).not.toBe(first);
      await act(async () => finish({ ok: true, message: 'Second case saved.' }));
    }
  },
);
it.each(['create', 'assessment'] as const)(
  'treats rejected %s calibration as unconfirmed with entries intact',
  async (mode) => {
    const assessment = mode === 'assessment';
    (assessment ? mocks.assess : mocks.create).mockRejectedValue(new Error('lost reply'));
    const user = userEvent.setup();
    render(<CalibrationForm slug="club" caseId={assessment ? 'case-id' : undefined} />);
    assessment ? fillAssessment() : fillCase();
    await user.click(
      screen.getByRole('button', { name: assessment ? 'Submit assessment' : 'Create case' }),
    );
    await waitFor(() => expect(screen.getByRole('alert')).toHaveFocus());
    expect(screen.getByRole('alert')).toHaveTextContent('We could not confirm this save.');
    expect(screen.getByLabelText(assessment ? 'Evidence and rationale' : 'Title')).toHaveValue(
      assessment ? 'Keep this rationale' : 'QA case',
    );
  },
);
class Boundary extends Component<
  { children: ReactNode; onError: (error: unknown) => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    this.props.onError(error);
  }
  render() {
    return this.state.failed ? <p>Framework navigation preserved</p> : this.props.children;
  }
}
it.each(
  (['invitation', 'team', 'calibration'] as const).flatMap((kind) =>
    (['redirect', 'not-found'] as const).map((signalKind) => [kind, signalKind] as const),
  ),
)('does not convert framework signals to %s form errors (%s)', async (kind, signalKind) => {
  const signal = Object.assign(new Error('NEXT_REDIRECT'), {
    digest:
      signalKind === 'redirect'
        ? 'NEXT_REDIRECT;replace;/app/team/home;307;'
        : 'NEXT_HTTP_ERROR_FALLBACK;404',
  });
  const caught = vi.fn();
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  const user = userEvent.setup();
  try {
    const action = vi.fn().mockRejectedValue(signal);
    if (kind === 'calibration') mocks.create.mockRejectedValue(signal);
    render(
      <Boundary onError={caught}>
        {kind === 'invitation' ? (
          <InviteMemberForm action={action} />
        ) : kind === 'team' ? (
          <CreateTeamWorkspaceForm action={action} parentSlug="club" />
        ) : (
          <CalibrationForm slug="club" />
        )}
      </Boundary>,
    );
    if (kind === 'invitation')
      await user.type(screen.getByLabelText('Email'), 'coach@example.test');
    else if (kind === 'team')
      await user.type(screen.getByRole('textbox', { name: 'Team name' }), 'Falcons');
    else fillCase();
    await user.click(
      screen.getByRole('button', {
        name:
          kind === 'invitation'
            ? 'Create invitation'
            : kind === 'team'
              ? 'Create team workspace'
              : 'Create case',
      }),
    );
    await screen.findByText('Framework navigation preserved');
    expect(caught).toHaveBeenCalledWith(signal);
    expect(screen.queryByRole('alert')).toBeNull();
  } finally {
    consoleError.mockRestore();
  }
});
