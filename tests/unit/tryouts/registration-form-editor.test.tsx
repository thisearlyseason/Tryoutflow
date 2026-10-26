import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TryoutWizard } from '../../../src/modules/tryouts/ui/tryout-wizard';
import { RegistrationFormEditor } from '../../../src/modules/tryouts/ui/registration-form-editor';

describe('registration form editor', () => {
  it('edits custom fields and persists their order and options in submitted schema', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <form>
        <RegistrationFormEditor />
      </form>,
    );
    await user.click(screen.getByRole('button', { name: 'Add field' }));
    const label = screen.getByLabelText('Field label');
    await user.clear(label);
    await user.type(label, 'Jersey size');
    await user.selectOptions(screen.getByLabelText('Field type'), 'select');
    await user.type(screen.getByLabelText('Options (one per line)'), 'Small\nMedium\nLarge');
    await user.click(screen.getByRole('button', { name: 'Move Jersey size up' }));
    const submitted = JSON.parse(
      String(new FormData(container.querySelector('form')!).get('formSchema')),
    );
    expect(submitted.fields[0]).toMatchObject({
      label: 'Jersey size',
      kind: 'select',
      options: ['Small', 'Medium', 'Large'],
      sortOrder: 8,
    });
    expect(submitted.fields[1].label).toBe('Waiver and consent');
  });
  it('excludes built-in identity aliases from editable fields when loading old forms', () => {
    render(
      <RegistrationFormEditor
        initial={{
          name: 'Legacy',
          fields: [
            {
              key: 'custom_birth_date',
              label: 'Date of birth',
              kind: 'date',
              required: true,
              sortOrder: 0,
            },
          ],
        }}
      />,
    );
    expect(screen.queryByDisplayValue('Date of birth')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit Date of birth' })).toBeInTheDocument();
  });
});

it('preserves attempted form name and destination when a save returns an error', async () => {
  const user = userEvent.setup();
  render(
    <TryoutWizard
      step="registration"
      name="Camp"
      blockers={[]}
      registrationForm={{ name: 'Saved form', fields: [], notificationEmail: 'old@example.test' }}
      action={async () => ({ status: 'form_error', message: 'Save unavailable' })}
    />,
  );
  const name = screen.getByRole('textbox', { name: 'Form name' });
  const email = screen.getByRole('textbox', { name: /Registration notification email/ });
  await user.clear(name);
  await user.type(name, 'Attempted form');
  await user.clear(email);
  await user.type(email, 'new@example.test');
  await user.click(screen.getByRole('button', { name: 'Save and continue' }));
  await screen.findByText('Save unavailable');
  expect(name).toHaveValue('Attempted form');
  expect(email).toHaveValue('new@example.test');
});

it('adds an editable waiver starter, previews wording and saves it with the form', async () => {
  const user = userEvent.setup();
  const { container } = render(
    <form>
      <RegistrationFormEditor initial={{ name: 'Camp', fields: [] }} />
    </form>,
  );
  await user.click(screen.getByRole('button', { name: 'Add waiver' }));
  const wording = screen.getByRole('textbox', { name: 'Waiver wording' });
  expect((wording as HTMLTextAreaElement).value).toContain('physical activity');
  await user.clear(wording);
  await user.type(wording, 'Our participation terms.');
  expect(container.querySelector('.whitespace-pre-wrap')).toHaveTextContent(
    'Our participation terms.',
  );
  const schema = JSON.parse(
    String(new FormData(container.querySelector('form')!).get('formSchema')),
  );
  expect(schema.fields[0]).toMatchObject({
    kind: 'consent',
    required: true,
    waiverText: 'Our participation terms.',
  });
  await user.selectOptions(screen.getByLabelText('Field type'), 'text');
  expect(
    JSON.parse(String(new FormData(container.querySelector('form')!).get('formSchema'))).fields[0],
  ).not.toHaveProperty('waiverText');
});

function submittedSchema(container: HTMLElement) {
  return JSON.parse(String(new FormData(container.querySelector('form')!).get('formSchema')));
}

