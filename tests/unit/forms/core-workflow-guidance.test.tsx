import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { EffectiveEntitlements } from '../../../src/modules/subscriptions/domain/effective-entitlements';

const { requireCurrentOrganization, billingRpc, getUser, renderBoundary, authorizedUserId } =
  vi.hoisted(() => ({
    requireCurrentOrganization: vi.fn(),
    billingRpc: vi.fn(),
    getUser: vi.fn(),
    renderBoundary: vi.fn(),
    authorizedUserId: '10000000-0000-4000-8000-000000000003',
  }));

vi.mock('../../../src/modules/organizations/application/current-organization', () => ({
  requireCurrentOrganization,
}));

import NewTryoutPage from '../../../src/app/(app)/app/[organizationSlug]/tryouts/new/page';
import TryoutRegistrationPage from '../../../src/app/(app)/app/[organizationSlug]/tryouts/[tryoutId]/registration/page';
import SignUpPage from '../../../src/app/(auth)/sign-up/page';
vi.mock('../../../src/infrastructure/supabase/server', () => ({
  createServerSupabaseClient: async () => ({
    rpc: billingRpc,
    auth: {
      getUser,
    },
  }),
}));
vi.mock('../../../src/modules/identity/ui/private-session-boundary', () => ({
  PrivateSessionBoundary: ({ userId, children }: { userId: string; children: React.ReactNode }) => {
    expect(userId).toBe(authorizedUserId);
    expect(getUser).toHaveBeenCalled();
    renderBoundary(userId);
    return userId === authorizedUserId ? children : null;
  },
}));

import StartPage from '../../../src/app/(auth)/start/page';
import { RegistrationForm } from '../../../src/app/(registration)/register/[tryoutSlug]/registration-form';
import { FIELD_EXAMPLES } from '../../../src/components/forms/field-examples';
import { CheckinWorkspace } from '../../../src/modules/checkin/ui/checkin-workspace';
import { MessageComposer } from '../../../src/modules/communications/ui/message-composer';
import { InviteMemberForm } from '../../../src/modules/organizations/components/invite-member-form';
import { TryoutWizard } from '../../../src/modules/tryouts/ui/tryout-wizard';

const organizationId = '10000000-0000-4000-8000-000000000001';
const divisionId = '10000000-0000-4000-8000-000000000002';

