import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requireCurrentOrganization } = vi.hoisted(() => ({
  requireCurrentOrganization: vi.fn(),
}));

vi.mock('../../../src/modules/organizations/application/current-organization', () => ({
  requireCurrentOrganization,
}));

import NewTryoutPage from '../../../src/app/(app)/app/[organizationSlug]/tryouts/new/page';
import TryoutRegistrationPage from '../../../src/app/(app)/app/[organizationSlug]/tryouts/[tryoutId]/registration/page';
import SignUpPage from '../../../src/app/(auth)/sign-up/page';
import StartPage from '../../../src/app/(auth)/start/page';
import { RegistrationForm } from '../../../src/app/(registration)/register/[tryoutSlug]/registration-form';
import { FIELD_EXAMPLES } from '../../../src/components/forms/field-examples';
import { CheckinWorkspace } from '../../../src/modules/checkin/ui/checkin-workspace';
import { MessageComposer } from '../../../src/modules/communications/ui/message-composer';
import { InviteMemberForm } from '../../../src/modules/organizations/components/invite-member-form';
import { TryoutWizard } from '../../../src/modules/tryouts/ui/tryout-wizard';

const organizationId = '10000000-0000-4000-8000-000000000001';
const divisionId = '10000000-0000-4000-8000-000000000002';

function currentOrganization() {
  return {
    authorization: {
      userId: '10000000-0000-4000-8000-000000000003',
      organizationId,
      organizationRole: 'owner',
      membershipStatus: 'active',
      assignments: [],
    },
    organization: {
      id: organizationId,
      name: FIELD_EXAMPLES.organizationName,
      slug: 'badlands-hockey-academy',
      timezone: FIELD_EXAMPLES.timezone,
      sportDefaults: [],
      tagDefaults: [],
      terminology: {},
    },
    userId: '10000000-0000-4000-8000-000000000003',
    client: {
      rpc: vi.fn(async (name: string) =>
        name === 'load_staff_registration_configuration'
          ? {
              data: [
                {
                  tryout_name: FIELD_EXAMPLES.tryoutName,
                  tryout_status: 'published',
                  divisions: [{ id: divisionId, name: FIELD_EXAMPLES.division }],
                  positions: [],
                  form_schema: {
                    fields: [
                      {
                        key: 'level',
                        label: 'Playing level',
                        kind: 'select',
                        required: true,
                        sortOrder: 0,
                        options: ['A', 'B'],
                      },
                    ],
                  },
                },
              ],
              error: null,
            }
          : { data: [], error: null },
      ),
      from: vi.fn((table: string) => {
        const query = {
          select: vi.fn(),
          eq: vi.fn(),
          order: vi.fn(),
          limit: vi.fn(),
        };
        query.select.mockReturnValue(query);
        query.eq.mockReturnValue(query);
        query.order.mockImplementation(() =>
          table === 'seasons' ? Promise.resolve({ data: [], error: null }) : query,
        );
        query.limit.mockResolvedValue({ data: [], error: null, count: 0 });
        return query;
      }),
    },
  };
}

