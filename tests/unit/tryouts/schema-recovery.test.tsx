import { installRecoveryLocks } from '../../helpers/recovery-lock';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, it, expect, vi } from 'vitest';
import { TryoutWizard } from '@/modules/tryouts/ui/tryout-wizard';
import { getBuiltInFields } from '@/modules/registration/domain/built-in-fields';
import {
  claimRecoveryOwner,
  writeRecovery,
  readRecovery,
  recoveryKey,
} from '@/modules/tryouts/ui/setup-recovery-store';
const navigation = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => navigation }));
const category = {
  name: 'Speed',
  weight: 100,
  scaleMin: 1 as const,
  scaleMax: 5 as const,
  description: 'Description '.repeat(60),
  guidance: 'Look for control',
  isPriority: true,
};
const configuration = {
  divisions: [{ id: 'd1', name: 'U15' }],
  positions: [],
  sessions: [
    {
      id: 's1',
      division_id: 'd1',
      name: 'Skills one',
      starts_at: '2026-11-20T16:00:00Z',
      ends_at: '2026-11-20T17:00:00Z',
      location: null,
      capacity: null,
      groups: [],
      rubric: {
        id: 'r1',
        name: 'Saved rubric',
        versionId: 'v1',
        categories: [
          { name: 'Saved category', weight: 100, scaleMin: 1 as const, scaleMax: 5 as const },
        ],
      },
    },
    {
      id: 's2',
      division_id: 'd1',
      name: 'Skills two',
      starts_at: '2026-11-20T17:00:00Z',
      ends_at: '2026-11-20T18:00:00Z',
      location: null,
      capacity: null,
      groups: [],
      rubric: null,
    },
  ],
};
const questions = [
  ...getBuiltInFields({}).map((field) => ({ type: 'builtIn', field })),
  {
    type: 'custom',
    field: {
      key: 'waiver_x',
      label: 'Unfinished waiver',
      kind: 'consent',
      required: true,
      sortOrder: 8,
      waiverText: 'Unfinished organizer wording. '.repeat(100),
    },
  },
];
const fields = {
  rubrics: {
    sessionId: 's1',
    name: 'Unfinished rubric',
    categories: JSON.stringify([category, { name: '', weight: 0, scaleMin: 1, scaleMax: 10 }]),
  },
  registration: { name: 'Unfinished form', questions: JSON.stringify(questions) },
};
const scope = (step: string) => ({
  userId: 'user',
  organizationId: 'org',
  form: `${step}:event`,
  baseline: '5',
});
function view(
  step: 'rubrics' | 'registration',
  action = vi.fn().mockResolvedValue({ status: 'form_error', message: 'Save failed' }),
) {
  return render(
    <TryoutWizard
      action={action}
      name="Event"
      blockers={[]}
      step={step}
      configuration={configuration}
      recovery={scope(step)}
      registrationForm={{ name: 'Saved form', fields: [], notificationEmail: 'saved@example.test' }}
    />,
  );
}
beforeEach(async () => {
  installRecoveryLocks();
  localStorage.clear();
  await claimRecoveryOwner('user');
  vi.clearAllMocks();
});
it('restores ordered rubric criteria, unfinished values and the session only by choice', async () => {
  writeRecovery(localStorage, scope('rubrics'), fields.rubrics, null);
  const action = vi.fn();
  view('rubrics', action);
  await screen.findByRole('button', { name: 'Resume recovery copy' });
  expect(screen.getByLabelText('Rubric name')).toHaveValue('Saved rubric');
  await userEvent.click(screen.getByRole('button', { name: 'Resume recovery copy' }));
  expect(screen.getByLabelText('Rubric name')).toHaveValue('Unfinished rubric');
  expect(screen.getByLabelText('Category 1 description (optional)')).toHaveValue(
    category.description,
  );
  expect(screen.getByLabelText('Priority category 1')).toBeChecked();
  expect(screen.getByLabelText('Category 2 name')).toHaveValue('');
  expect(screen.getByLabelText('Category 2 weight')).toHaveValue(0);
  expect(action).not.toHaveBeenCalled();
  await userEvent.selectOptions(screen.getByLabelText('Session'), 's2');
  expect(screen.getByLabelText('Rubric name')).toHaveValue('');
  expect(screen.queryByLabelText('Category 2 name')).toBeNull();
  await waitFor(() =>
    expect(readRecovery(localStorage, scope('rubrics'))).toMatchObject({
      record: { fields: { sessionId: 's2', name: '' } },
    }),
  );
});
it('blocks a rubric copy whose session was removed', async () => {
  writeRecovery(localStorage, scope('rubrics'), { ...fields.rubrics, sessionId: 'missing' }, null);
  view('rubrics');
  await screen.findByRole('button', { name: 'Discard recovery copy' });
  expect(screen.queryByRole('button', { name: 'Resume recovery copy' })).toBeNull();
});
it('restores registration configuration and waiver wording without restoring a notification destination', async () => {
  writeRecovery(
    localStorage,
    scope('registration'),
    { ...fields.registration, notificationEmail: 'private@example.test', accepted: 'true' },
    null,
  );
  view('registration');
  await screen.findByRole('button', { name: 'Resume recovery copy' });
  expect(screen.getByLabelText('Form name')).toHaveValue('Saved form');
  await userEvent.click(screen.getByRole('button', { name: 'Resume recovery copy' }));
  expect(screen.getByLabelText('Form name')).toHaveValue('Unfinished form');
  expect(screen.getByRole('textbox', { name: /Registration notification email/ })).toHaveValue(
    'saved@example.test',
  );
  await userEvent.click(screen.getByRole('button', { name: 'Edit Unfinished waiver' }));
  expect(screen.getByLabelText('Waiver wording')).toHaveValue(
    'Unfinished organizer wording. '.repeat(100),
  );
  expect(localStorage.getItem(recoveryKey(scope('registration')))).not.toContain(
    'private@example.test',
  );
  expect(screen.getByText(/Notification email is not included/)).toBeVisible();
});
it.each(['rubrics', 'registration'] as const)(
  'retains %s after failure and clears only confirmed saves',
  async (step) => {
    const candidate =
      step === 'rubrics'
        ? { ...fields.rubrics, categories: JSON.stringify([category]) }
        : fields.registration;
    writeRecovery(localStorage, scope(step), candidate, null);
    const action = vi
      .fn()
      .mockResolvedValueOnce({ status: 'form_error', message: 'Save failed' })
      .mockResolvedValueOnce({ status: 'saved', href: '/setup/review' });
    view(step, action);
    await userEvent.click(await screen.findByRole('button', { name: 'Resume recovery copy' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save and continue' }));
    await screen.findByText('Save failed');
    expect(localStorage.getItem(recoveryKey(scope(step)))).not.toBeNull();
    expect(screen.getByLabelText(step === 'rubrics' ? 'Rubric name' : 'Form name')).toHaveValue(
      candidate.name,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save and continue' }));
    await waitFor(() => expect(navigation.push).toHaveBeenCalled());
    expect(localStorage.getItem(recoveryKey(scope(step)))).toBeNull();
  },
);
it('rejects unknown nested properties, accepted consent and oversized configuration without truncation', () => {
  expect(writeRecovery(localStorage, scope('rubrics'), fields.rubrics, null).kind).toBe('saved');
  expect(readRecovery(localStorage, scope('rubrics'))).toMatchObject({
    record: { fields: fields.rubrics },
  });
  for (const categories of [
    JSON.stringify([{ ...category, password: 'secret' }]),
    JSON.stringify([{ ...category, guidance: 'x'.repeat(2001) }]),
  ])
    expect(
      writeRecovery(
        localStorage,
        { ...scope('rubrics'), form: 'rubrics:other' },
        { ...fields.rubrics, categories },
        null,
      ).kind,
    ).toBe('unavailable');
  expect(
    writeRecovery(
      localStorage,
      scope('registration'),
      {
        ...fields.registration,
        questions: JSON.stringify([{ ...questions.at(-1), accepted: true }]),
      },
      null,
    ).kind,
  ).toBe('unavailable');
});
it('restores question order and unfinished dropdown options without normalizing editor text', async () => {
  const ordered = [
    {
      type: 'custom',
      field: {
        key: 'options_x',
        label: 'Options draft',
        kind: 'select',
        required: false,
        sortOrder: 0,
        options: ['First', ''],
      },
    },
    ...questions.slice(0, 8),
  ];
  writeRecovery(
    localStorage,
    scope('registration'),
    { name: 'Ordered draft', questions: JSON.stringify(ordered) },
    null,
  );
  view('registration');
  await userEvent.click(await screen.findByRole('button', { name: 'Resume recovery copy' }));
  const list = screen.getByRole('list', { name: 'Registration questions' });
  expect(list.querySelector('li button[aria-label^="Edit"]')).toHaveAttribute(
    'aria-label',
    'Edit Options draft',
  );
  await userEvent.click(screen.getByRole('button', { name: 'Edit Options draft' }));
  expect(screen.getByLabelText('Options (one per line)')).toHaveValue('First\n');
});
it('rejects tampered stored nested data and protected identity changes', () => {
  const s = scope('rubrics');
  const saved = writeRecovery(localStorage, s, fields.rubrics, null);
  if (saved.kind !== 'saved') throw Error('missing');
  localStorage.setItem(
    recoveryKey(s),
    JSON.stringify({
      ...saved.record,
      fields: {
        ...saved.record.fields,
        categories: JSON.stringify([{ ...category, accepted: true }]),
      },
    }),
  );
  expect(readRecovery(localStorage, s).kind).toBe('none');
  const altered = questions.map((q) =>
    q.field.key === 'guardianEmail' ? { ...q, field: { ...q.field, required: false } } : q,
  );
  expect(
    writeRecovery(
      localStorage,
      scope('registration'),
      { name: 'Attempt', questions: JSON.stringify(altered) },
      null,
    ).kind,
  ).toBe('unavailable');
});
it('keeps a valid custom question named constructor when opening and saving configuration', () => {
  const initial = {
    name: 'Legacy form',
    fields: [
      {
        key: 'constructor',
        label: 'Coach notes',
        kind: 'text' as const,
        required: false,
        sortOrder: 0,
      },
    ],
  };
  const result = render(
    <TryoutWizard
      action={vi.fn()}
      name="Event"
      blockers={[]}
      step="registration"
      registrationForm={initial}
    />,
  );
  expect(screen.getByRole('button', { name: 'Edit Coach notes' })).toBeVisible();
  const form = result.container.querySelector('form')!;
  const schema = JSON.parse(String(new FormData(form).get('formSchema')));
  expect(schema.fields).toEqual([
    expect.objectContaining({ key: 'constructor', label: 'Coach notes' }),
  ]);
});
