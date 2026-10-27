import { render, screen, cleanup, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { familyInvitationPath, isFamilyDestination } from '@/lib/family-invitation-path';
import { FamilyInvitationForm } from '@/modules/talent/ui/family-invitation-form';
import SignInPage from '@/app/(auth)/sign-in/page';
import SignUpPage from '@/app/(auth)/sign-up/page';

const actions = vi.hoisted(() => ({ create: vi.fn(), revoke: vi.fn() }));
vi.mock('@/modules/talent/application/family-invitations', () => ({
  createFamilyInvitation: actions.create,
  revokeFamilyInvitation: actions.revoke,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
const athletes = [
  { id: 'f1670000-0000-4000-8000-000000000020', given_name: 'Avery', family_name: 'Example' },
  { id: 'f1670000-0000-4000-8000-000000000021', given_name: 'Blake', family_name: 'Example' },
];
const path = '/invite/family/' + 'A'.repeat(43);
describe('family invitation identity and continuation', () => {
  it('only accepts an exact family invitation path as an authentication continuation', () => {
    expect(familyInvitationPath(path)).toBe(path);
    expect(isFamilyDestination(path)).toBe(true);
    for (const bad of [
      '//outside.example/' + path,
      'https://outside.example' + path,
      path + '?next=/app',
      path + '/extra',
      '/invite/staff-token',
      '/participant/../app',
    ])
      expect(familyInvitationPath(bad)).toBeUndefined();
  });
  it('keeps family signup and sign-in tied to the invitation without showing organization onboarding copy', async () => {
    const view = render(await SignInPage({ searchParams: Promise.resolve({ next: path }) }));
    expect(screen.getByRole('heading', { name: 'Athlete and family portal' })).toBeVisible();
    expect(
      screen.getByRole('link', { name: 'Create an athlete or family account' }),
    ).toHaveAttribute('href', `/sign-up?purpose=participant&next=${encodeURIComponent(path)}`);
    view.unmount();
    render(
      await SignUpPage({ searchParams: Promise.resolve({ purpose: 'participant', next: path }) }),
    );
    expect(document.querySelector('input[name="next"]')).toHaveValue(path);
    expect(screen.queryByText(/After verification, you’ll create your organization/)).toBeNull();
  });
  it('locks the reviewed athlete and email while the invitation is being created', async () => {
    const user = userEvent.setup();
    let complete!: (value: {
      ok: true;
      shareUrl: string;
      invitationId: string;
      message: string;
    }) => void;
    actions.create.mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    render(
      <FamilyInvitationForm
        slug="fictional"
        athletes={athletes}
        selectedAthlete={athletes[0]!.id}
      />,
    );
    await user.type(screen.getByLabelText('Family email'), 'guardian@example.test');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Create family invitation' }));
    try {
      expect(screen.getByLabelText('Athlete')).toBeDisabled();
      expect(screen.getByLabelText('Family email')).toBeDisabled();
      expect(screen.getByLabelText('Relationship')).toBeDisabled();
      expect(screen.getByRole('checkbox')).toBeDisabled();
    } finally {
      await act(async () => {
        complete({
          ok: true,
          shareUrl: 'https://app.example.test' + path,
          invitationId: 'invitation-1',
          message: 'No email has been sent.',
        });
      });
    }
    expect(screen.getByLabelText('Family email')).toHaveValue('guardian@example.test');
    expect(screen.getByLabelText('Family email')).toBeEnabled();
    expect(screen.getByRole('region', { name: 'Share family invitation' })).toHaveTextContent(
      'guardian@example.test',
    );
  });

  it('removes the share link when refreshed invitation status is revoked or accepted', async () => {
    const user = userEvent.setup();
    actions.create.mockResolvedValue({
      ok: true,
      invitationId: 'invitation-1',
      shareUrl: 'https://app.example.test' + path,
      message: 'No email has been sent.',
    });
    const view = render(
      <FamilyInvitationForm
        slug="fictional"
        athletes={athletes}
        selectedAthlete={athletes[0]!.id}
      />,
    );
    await user.type(screen.getByLabelText('Family email'), 'guardian@example.test');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Create family invitation' }));
    expect(screen.getByRole('region', { name: 'Share family invitation' })).toBeVisible();
    view.rerender(
      <FamilyInvitationForm
        slug="fictional"
        athletes={athletes}
        selectedAthlete={athletes[0]!.id}
        unavailableInvitationIds={['invitation-1']}
      />,
    );
    expect(screen.queryByRole('region', { name: 'Share family invitation' })).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('This invitation is no longer pending.');
  });

  it('requires confirmation again when the selected athlete changes', async () => {
    const user = userEvent.setup();
    actions.create.mockResolvedValue({
      ok: true,
      shareUrl: 'https://app.example.test' + path,
      invitationId: 'invitation-1',
      message: 'No email has been sent.',
    });
    render(
      <FamilyInvitationForm
        slug="fictional"
        athletes={athletes}
        selectedAthlete={athletes[0]!.id}
      />,
    );
    await user.type(screen.getByLabelText('Family email'), 'guardian@example.test');
    await user.click(screen.getByRole('checkbox'));
    await user.selectOptions(screen.getByLabelText('Athlete'), athletes[1]!.id);
    expect(screen.getByRole('button', { name: 'Create family invitation' })).toBeDisabled();
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Create family invitation' }));
    expect(actions.create).toHaveBeenCalledWith('fictional', {
      athlete_id: athletes[1]!.id,
      email: 'guardian@example.test',
      relationship: 'guardian',
      confirmed: true,
    });
    expect(await screen.findByRole('region', { name: 'Share family invitation' })).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('No email has been sent.');
  });
  it('keeps the choices available after a refused invitation and shows no share link', async () => {
    const user = userEvent.setup();
    actions.create.mockResolvedValue({ ok: false, message: 'Invitation unavailable.' });
    render(
      <FamilyInvitationForm
        slug="fictional"
        athletes={athletes}
        selectedAthlete={athletes[0]!.id}
      />,
    );
    await user.type(screen.getByLabelText('Family email'), 'guardian@example.test');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Create family invitation' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Invitation unavailable.');
    expect(screen.getByLabelText('Family email')).toHaveValue('guardian@example.test');
    expect(screen.queryByRole('region', { name: 'Share family invitation' })).toBeNull();
  });
});
