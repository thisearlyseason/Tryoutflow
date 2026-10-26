import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RegistrationForm } from '../../../src/app/(registration)/register/[tryoutSlug]/registration-form';

const configuration = {
  organization: {
    name: 'Badlands Hockey Academy',
    logoUrl: '/api/organizations/badlands-hockey-academy/logo',
  },
  tryout: {
    name: 'U15 Fall Evaluations',
    slug: 'fall-camp',
    formSchema: { fields: [] },
    divisions: [],
    positions: [],
  },
};

function fillVisibleIdentity() {
  for (const [name, value] of Object.entries({
    givenName: 'Jordan',
    familyName: 'Lee',
    birthDate: '2012-05-15',
    guardianName: 'Taylor Lee',
    guardianEmail: 'guardian@example.test',
  })) {
    const input = document.querySelector(`input[name="${name}"]`);
    if (input) fireEvent.change(input, { target: { value } });
  }
}

describe('public registration branding', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify(configuration), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
  });

  it('renders the published organization identity before the tryout name', async () => {
    const { container } = render(
      <RegistrationForm tryoutSlug="fall-camp" deterministicBotToken="verified-token" />,
    );

    const organizationName = await screen.findByText('Badlands Hockey Academy');
    const tryoutHeading = screen.getByRole('heading', {
      name: 'Register for U15 Fall Evaluations',
    });
    const mark = container.querySelector<HTMLImageElement>('.registration-header img');

    expect(mark).toHaveAttribute(
      'src',
      expect.stringContaining('/api/organizations/badlands-hockey-academy/logo'),
    );
    expect(mark).toHaveAttribute('alt', '');
    expect(mark).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByRole('img', { name: /Badlands Hockey Academy/iu })).toBeNull();
    expect(
      organizationName.compareDocumentPosition(tryoutHeading) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('replaces an unavailable public logo with the TF mark without retrying it', async () => {
    const { container } = render(
      <RegistrationForm tryoutSlug="fall-camp" deterministicBotToken="verified-token" />,
    );

    await screen.findByText('Badlands Hockey Academy');
    const mark = container.querySelector<HTMLImageElement>('.registration-header img');
    if (!mark) throw new Error('expected decorative organization logo');
    fireEvent.error(mark);

    const fallback = container.querySelector('.registration-header [aria-hidden="true"]');
    expect(fallback).toHaveTextContent('TF');
    expect(fallback).not.toHaveAttribute('role');
    expect(container.querySelector('.registration-header img')).toBeNull();
    expect(screen.queryByRole('img', { name: /Badlands Hockey Academy/iu })).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('renders the TF mark immediately when the organization has no logo URL', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ...configuration,
          organization: { name: configuration.organization.name },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const { container } = render(
      <RegistrationForm tryoutSlug="fall-camp" deterministicBotToken="verified-token" />,
    );

    await screen.findByText('Badlands Hockey Academy');
    const fallback = container.querySelector('.registration-header [aria-hidden="true"]');
    expect(fallback).toHaveTextContent('TF');
    expect(fallback).not.toHaveAttribute('role');
    expect(screen.queryByRole('img', { name: /Badlands Hockey Academy/iu })).toBeNull();
  });
});

it('renders legacy identity fields once and refreshes the consumed token after failure', async () => {
  const fields = [
    {
      key: 'custom_birth_date',
      label: 'Date of birth',
      kind: 'date',
      required: true,
      sortOrder: 0,
    },
    {
      key: 'custom_guardian_email',
      label: 'Parent or guardian email',
      kind: 'email',
      required: true,
      sortOrder: 1,
    },
  ];
  const requests: Record<string, unknown>[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url, options) => {
      if (options?.method === 'POST') {
        requests.push(JSON.parse(String(options.body)));
        return new Response('{}', { status: 400 });
      }
      return new Response(
        JSON.stringify({
          ...configuration,
          tryout: { ...configuration.tryout, formSchema: { fields } },
        }),
      );
    }),
  );
  const { container } = render(
    <RegistrationForm
      tryoutSlug="retry-test"
      deterministicBotToken="tryoutflow-deterministic-bot-token-v1:initial"
    />,
  );
  await screen.findByRole('heading', { name: /Register for/ });
  expect(screen.getAllByLabelText('Date of birth')).toHaveLength(1);
  expect(screen.queryByLabelText('Parent or guardian email')).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Date of birth'), { target: { value: '2012-05-15' } });
  fireEvent.change(screen.getByLabelText('Guardian email'), {
    target: { value: 'guardian@example.test' },
  });
  const form = container.querySelector('form')!;
  fillVisibleIdentity();
  fireEvent.submit(form);
  await screen.findByRole('alert');
  fireEvent.submit(form);
  await screen.findByRole('alert');
  expect(requests).toHaveLength(2);
  expect(requests[0]?.botVerificationToken).not.toEqual(requests[1]?.botVerificationToken);
  expect(requests[0]?.idempotencyKey).toEqual(requests[1]?.idempotencyKey);
  expect((requests[0]?.submission as { responses: unknown }).responses).toEqual({
    custom_birth_date: '2012-05-15',
    custom_guardian_email: 'guardian@example.test',
  });
});