it('edits optional built-in labels and visibility while protecting required identity', async () => {
  const user = userEvent.setup();
  const { container } = render(
    <form>
      <RegistrationFormEditor initial={{ name: 'Camp', fields: [] }} />
    </form>,
  );
  await user.click(screen.getByRole('button', { name: 'Edit Date of birth' }));
  await user.clear(screen.getByLabelText('Field label'));
  await user.type(screen.getByLabelText('Field label'), 'Birthday');
  await user.click(screen.getByRole('checkbox', { name: 'Require Birthday' }));
  await user.click(screen.getByRole('checkbox', { name: 'Show Birthday' }));
  expect(
    submittedSchema(container).builtInFields.find(
      (field: { key: string }) => field.key === 'birthDate',
    ),
  ).toMatchObject({ label: 'Birthday', enabled: false });
  expect(screen.getByRole('checkbox', { name: 'Require Birthday' })).toBeDisabled();
  await user.click(screen.getByRole('checkbox', { name: 'Show Birthday' }));
  expect(
    submittedSchema(container).builtInFields.find(
      (field: { key: string }) => field.key === 'birthDate',
    ),
  ).toMatchObject({ enabled: true });
  await user.click(screen.getByRole('button', { name: 'Edit Guardian email' }));
  expect(screen.getByRole('checkbox', { name: 'Show Guardian email' })).toBeDisabled();
  expect(screen.getByRole('checkbox', { name: 'Require Guardian email' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Remove Guardian email' })).toBeDisabled();
});

it('removes and restores optional built-in questions and deletes custom questions', async () => {
  const user = userEvent.setup();
  const { container } = render(
    <form>
      <RegistrationFormEditor />
    </form>,
  );
  await user.click(screen.getByRole('button', { name: 'Edit Guardian phone' }));
  await user.click(screen.getByRole('button', { name: 'Remove Guardian phone' }));
  expect(
    submittedSchema(container).builtInFields.some(
      (field: { key: string }) => field.key === 'guardianPhone',
    ),
  ).toBe(false);
  await user.selectOptions(screen.getByLabelText('Add built-in question'), 'guardianPhone');
  await user.click(screen.getByRole('button', { name: 'Add built-in' }));
  expect(
    submittedSchema(container).builtInFields.find(
      (field: { key: string }) => field.key === 'guardianPhone',
    ),
  ).toMatchObject({ enabled: true });
  await user.click(screen.getByRole('button', { name: 'Edit Waiver and consent' }));
  await user.click(screen.getByRole('button', { name: 'Remove Waiver and consent' }));
  expect(submittedSchema(container).fields).toEqual([]);
});

it('keeps the question list compact and persists a combined built-in and custom order', async () => {
  const user = userEvent.setup();
  const { container } = render(
    <form>
      <RegistrationFormEditor />
    </form>,
  );
  const list = screen.getByRole('list', { name: 'Registration questions' });
  expect(list.querySelector('textarea')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Move Waiver and consent up' }));
  const schema = submittedSchema(container);
  expect(schema.fields[0].sortOrder).toBe(7);
  expect(
    schema.builtInFields.find((field: { key: string }) => field.key === 'guardianEmail').sortOrder,
  ).toBe(8);
  await user.click(screen.getByRole('button', { name: 'Edit Waiver and consent' }));
  await user.click(screen.getByRole('checkbox', { name: 'Show Waiver and consent' }));
  expect(submittedSchema(container).fields[0]).toMatchObject({
    enabled: false,
    waiverText: expect.any(String),
  });
});

it('reloads saved mixed ordering and keeps hidden questions editable', async () => {
  const user = userEvent.setup();
  const { container, unmount } = render(
    <form>
      <RegistrationFormEditor />
    </form>,
  );
  await user.click(screen.getByRole('button', { name: 'Move Waiver and consent up' }));
  await user.click(screen.getByRole('button', { name: 'Edit Waiver and consent' }));
  await user.click(screen.getByRole('checkbox', { name: 'Show Waiver and consent' }));
  await user.click(screen.getByRole('button', { name: 'Edit Guardian phone' }));
  await user.click(screen.getByRole('button', { name: 'Remove Guardian phone' }));
  const saved = submittedSchema(container);
  unmount();
  const { container: reloaded } = render(
    <form>
      <RegistrationFormEditor initial={{ name: 'Saved', ...saved }} />
    </form>,
  );
  expect(submittedSchema(reloaded)).toEqual(saved);
  expect(screen.queryByRole('button', { name: 'Edit Guardian phone' })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Edit Waiver and consent' }));
  expect(screen.getByRole('checkbox', { name: 'Show Waiver and consent' })).not.toBeChecked();
  expect(
    (screen.getByRole('textbox', { name: 'Waiver wording' }) as HTMLTextAreaElement).value,
  ).toContain('physical activity');
  await user.click(screen.getByRole('checkbox', { name: 'Show Waiver and consent' }));
  expect(submittedSchema(reloaded).fields[0].enabled).toBe(true);
});

it('preserves question edits and ordering when saving fails', async () => {
  const user = userEvent.setup();
  const { container } = render(
    <TryoutWizard
      step="registration"
      name="Camp"
      blockers={[]}
      registrationForm={{ name: 'Saved', fields: [] }}
      action={async () => ({ status: 'form_error', message: 'Save unavailable' })}
    />,
  );
  await user.click(screen.getByRole('button', { name: 'Edit Guardian phone' }));
  await user.clear(screen.getByLabelText('Field label'));
  await user.type(screen.getByLabelText('Field label'), 'Contact phone');
  await user.click(screen.getByRole('checkbox', { name: 'Show Contact phone' }));
  await user.click(screen.getByRole('button', { name: 'Move Contact phone down' }));
  const attempted = submittedSchema(container);
  await user.click(screen.getByRole('button', { name: 'Save and continue' }));
  await screen.findByText('Save unavailable');
  expect(submittedSchema(container)).toEqual(attempted);
  expect(screen.getByLabelText('Field label')).toHaveValue('Contact phone');
});

it.each([{ mobile: true }, { mobile: false }])(
  'scrolls selected question settings into view only on mobile (mobile=$mobile)',
  async ({ mobile }) => {
    const user = userEvent.setup();
    const originalScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
    const scrolledElements: HTMLElement[] = [];
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: function (this: HTMLElement) {
        scrolledElements.push(this);
      },
    });
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(max-width: 1279px)' && mobile,
    }));
    try {
      render(<RegistrationFormEditor />);
      await user.click(screen.getByRole('button', { name: 'Edit Date of birth' }));
      const settings = screen.getByRole('group', { name: 'Edit question' });
      expect(scrolledElements).toEqual(mobile ? [settings] : []);
      await user.click(screen.getByRole('button', { name: 'Edit Guardian email' }));
      expect(scrolledElements).toEqual(mobile ? [settings, settings] : []);
    } finally {
      vi.unstubAllGlobals();
      if (originalScroll)
        Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScroll);
      else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
    }
  },
);
