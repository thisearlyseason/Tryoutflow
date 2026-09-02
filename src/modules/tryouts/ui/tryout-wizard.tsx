'use client';

import { useActionState, useState } from 'react';

import { FIELD_EXAMPLES } from '@/components/forms/field-examples';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import type { TryoutSetupStep } from '../application/save-tryout-setup-step';
import type { TryoutBasicsField, TryoutBasicsInput } from '../application/validate-tryout-basics';
import type { TryoutBasicsValues } from './tryout-basics';

export type TryoutWizardActionState =
  | { status: 'idle' }
  | {
      status: 'field_error';
      fieldErrors: Partial<Record<TryoutBasicsField, string>>;
      values: TryoutBasicsInput;
    }
  | { status: 'form_error'; message: 'Could not save this step'; values?: TryoutBasicsInput };

const initialState: TryoutWizardActionState = { status: 'idle' };

const guidance: Record<TryoutSetupStep, { title: string; description: string }> = {
  basics: {
    title: 'Tryout basics',
    description: 'Confirm the name, sport, timezone, and registration window.',
  },
  divisions: {
    title: 'Divisions',
    description: 'Add at least one age, level, or organization-defined division.',
  },
  sessions: {
    title: 'Sessions',
    description: 'Create at least one session and attach it to a division.',
  },
  registration: {
    title: 'Registration form',
    description: 'Create the public form athletes and guardians will use.',
  },
  rubrics: {
    title: 'Evaluation rubrics',
    description: 'Attach one published, 100-point rubric to every session.',
  },
  review: {
    title: 'Review setup',
    description: 'Resolve every blocker before you publish this tryout.',
  },
  publish: {
    title: 'Publish tryout',
    description: 'Publishing locks the exact setup used for registration and scoring.',
  },
};