function billingAccess(allowed: boolean): EffectiveEntitlements {
  return {
    organizationId,
    tryoutId: null,
    plan: allowed ? 'organization' : 'free',
    source: allowed ? 'manual' : 'free',
    features: { organization_management: allowed },
    limits: {
      active_tryouts: null,
      athletes_per_tryout: null,
      evaluators_per_tryout: null,
      custom_templates: null,
    },
    evaluatedAt: '2026-10-20T00:00:00.000Z',
    expiresAt: null,
  };
}

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
      sportDefaults: [] as string[],
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
                      {
                        key: 'medical_clearance_date',
                        label: 'Medical clearance date',
                        kind: 'date',
                        required: false,
                        sortOrder: 1,
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
    getUser.mockReset();
    getUser.mockResolvedValue({ data: { user: { id: authorizedUserId } }, error: null });
    renderBoundary.mockReset();
    billingRpc.mockReset();
    billingRpc.mockImplementation(async (name: string, args: unknown) => {
      expect(name).toBe('get_effective_entitlements');
      expect(args).toEqual({ p_organization_id: organizationId, p_tryout_id: undefined });
      return { data: billingAccess(true), error: null };
    });
    requireCurrentOrganization.mockImplementation(async () => currentOrganization());
  });

  it('uses catalog examples as non-submitted guidance during account and organization setup', async () => {
    const signUp = render(await SignUpPage({ searchParams: Promise.resolve({}) }));
    const signUpEmail = screen.getByRole('textbox', { name: 'Email' });
    expect(signUpEmail).toHaveAttribute('placeholder', FIELD_EXAMPLES.guardianEmail);
    expect(new FormData(signUpEmail.closest('form')!).get('email')).toBe('');
    signUp.unmount();

    const previousLookups = getUser.mock.calls.length;
    const startTree = await StartPage();
    expect(getUser).toHaveBeenCalledTimes(previousLookups + 1);
    const start = render(startTree);
    expect(renderBoundary).toHaveBeenCalledWith(authorizedUserId);
    expect(renderBoundary.mock.invocationCallOrder[0]).toBeGreaterThan(
      getUser.mock.invocationCallOrder[previousLookups]!,
    );
    const organizationName = screen.getByRole('textbox', { name: 'Organization name' });
    const timezone = screen.getByRole('combobox', { name: 'Timezone' });
    expect(organizationName).toHaveAttribute('placeholder', FIELD_EXAMPLES.organizationName);
    expect(screen.getByRole('textbox', { name: 'Workspace address' })).toHaveValue('');
    expect(screen.getByText(/not your public website/i)).toBeVisible();
    expect(timezone).toHaveAttribute('placeholder', FIELD_EXAMPLES.timezone);
    expect(timezone).toHaveAttribute('list', 'organization-timezone-options');
    expect(
      document.querySelector('#organization-timezone-options option[value="America/Edmonton"]'),
    ).not.toBeNull();
    expect(timezone).toHaveAttribute('aria-describedby', 'timezone-description');
    expect(screen.getByText(/start typing to search timezones/i)).toHaveAttribute(
      'id',
      'timezone-description',
    );
    const startData = new FormData(organizationName.closest('form')!);
    expect(startData.get('name')).toBe('');
    expect(startData.get('slug')).toBe('');
    expect(startData.get('timezone')).toBe(FIELD_EXAMPLES.timezone);
    start.unmount();
  });

  it('does not apply organization defaults without the exact organization-management entitlement', async () => {
    const current = currentOrganization();
    current.organization.sportDefaults = ['Paid organization default'];
    requireCurrentOrganization.mockResolvedValue(current);
    billingRpc.mockResolvedValue({ data: billingAccess(false), error: null });
    render(
      await NewTryoutPage({
        params: Promise.resolve({ organizationSlug: 'badlands-hockey-academy' }),
      }),
    );
    expect(billingRpc).toHaveBeenCalledWith('get_effective_entitlements', {
      p_organization_id: organizationId,
      p_tryout_id: undefined,
    });
    expect(screen.getByRole('textbox', { name: 'Sport' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: 'Sport' })).toHaveAttribute(
      'placeholder',
      FIELD_EXAMPLES.sport,
    );
  });

  it('guides draft creation and each wizard setup control without replacing saved values', async () => {
    const draft = render(
      await NewTryoutPage({
        params: Promise.resolve({ organizationSlug: 'badlands-hockey-academy' }),
      }),
    );
    expect(billingRpc).toHaveBeenCalledWith('get_effective_entitlements', {
      p_organization_id: organizationId,
      p_tryout_id: undefined,
    });
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
      'tryout-session-timezone-help',
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
    expect(screen.getByRole('textbox', { name: 'Category 1 name' })).toHaveAttribute(
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
    const staffDynamicDate = document.querySelector('[name="response.medical_clearance_date"]');
    expect(staffDynamicDate).not.toBeNull();
    expect(staffDynamicDate).toHaveAttribute(
      'aria-describedby',
      'staff-registration-response-medical_clearance_date-help',
    );
    expect(
      document.getElementById('staff-registration-response-medical_clearance_date-help'),
    ).toHaveTextContent('Example: September 15, 2012.');
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
                  {
                    key: 'medical_clearance_date',
                    label: 'Medical clearance date',
                    kind: 'date',
                    required: false,
                    sortOrder: 1,
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
    expect(screen.getByLabelText('Guardian name')).toHaveAttribute(
      'placeholder',
      FIELD_EXAMPLES.guardianName,
    );
    expect(screen.getByLabelText('Guardian email')).toHaveAttribute(
      'placeholder',
      FIELD_EXAMPLES.guardianEmail,
    );
    expect(screen.getByLabelText('Guardian phone')).toHaveAttribute(
      'placeholder',
      FIELD_EXAMPLES.guardianPhone,
    );
    expect(screen.getByLabelText('Division').querySelector('option[value=""]')).toBeDisabled();
    expect(screen.getByLabelText('Playing level').querySelector('option[value=""]')).toBeDisabled();
    const publicDynamicDate = screen.getByLabelText('Medical clearance date');
    expect(publicDynamicDate).toHaveAttribute(
      'aria-describedby',
      'public-registration-medical_clearance_date-help',
    );
    expect(
      document.getElementById('public-registration-medical_clearance_date-help'),
    ).toHaveTextContent('Example: September 15, 2012.');
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