it('allows a negative checkbox answer while requiring affirmative consent', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ...configuration,
            tryout: {
              ...configuration.tryout,
              formSchema: {
                fields: [
                  {
                    key: 'prior_experience',
                    label: 'Prior experience',
                    kind: 'checkbox',
                    required: true,
                    sortOrder: 0,
                  },
                  { key: 'waiver', label: 'Waiver', kind: 'consent', required: true, sortOrder: 1 },
                ],
              },
            },
          }),
        ),
    ),
  );
  render(<RegistrationForm tryoutSlug="checkbox-test" deterministicBotToken="verified-token" />);
  expect(await screen.findByLabelText('Prior experience')).not.toBeRequired();
  expect(screen.getByLabelText('Waiver')).toBeRequired();
});

it.each([
  ['scheduled', 'Registration opens September 17, 2026'],
  ['closed', 'Registration closed'],
] as const)(
  'explains %s using the saved registration dates and timezone',
  async (outcome, heading) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            outcome,
            registrationWindow: {
              name: 'U15',
              organizationName: 'Badlands',
              timezone: 'America/Edmonton',
              opensAt: '2026-09-17T18:51:00+00:00',
              closesAt: '2026-09-19T18:51:00+00:00',
            },
          }),
          { status: 200 },
        ),
      ),
    );
    render(<RegistrationForm tryoutSlug="u15" />);
    expect(await screen.findByRole('heading', { name: heading })).toBeVisible();
    expect(screen.getByText(/12:51 PM/)).toBeVisible();
    expect(
      screen.queryByRole('heading', { name: 'Registration unavailable' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /submit registration/i })).not.toBeInTheDocument();
  },
);

it('displays the saved waiver and binds acceptance to the loaded version, requiring review after changes', async () => {
  const requests: Record<string, unknown>[] = [];
  const wording = 'Visible participation terms. <script>neverExecute()</script>';
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url, options) => {
      if (options?.method === 'POST') {
        requests.push(JSON.parse(String(options.body)));
        return new Response(JSON.stringify({ outcome: 'form_changed' }), { status: 409 });
      }
      return new Response(
        JSON.stringify({
          ...configuration,
          tryout: {
            ...configuration.tryout,
            formVersionId: 'f1151010-1010-4010-8010-101010101010',
            formSchema: {
              fields: [
                {
                  key: 'waiver',
                  label: 'Participation waiver',
                  kind: 'consent',
                  required: true,
                  sortOrder: 0,
                  waiverText: wording,
                },
              ],
            },
          },
        }),
      );
    }),
  );
  const { container } = render(
    <RegistrationForm tryoutSlug="waiver-test" deterministicBotToken="verified-token" />,
  );
  await screen.findByRole('heading', { name: /Register for/ });
  fillVisibleIdentity();
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  expect(await screen.findByText(wording)).toBeVisible();
  expect(container.querySelector('script')).toBeNull();
  const consent = screen.getByLabelText('Participation waiver');
  expect(consent).not.toBeChecked();
  fireEvent.click(consent);
  fireEvent.submit(container.querySelector('form')!);
  await screen.findByRole('button', { name: 'Reload form' });
  expect(screen.getByRole('alert')).toHaveTextContent(/review the current terms/i);
  expect(screen.getByRole('button', { name: 'Submit registration' })).toBeDisabled();
  expect(requests[0]).toMatchObject({
    formVersionId: 'f1151010-1010-4010-8010-101010101010',
    submission: { responses: { waiver: true } },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Reload form' }));
  expect(await screen.findByLabelText('Participation waiver')).not.toBeChecked();
});