describe('core workflow field guidance', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    requireCurrentOrganization.mockImplementation(async () => currentOrganization());
  });

  it('uses catalog examples as non-submitted guidance during account and organization setup', async () => {
    const signUp = render(await SignUpPage({ searchParams: Promise.resolve({}) }));
    const signUpEmail = screen.getByRole('textbox', { name: 'Email' });
    expect(signUpEmail).toHaveAttribute('placeholder', FIELD_EXAMPLES.guardianEmail);
    expect(new FormData(signUpEmail.closest('form')!).get('email')).toBe('');
    signUp.unmount();

    const start = render(<StartPage />);
    const organizationName = screen.getByRole('textbox', { name: 'Organization name' });
    const timezone = screen.getByRole('textbox', { name: 'Timezone' });
    expect(organizationName).toHaveAttribute('placeholder', FIELD_EXAMPLES.organizationName);
    expect(screen.getByRole('textbox', { name: 'Organization URL' })).toHaveAttribute(
      'placeholder',
      'badlands-hockey-academy',
    );
    expect(timezone).toHaveAttribute('placeholder', FIELD_EXAMPLES.timezone);
    expect(timezone).toHaveAttribute('aria-describedby', 'timezone-description');
    expect(screen.getByText(`Example: ${FIELD_EXAMPLES.timezone}.`)).toHaveAttribute(
      'id',
      'timezone-description',
    );
    const startData = new FormData(organizationName.closest('form')!);
    expect(startData.get('name')).toBe('');
    expect(startData.get('timezone')).toBe('');
    start.unmount();
  });

  it('guides draft creation and each wizard setup control without replacing saved values', async () => {
    const draft = render(
      await NewTryoutPage({
        params: Promise.resolve({ organizationSlug: 'badlands-hockey-academy' }),
      }),
    );
    expect(screen.getByRole('textbox', { name: 'Tryout name' })).toHaveAttribute(
      'placeholder',
      FIELD_EXAMPLES.tryoutName,
    );
    expect(screen.getByRole('textbox', { name: 'Sport' })).toHaveAttribute(
      'placeholder',
      FIELD_EXAMPLES.sport,
    );
    expect(screen.getByRole('textbox', { name: 'New cycle name' })).toHaveAttribute(
      'placeholder',
      FIELD_EXAMPLES.season,
    );
    expect(
      screen.getByText('Registration opens').closest('label')?.querySelector('input'),
    ).toHaveAttribute('aria-describedby', 'new-tryout-registration-opens-help');
    expect(screen.getByText(/September 15, 2026 at 6:00 PM in America\/Edmonton/i)).toHaveAttribute(
      'id',
      'new-tryout-registration-opens-help',
    );
    expect(
      new FormData(screen.getByRole('textbox', { name: 'Tryout name' }).closest('form')!).get(
        'name',
      ),
    ).toBe('');
    draft.unmount();

    const divisions = render(
      <TryoutWizard action={vi.fn()} blockers={[]} name="" step="divisions" />,
    );
    expect(screen.getByRole('textbox', { name: 'Division name' })).toHaveAttribute(
      'placeholder',
      FIELD_EXAMPLES.division,
    );
    divisions.unmount();

    const sessions = render(
      <TryoutWizard action={vi.fn()} blockers={[]} divisions={[]} name="" step="sessions" />,
    );
    expect(screen.getByRole('option', { name: 'Select a division' })).toBeDisabled();
    expect(screen.getByRole('textbox', { name: 'Session name' })).toHaveAttribute(
      'placeholder',
      FIELD_EXAMPLES.session,
    );
    expect(screen.getByRole('textbox', { name: 'Group (optional)' })).toHaveAttribute(
      'placeholder',
      FIELD_EXAMPLES.group,
    );
    expect(screen.getByRole('textbox', { name: 'Position (optional)' })).toHaveAttribute(
      'placeholder',
      FIELD_EXAMPLES.position,
    );
    expect(screen.getByText('Starts').closest('label')?.querySelector('input')).toHaveAttribute(
      'aria-describedby',
      'tryout-session-starts-help',
    );
    sessions.unmount();

    const registration = render(
      <TryoutWizard action={vi.fn()} blockers={[]} name="" step="registration" />,
    );
    expect(screen.getByRole('textbox', { name: 'Form name' })).toHaveAttribute(
      'placeholder',
      FIELD_EXAMPLES.registrationForm,
    );
    registration.unmount();

    render(<TryoutWizard action={vi.fn()} blockers={[]} name="" sessions={[]} step="rubrics" />);
    expect(screen.getByRole('option', { name: 'Select a session' })).toBeDisabled();
    expect(screen.getByRole('textbox', { name: 'Rubric name' })).toHaveAttribute(
      'placeholder',
      FIELD_EXAMPLES.rubric,
    );
    expect(screen.getByRole('textbox', { name: 'Category name' })).toHaveAttribute(
      'placeholder',
      'Skating',
    );
  });

  it('guides staff and public participant entry with fictional values and truthful selects', async () => {
    const staff = render(
      await TryoutRegistrationPage({
        params: Promise.resolve({
          organizationSlug: 'badlands-hockey-academy',
          tryoutId: '10000000-0000-4000-8000-000000000004',
        }),
        searchParams: Promise.resolve({}),
      }),
    );
    expect(screen.getByRole('textbox', { name: 'Athlete name' })).toHaveAttribute(
      'placeholder',
      `${FIELD_EXAMPLES.athleteGivenName} ${FIELD_EXAMPLES.athleteFamilyName}`,
    );
    expect(screen.getByRole('textbox', { name: 'New athlete first name' })).toHaveAttribute(
      'placeholder',
      FIELD_EXAMPLES.athleteGivenName,
    );
    expect(screen.getByRole('textbox', { name: 'New athlete last name' })).toHaveAttribute(
      'placeholder',
      FIELD_EXAMPLES.athleteFamilyName,
    );
    expect(screen.getByRole('option', { name: 'Select a division' })).toBeDisabled();
    expect(screen.getByRole('option', { name: 'Select playing level' })).toBeDisabled();
    expect(
      screen.getByText('New athlete date of birth').closest('label')?.querySelector('input'),
    ).toHaveAttribute('aria-describedby', 'staff-registration-birth-date-help');
    staff.unmount();

    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            organization: { name: FIELD_EXAMPLES.organizationName },
            tryout: {
              name: FIELD_EXAMPLES.tryoutName,
              formSchema: {
                fields: [
                  {
                    key: 'level',
                    label: 'Playing level',
                    kind: 'select',
                    required: true,
                    sortOrder: 0,
                    options: ['A', 'B'],
                  },
                ],
              },
              divisions: [
                { id: divisionId, name: FIELD_EXAMPLES.division },
                { id: '10000000-0000-4000-8000-000000000005', name: 'U16' },
              ],
              positions: [],
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );
    render(<RegistrationForm tryoutSlug="fall-evaluations" deterministicBotToken="verified" />);
    expect(await screen.findByRole('heading', { name: /register for/i })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Athlete first name' })).toHaveAttribute(
      'placeholder',
      FIELD_EXAMPLES.athleteGivenName,
    );
    expect(screen.getByRole('textbox', { name: 'Athlete last name' })).toHaveAttribute(
      'placeholder',
      FIELD_EXAMPLES.athleteFamilyName,
    );
    expect(screen.getByRole('textbox', { name: 'Guardian name' })).toHaveAttribute(
      'placeholder',
      FIELD_EXAMPLES.guardianName,
    );
    expect(screen.getByRole('textbox', { name: 'Guardian email' })).toHaveAttribute(
      'placeholder',
      FIELD_EXAMPLES.guardianEmail,
    );
    expect(screen.getByRole('textbox', { name: 'Guardian phone' })).toHaveAttribute(
      'placeholder',
      FIELD_EXAMPLES.guardianPhone,
    );
    expect(screen.getByRole('option', { name: 'Select a division' })).toBeDisabled();
    expect(screen.getByRole('option', { name: 'Select playing level' })).toBeDisabled();
    expect(screen.getByLabelText('Date of birth')).toHaveAttribute(
      'aria-describedby',
      'public-registration-birth-date-help',
    );
  });

  it('guides invitations, messages, and check-in search without supplying action values', async () => {
    const invitation = render(<InviteMemberForm action={vi.fn()} />);
    const invitationEmail = screen.getByRole('textbox', { name: 'Email' });
    expect(invitationEmail).toHaveAttribute('placeholder', FIELD_EXAMPLES.guardianEmail);
    expect(new FormData(invitationEmail.closest('form')!).get('email')).toBe('');
    invitation.unmount();

    const user = userEvent.setup();
    const message = render(
      <MessageComposer previewAction={vi.fn()} rosterVersions={[]} sendAction={vi.fn()} />,
    );
    const textarea = screen.getByRole('textbox', { name: /^Organization message/ });
    await user.clear(textarea);
    expect(textarea).toHaveAttribute(
      'placeholder',
      `Share next steps for ${FIELD_EXAMPLES.tryoutName}`,
    );
    message.unmount();

    render(<CheckinWorkspace search={vi.fn()} onCheckIn={vi.fn()} />);
    expect(screen.getByRole('textbox', { name: 'Search registrations' })).toHaveAttribute(
      'placeholder',
      `${FIELD_EXAMPLES.athleteGivenName} ${FIELD_EXAMPLES.athleteFamilyName}`,
    );
    await waitFor(() => expect(requireCurrentOrganization).toHaveBeenCalled());
  });
});