export function TryoutWizard({
  action,
  basics,
  blockers,
  divisions = [],
  error,
  name,
  sessions = [],
  step,
}: {
  action: (
    previousState: TryoutWizardActionState,
    formData: FormData,
  ) => Promise<TryoutWizardActionState>;
  basics?: TryoutBasicsValues;
  blockers: string[];
  divisions?: { id: string; name: string }[];
  error?: string;
  name: string;
  sessions?: { id: string; name: string }[];
  step: TryoutSetupStep;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const [confirmation, setConfirmation] = useState('');
  const item = guidance[step];
  const publishing = step === 'publish';
  const submittedValues = state.status === 'idle' ? undefined : state.values;
  const basicsValues = submittedValues ?? basics;
  const fieldErrors = state.status === 'field_error' ? state.fieldErrors : {};
  const errorMessage =
    state.status === 'form_error' ? state.message : error ? 'Could not save this step' : null;
  const fieldDescription = (field: TryoutBasicsField, helpId?: string) =>
    [
      helpId,
      fieldErrors[field]
        ? `tryout-basics-${field === 'registrationStartsAt' ? 'opens' : field === 'registrationEndsAt' ? 'closes' : field}-error`
        : undefined,
    ]
      .filter(Boolean)
      .join(' ') || undefined;
  const fieldError = (field: TryoutBasicsField, id: string) =>
    fieldErrors[field] ? (
      <span className="mt-1 block text-sm text-[var(--color-destructive)]" id={id}>
        {fieldErrors[field]}
      </span>
    ) : null;
  return (
    <section
      aria-labelledby="wizard-step-heading"
      className="mt-6 max-w-2xl rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 sm:p-6"
    >
      <p className="eyebrow">Setup step</p>
      <h2 id="wizard-step-heading">{item.title}</h2>
      <p className="mt-2 text-[var(--color-text-muted)]">{item.description}</p>
      {errorMessage ? (
        <p className="mt-4 rounded-lg border border-[var(--color-destructive)] p-3" role="alert">
          {errorMessage}
        </p>
      ) : null}
      {blockers.length > 0 && (step === 'review' || step === 'publish') ? (
        <div
          aria-live="polite"
          className="mt-5 rounded-lg border border-[var(--color-destructive)] p-4"
        >
          <h3>Publishing is blocked</h3>
          <ul className="mt-2 list-disc pl-5">
            {blockers.map((blocker) => (
              <li key={blocker}>{blocker.replaceAll('_', ' ')}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <form action={formAction} className="mt-6 space-y-4">
        <input name="step" type="hidden" value={step} />
        {publishing ? (
          <label className="block" htmlFor="publish-confirmation">
            <span className="font-bold">Type “{name}” to publish</span>
            <Input
              id="publish-confirmation"
              name="confirmation"
              onChange={(event) => setConfirmation(event.target.value)}
              value={confirmation}
            />
          </label>
        ) : step === 'basics' ? (
          <>
            <p className="text-sm font-bold text-[var(--color-text-muted)]">
              All fields are required.
            </p>
            <label className="block" htmlFor="tryout-basics-name">
              Tryout name
              <Input
                aria-describedby={fieldDescription('name')}
                aria-invalid={Boolean(fieldErrors.name) || undefined}
                defaultValue={basicsValues?.name ?? name}
                id="tryout-basics-name"
                maxLength={160}
                name="name"
                placeholder={basicsValues?.name || name ? undefined : FIELD_EXAMPLES.tryoutName}
                required
              />
              {fieldError('name', 'tryout-basics-name-error')}
            </label>
            <label className="block" htmlFor="tryout-basics-sport">
              Sport
              <Input
                aria-describedby={fieldDescription('sport')}
                aria-invalid={Boolean(fieldErrors.sport) || undefined}
                defaultValue={basicsValues?.sport}
                id="tryout-basics-sport"
                maxLength={80}
                name="sport"
                placeholder={basicsValues?.sport ? undefined : FIELD_EXAMPLES.sport}
                required
              />
              {fieldError('sport', 'tryout-basics-sport-error')}
            </label>
            <label className="block" htmlFor="tryout-basics-timezone">
              Timezone
              <Input
                aria-describedby={fieldDescription('timezone', 'tryout-basics-timezone-help')}
                aria-invalid={Boolean(fieldErrors.timezone) || undefined}
                defaultValue={basicsValues?.timezone}
                id="tryout-basics-timezone"
                maxLength={100}
                name="timezone"
                placeholder={basicsValues?.timezone ? undefined : FIELD_EXAMPLES.timezone}
                required
              />
              <span
                className="mt-1 block text-sm text-[var(--color-text-muted)]"
                id="tryout-basics-timezone-help"
              >
                Example: {FIELD_EXAMPLES.timezone}. Use the organization timezone for local times.
              </span>
              {fieldError('timezone', 'tryout-basics-timezone-error')}
            </label>
            <label className="block" htmlFor="tryout-basics-opens">
              Registration opens
              <Input
                aria-describedby={fieldDescription(
                  'registrationStartsAt',
                  'tryout-basics-opens-help',
                )}
                aria-invalid={Boolean(fieldErrors.registrationStartsAt) || undefined}
                defaultValue={basicsValues?.registrationStartsAt}
                id="tryout-basics-opens"
                name="registrationStartsAt"
                required
                type="datetime-local"
              />
              <span
                className="mt-1 block text-sm text-[var(--color-text-muted)]"
                id="tryout-basics-opens-help"
              >
                Example: September 15, 2026 at 6:00 PM in{' '}
                {basicsValues?.timezone || FIELD_EXAMPLES.timezone}.
              </span>
              {fieldError('registrationStartsAt', 'tryout-basics-opens-error')}
            </label>
            <label className="block" htmlFor="tryout-basics-closes">
              Registration closes
              <Input
                aria-describedby={fieldDescription(
                  'registrationEndsAt',
                  'tryout-basics-closes-help',
                )}
                aria-invalid={Boolean(fieldErrors.registrationEndsAt) || undefined}
                defaultValue={basicsValues?.registrationEndsAt}
                id="tryout-basics-closes"
                name="registrationEndsAt"
                required
                type="datetime-local"
              />
              <span
                className="mt-1 block text-sm text-[var(--color-text-muted)]"
                id="tryout-basics-closes-help"
              >
                Example: September 30, 2026 at 6:00 PM in{' '}
                {basicsValues?.timezone || FIELD_EXAMPLES.timezone}.
              </span>
              {fieldError('registrationEndsAt', 'tryout-basics-closes-error')}
            </label>
          </>
        ) : step === 'divisions' ? (
          <label className="block">
            Division name
            <Input name="name" placeholder={FIELD_EXAMPLES.division} required />
          </label>
        ) : step === 'sessions' ? (
          <>
            <label className="block">
              Division
              <select className="w-full" defaultValue="" name="divisionId" required>
                <option disabled value="">
                  Select a division
                </option>
                {divisions.map((division) => (
                  <option key={division.id} value={division.id}>
                    {division.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              Session name
              <Input name="name" placeholder={FIELD_EXAMPLES.session} required />
            </label>
            <label className="block">
              Starts
              <Input
                aria-describedby="tryout-session-starts-help"
                name="startsAt"
                required
                type="datetime-local"
              />
              <span
                className="mt-1 block text-sm text-[var(--color-text-muted)]"
                id="tryout-session-starts-help"
              >
                Example: September 15, 2026 at 6:00 PM in {FIELD_EXAMPLES.timezone}.
              </span>
            </label>
            <label className="block">
              Ends
              <Input
                aria-describedby="tryout-session-ends-help"
                name="endsAt"
                required
                type="datetime-local"
              />
              <span
                className="mt-1 block text-sm text-[var(--color-text-muted)]"
                id="tryout-session-ends-help"
              >
                Example: September 15, 2026 at 8:00 PM in {FIELD_EXAMPLES.timezone}.
              </span>
            </label>
            <label className="block">
              Group (optional)
              <Input name="groupName" placeholder={FIELD_EXAMPLES.group} />
            </label>
            <label className="block">
              Position (optional)
              <Input name="positionName" placeholder={FIELD_EXAMPLES.position} />
            </label>
          </>
        ) : step === 'registration' ? (
          <label className="block">
            Form name
            <Input name="name" placeholder={FIELD_EXAMPLES.registrationForm} required />
          </label>
        ) : step === 'rubrics' ? (
          <>
            <label className="block">
              Session
              <select className="w-full" defaultValue="" name="sessionId" required>
                <option disabled value="">
                  Select a session
                </option>
                {sessions.map((session) => (
                  <option key={session.id} value={session.id}>
                    {session.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              Rubric name
              <Input name="name" placeholder={FIELD_EXAMPLES.rubric} required />
            </label>
            <label className="block">
              Category name
              <Input
                name="categoryName"
                placeholder={FIELD_EXAMPLES.rubric.split(' and ')[0]}
                required
              />
            </label>
          </>
        ) : (
          <p className="rounded-lg bg-[var(--color-surface-muted)] p-3 text-sm">
            This step is validated from saved configuration.
          </p>
        )}
        <Button
          disabled={
            pending ||
            (publishing && (confirmation !== name || blockers.length > 0)) ||
            (!publishing && step === 'review' && blockers.length > 0)
          }
          type="submit"
        >
          {publishing
            ? 'Publish tryout'
            : step === 'review'
              ? 'Ready to publish'
              : 'Save and continue'}
        </Button>
      </form>
    </section>
  );
}
