'use client';

import { DivisionEditor, SessionEditor, RubricEditor } from './setup-configuration-editor';
import type { SetupConfiguration } from '../domain/setup-configuration';
import Link from 'next/link';

import { useActionState, useState } from 'react';

import { FIELD_EXAMPLES } from '@/components/forms/field-examples';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import { RegistrationFormEditor, type EditableRegistrationForm } from './registration-form-editor';

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
  | { status: 'form_error'; message: string; values?: TryoutBasicsInput };

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
    description: 'Publish to open registration. You can continue editing setup afterward.',
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
  saved = false,
  registrationForm,
  configuration,
  addNewDivision = false,
  selectedId,
  status = 'draft',
  singleTryout = false,
  overviewHref,
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
  saved?: boolean;
  registrationForm?: EditableRegistrationForm;
  configuration?: SetupConfiguration;
  addNewDivision?: boolean;
  selectedId?: string;
  status?: string;
  singleTryout?: boolean;
  overviewHref?: string;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const [confirmation, setConfirmation] = useState('');
  const item = guidance[step];
  const published = status !== 'draft';
  const publishing = step === 'publish' && !published;
  const submittedValues = state.status === 'idle' ? undefined : state.values;
  const basicsValues = submittedValues ?? basics;
  const tryoutTimezone = basics?.timezone || FIELD_EXAMPLES.timezone;
  const fieldErrors = state.status === 'field_error' ? state.fieldErrors : {};
  const errorMessage =
    state.status === 'form_error'
      ? state.message
      : error
        ? ({
            confirmation_required: 'Type the exact tryout name to publish.',
            conflict: 'This tryout changed in another tab. Refresh and review it again.',
            subscription_required: 'An active subscription is required before publishing.',
            registration_closed: 'Set a future registration closing time before publishing.',
            rubric_invalid: 'Every session needs a valid 100-point rubric before publishing.',
            registration_form_missing: 'Create a registration form before publishing.',
            division_missing: 'Add at least one division before publishing.',
            session_missing: 'Add at least one session before publishing.',
            single_tryout_schedule_invalid:
              'Single Tryout sessions must fit within 14 days, with registration closing no later than the last session.',
          }[error] ?? 'Could not save this step')
        : null;
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
      className={`mt-6 min-w-0 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 sm:p-6 ${step === 'registration' ? 'w-full' : 'max-w-2xl'}`}
    >
      <p className="eyebrow">Setup step</p>
      <h2 id="wizard-step-heading">{item.title}</h2>
      <p className="mt-2 text-[var(--color-text-muted)]">
        {singleTryout && step === 'publish'
          ? 'Publishing fixes this event’s identity, divisions and dates. Finish the event before its Single Tryout editing deadline.'
          : item.description}
      </p>
      {errorMessage ? (
        <p className="mt-4 rounded-lg border border-[var(--color-destructive)] p-3" role="alert">
          {errorMessage}
        </p>
      ) : null}
      {saved ? (
        <p
          className="mt-4 rounded-lg border border-[var(--color-success)] p-3 text-[var(--color-success)]"
          role="status"
        >
          {step === 'divisions'
            ? 'Division saved. Add another or continue when ready.'
            : 'Changes saved.'}
        </p>
      ) : null}
      {!published && blockers.length > 0 && (step === 'review' || step === 'publish') ? (
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
        {step === 'publish' && published ? (
          <p>This tryout is {status}. Setup changes are saved without publishing again.</p>
        ) : publishing ? (
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
            <div className="rounded-lg bg-[var(--color-surface-muted)] p-3">
              <h3>Registration window</h3>
              <p>
                These dates control when athletes can register. Set the actual tryout event dates in
                Sessions.
              </p>
            </div>
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
          <DivisionEditor
            selectedId={selectedId}
            addNew={addNewDivision}
            divisions={configuration?.divisions ?? divisions}
          />
        ) : step === 'sessions' ? (
          <SessionEditor
            selectedId={selectedId}
            sessions={configuration?.sessions ?? []}
            divisions={divisions}
            positions={configuration?.positions ?? []}
            timezone={tryoutTimezone}
          />
        ) : step === 'registration' ? (
          <RegistrationFormEditor initial={registrationForm} />
        ) : step === 'rubrics' ? (
          <RubricEditor selectedId={selectedId} sessions={configuration?.sessions ?? []} />
        ) : step === 'review' ? (
          <div className="grid gap-4">
            <p className="text-sm text-[var(--color-text-muted)]">
              Review the saved setup below. Use the step links above to make changes.
            </p>
            <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 rounded-xl border border-[var(--color-border)] p-4 text-sm">
              <dt>Tryout</dt>
              <dd>{basicsValues?.name ?? name}</dd>
              <dt>Sport</dt>
              <dd>{basicsValues?.sport ?? 'Not set'}</dd>
              <dt>Timezone</dt>
              <dd>{basicsValues?.timezone ?? 'Not set'}</dd>
              <dt>Divisions</dt>
              <dd>{divisions.length || 'None saved'}</dd>
              <dt>Sessions</dt>
              <dd>{sessions.length || 'None saved'}</dd>
            </dl>
          </div>
        ) : (
          <p className="rounded-lg bg-[var(--color-surface-muted)] p-3 text-sm">
            This step is validated from saved configuration.
          </p>
        )}
        <div className="flex flex-wrap gap-3">
          {step === 'divisions' && divisions.length > 0 ? (
            <Button
              name="intent"
              value="continue-existing"
              formNoValidate
              disabled={pending}
              type="submit"
            >
              Continue with saved divisions
            </Button>
          ) : null}
          {step === 'divisions' ? (
            <Button
              name="intent"
              value="add-another"
              variant="secondary"
              disabled={pending}
              type="submit"
            >
              Save and add another
            </Button>
          ) : null}
          {published && (step === 'review' || step === 'publish') && overviewHref ? (
            <Link className="button-primary" href={overviewHref}>
              Return to tryout overview
            </Link>
          ) : (
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
                  : published
                    ? 'Save changes'
                    : 'Save and continue'}
            </Button>
          )}
        </div>
      </form>
    </section>
  );
}
