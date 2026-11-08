import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, it, expect, vi } from 'vitest';
import { RegistrationForm } from '@/app/(registration)/register/[tryoutSlug]/registration-form';
import { getOrderedRegistrationFields } from '@/modules/registration/domain/built-in-fields';
import { validateRegistrationResponses } from '@/modules/registration/application/register-athlete';
import { registrationFieldErrors } from '@/modules/registration/ui/registration-field-errors';
import type { RegistrationFormSchema } from '@/modules/registration/domain/form-schema';
const builtInFields = [
  { key: 'givenName' as const, label: 'First name', enabled: true, required: true, sortOrder: 0 },
  { key: 'familyName' as const, label: 'Last name', enabled: true, required: true, sortOrder: 1 },
  {
    key: 'guardianEmail' as const,
    label: 'Contact email',
    enabled: true,
    required: true,
    sortOrder: 2,
  },
];
const schema: RegistrationFormSchema = {
  builtInFields,
  fields: [
    { key: 'constructor', label: 'Coach notes', kind: 'text', required: true, sortOrder: 3 },
    {
      key: 'waiver',
      label: 'Participation waiver',
      kind: 'consent',
      required: true,
      sortOrder: 4,
      waiverText: 'QA terms.',
    },
  ],
};
const config = {
  organization: { name: 'QA Club' },
  tryout: {
    name: 'QA Camp',
    formVersionId: 'v1',
    divisions: [],
    positions: [],
    formSchema: schema,
  },
};
let request: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
  localStorage.clear();
  request = vi.fn(
    async (_url: string, init?: RequestInit) =>
      new Response(JSON.stringify(init?.method === 'POST' ? {} : config), {
        status: init?.method === 'POST' ? 503 : 200,
      }),
  );
  vi.stubGlobal('fetch', request);
});
function input(name: string) {
  return document.querySelector<HTMLInputElement>(`[name="${name}"]`)!;
}
async function mount() {
  render(<RegistrationForm tryoutSlug="camp" deterministicBotToken="qa-token" />);
  await screen.findByRole('heading', { name: 'Registration details' });
  await waitFor(() => expect(input('givenName')).toBeEnabled());
}
async function review() {
  for (const [key, value] of Object.entries({
    givenName: 'Jordan',
    familyName: 'Lee',
    guardianEmail: 'guardian@example.test',
  }))
    fireEvent.change(input(key), { target: { value } });
  await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
  fireEvent.change(input('constructor'), { target: { value: 'Keep this answer' } });
  fireEvent.click(input('waiver'));
  await userEvent.click(screen.getByRole('button', { name: 'Continue to review' }));
}
it('keeps constructor as an ordinary question and optional missing response rather than an inherited value', () => {
  expect(getOrderedRegistrationFields(schema).map((row) => row.field.key)).toContain('constructor');
  expect(
    validateRegistrationResponses(
      {},
      {
        fields: [
          { key: 'constructor', label: 'Notes', kind: 'text', required: false, sortOrder: 0 },
        ],
      },
    ),
  ).toEqual({});
  expect(
    validateRegistrationResponses(
      { constructor: 'Keep this' },
      {
        fields: [
          { key: 'constructor', label: 'Notes', kind: 'text', required: true, sortOrder: 0 },
        ],
      },
    ),
  ).toEqual({ constructor: 'Keep this' });
});
it('shows and submits constructor answers without inherited error state', async () => {
  await mount();
  expect(input('constructor')).not.toBeNull();
  await review();
  expect(screen.getByText('Keep this answer')).toBeVisible();
  expect(input('constructor')).not.toHaveAttribute('aria-invalid', 'true');
  await userEvent.click(screen.getByRole('button', { name: 'Submit registration' }));
  await screen.findByRole('alert');
  const post = request.mock.calls.find(([, init]) => init?.method === 'POST')!;
  expect(JSON.parse(post[1]!.body as string).submission.responses.constructor).toBe(
    'Keep this answer',
  );
});
it('matches shared contact/date/length rules without rejecting a custom future date', () => {
  const formSchema: RegistrationFormSchema = {
    fields: [
      { key: 'notes', label: 'Notes', kind: 'text', required: false, sortOrder: 0 },
      { key: 'appointment', label: 'Date', kind: 'date', required: false, sortOrder: 1 },
    ],
  };
  const v = render(
    <form>
      <input name="givenName" defaultValue={'x'.repeat(121)} required />
      <input name="guardianPhone" type="tel" defaultValue="abc" />
      <input name="guardianEmail" type="email" defaultValue="a@b" required />
      <input name="birthDate" type="date" defaultValue="9999-01-01" />
      <input name="notes" defaultValue={'x'.repeat(501)} />
      <input name="appointment" type="date" defaultValue="9999-01-01" />
    </form>,
  );
  const errors = registrationFieldErrors(v.container.querySelector('form')!, formSchema);
  expect(errors).toMatchObject({
    givenName: 'Use 120 characters or fewer.',
    guardianPhone: 'Enter a phone number with 7 to 15 digits.',
    guardianEmail: 'Enter a valid email address.',
    birthDate: 'Enter a date of birth that is today or earlier.',
    notes: 'Use 500 characters or fewer.',
  });
  expect(errors).not.toHaveProperty('appointment');
});
it('keeps optional blanks valid, uses canonical whitespace and counts Unicode code points', () => {
  const formSchema: RegistrationFormSchema = {
    fields: [{ key: 'notes', label: 'Notes', kind: 'text', required: true, sortOrder: 0 }],
  };
  const v = render(
    <form>
      <input name="givenName" defaultValue={'😀'.repeat(120)} required />
      <input name="guardianPhone" type="tel" defaultValue="" />
      <input name="notes" defaultValue={'\u0085'} required />
    </form>,
  );
  const errors = registrationFieldErrors(v.container.querySelector('form')!, formSchema);
  expect(errors).not.toHaveProperty('givenName');
  expect(errors).not.toHaveProperty('guardianPhone');
  expect(errors.notes).toBe('This field is required.');
});
it('focuses each submission failure after controls unlock and retains entries and retry key', async () => {
  await mount();
  await review();
  await userEvent.click(screen.getByRole('button', { name: 'Submit registration' }));
  const alert = await screen.findByRole('alert');
  await waitFor(() => expect(alert).toHaveFocus());
  expect(alert).toHaveTextContent(/could not confirm/);
  expect(input('constructor').value).toBe('Keep this answer');
  const key = sessionStorage.getItem('tryoutflow:registration:camp:idempotency');
  expect(key).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: 'Submit registration' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveFocus());
  expect(sessionStorage.getItem('tryoutflow:registration:camp:idempotency')).toBe(key);
});
it('gives generic400 guidance that includes the security check without claiming a specific field failed', async () => {
  request.mockImplementation(
    async (_url: string, init?: RequestInit) =>
      new Response(JSON.stringify(init?.method === 'POST' ? {} : config), {
        status: init?.method === 'POST' ? 400 : 200,
      }),
  );
  await mount();
  await review();
  await userEvent.click(screen.getByRole('button', { name: 'Submit registration' }));
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent(/could not be verified/);
  expect(alert).toHaveTextContent(/security check/);
});
it('blocks invalid phone and future birth date in their own steps with field focus and no POST', async () => {
  const extended = {
    ...config,
    tryout: {
      ...config.tryout,
      formSchema: {
        builtInFields: [
          ...builtInFields,
          { key: 'guardianPhone', label: 'Phone', enabled: true, required: false, sortOrder: 3 },
          { key: 'birthDate', label: 'Date of birth', enabled: true, required: true, sortOrder: 4 },
        ],
        fields: schema.fields.map((field, index) => ({ ...field, sortOrder: index + 5 })),
      },
    },
  };
  request.mockImplementation(async () => new Response(JSON.stringify(extended), { status: 200 }));
  await mount();
  for (const [key, value] of Object.entries({
    givenName: 'Jordan',
    familyName: 'Lee',
    guardianEmail: 'guardian@example.test',
    guardianPhone: 'abc',
  }))
    fireEvent.change(input(key), { target: { value } });
  await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
  expect(input('guardianPhone')).toHaveFocus();
  expect(screen.getByText('Enter a phone number with 7 to 15 digits.')).toBeVisible();
  fireEvent.change(input('guardianPhone'), { target: { value: '555-0100' } });
  await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
  fireEvent.change(input('birthDate'), { target: { value: '9999-01-01' } });
  fireEvent.change(input('constructor'), { target: { value: 'Notes' } });
  fireEvent.click(input('waiver'));
  await userEvent.click(screen.getByRole('button', { name: 'Continue to review' }));
  expect(input('birthDate')).toHaveFocus();
  expect(screen.getByText('Enter a date of birth that is today or earlier.')).toBeVisible();
  expect(request.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
});
it('retains legacy identity aliases while exposing unrelated ordinary custom keys', () => {
  const legacy: RegistrationFormSchema = {
    fields: [
      {
        key: 'custom_guardian_email',
        label: 'Legacy email',
        kind: 'email',
        required: true,
        sortOrder: 0,
      },
      { key: 'constructor', label: 'Notes', kind: 'text', required: false, sortOrder: 1 },
    ],
  };
  const keys = getOrderedRegistrationFields(legacy).map((row) => row.field.key);
  expect(keys).not.toContain('custom_guardian_email');
  expect(keys).toContain('guardianEmail');
  expect(keys).toContain('constructor');
});