it('uses the saved built-in labels, order, visibility and requirements and omits hidden answers', async () => {
  const { DEFAULT_BUILT_IN_FIELDS } =
    await import('../../../src/modules/registration/domain/built-in-fields');
  const requests: Record<string, unknown>[] = [];
  const schema = {
    builtInFields: DEFAULT_BUILT_IN_FIELDS.map((field) => ({
      ...field,
      label: field.key === 'guardianEmail' ? 'Contact email' : field.label,
      enabled: !['birthDate', 'guardianName', 'guardianPhone', 'positionId', 'divisionId'].includes(
        field.key,
      ),
      sortOrder: field.key === 'guardianEmail' ? 0 : field.sortOrder + 1,
    })),
    fields: [
      {
        key: 'hidden_question',
        kind: 'text',
        label: 'Hidden question',
        enabled: false,
        required: true,
        sortOrder: 10,
      },
      {
        key: 'visible_question',
        kind: 'text',
        label: 'Visible question',
        enabled: true,
        required: false,
        sortOrder: 11,
      },
    ],
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url, options) => {
      if (options?.method === 'POST') {
        requests.push(JSON.parse(String(options.body)));
        return new Response('{}', { status: 400 });
      }
      return new Response(
        JSON.stringify({
          ...configuration,
          tryout: { ...configuration.tryout, formSchema: schema },
        }),
      );
    }),
  );
  const { container } = render(
    <RegistrationForm tryoutSlug="configured" deterministicBotToken="verified-token" />,
  );
  const email = await screen.findByRole('textbox', { name: 'Contact email' });
  expect(screen.queryByRole('textbox', { name: 'Date of birth' })).toBeNull();
  expect(screen.queryByRole('textbox', { name: 'Guardian name' })).toBeNull();
  expect(screen.queryByRole('textbox', { name: 'Hidden question' })).toBeNull();
  expect(screen.getByLabelText('Visible question')).not.toBeRequired();
  expect(container.querySelector('form input')).toBe(email);
  fillVisibleIdentity();
  fireEvent.submit(container.querySelector('form')!);
  await screen.findByRole('alert');
  const submission = requests[0]?.submission as Record<string, unknown>;
  expect(submission).not.toHaveProperty('birthDate');
  expect(submission).not.toHaveProperty('guardianName');
  expect(submission.responses).not.toHaveProperty('hidden_question');
});

it('highlights all missing fields and blocks an enabled waiver even when its saved required flag is false', async () => {
  const requests: unknown[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url, options) => {
      if (options?.method === 'POST') {
        requests.push(JSON.parse(String(options.body)));
        return new Response('{}', { status: 400 });
      }
      return new Response(
        JSON.stringify({
          ...configuration,
          tryout: {
            ...configuration.tryout,
            formSchema: {
              builtInFields: [
                {
                  key: 'givenName',
                  label: 'Athlete first name',
                  enabled: true,
                  required: true,
                  sortOrder: 0,
                },
                {
                  key: 'familyName',
                  label: 'Athlete last name',
                  enabled: true,
                  required: true,
                  sortOrder: 1,
                },
                {
                  key: 'guardianEmail',
                  label: 'Contact email',
                  enabled: true,
                  required: true,
                  sortOrder: 2,
                },
              ],
              fields: [
                {
                  key: 'waiver',
                  label: 'Participation waiver',
                  kind: 'consent',
                  enabled: true,
                  required: false,
                  sortOrder: 3,
                  waiverText: 'Please review these terms.',
                },
              ],
            },
          },
        }),
      );
    }),
  );
  const { container } = render(
    <RegistrationForm tryoutSlug="validation" deterministicBotToken="verified-token" />,
  );
  const first = await screen.findByRole('textbox', { name: 'Athlete first name' });
  const last = screen.getByRole('textbox', { name: 'Athlete last name' });
  const email = screen.getByLabelText('Contact email');
  const waiver = screen.getByLabelText('Participation waiver');
  fireEvent.submit(container.querySelector('form')!);
  expect(requests).toHaveLength(0);
  for (const control of [first, last, email, waiver])
    expect(control).toHaveAttribute('aria-invalid', 'true');
  expect(first).toHaveFocus();
  fireEvent.change(first, { target: { value: 'Jordan' } });
  fireEvent.change(last, { target: { value: 'Lee' } });
  fireEvent.change(email, { target: { value: 'invalid' } });
  expect(first).not.toHaveAttribute('aria-invalid', 'true');
  expect(email).toHaveAttribute('aria-invalid', 'true');
  fireEvent.change(email, { target: { value: 'guardian@example.test' } });
  fireEvent.submit(container.querySelector('form')!);
  expect(requests).toHaveLength(0);
  expect(waiver).toHaveFocus();
  expect(waiver).toHaveAccessibleDescription('Please accept the waiver to continue.');
  fireEvent.click(waiver);
  expect(waiver).not.toHaveAttribute('aria-invalid', 'true');
  fireEvent.submit(container.querySelector('form')!);
  await screen.findByText('Please review the required fields and try again.');
  expect(requests).toHaveLength(1);
});
