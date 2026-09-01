'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import type { TryoutSetupStep } from '../application/save-tryout-setup-step';
import type { TryoutBasicsValues } from './tryout-basics';

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
  action: (formData: FormData) => void | Promise<void>;
  basics?: TryoutBasicsValues;
  blockers: string[];
  divisions?: { id: string; name: string }[];
  error?: string;
  name: string;
  sessions?: { id: string; name: string }[];
  step: TryoutSetupStep;
}) {
  const [confirmation, setConfirmation] = useState('');
  const item = guidance[step];
  const publishing = step === 'publish';
  const errorMessage =
    step === 'basics' && error === 'invalid_input'
      ? 'Check the highlighted fields. Sport and timezone are required, and registration must close after it opens.'
      : error === 'invalid_time_range'
        ? 'Registration must close after it opens.'
        : error
          ? `Could not save this step: ${error.replaceAll('_', ' ')}. Your progress was not advanced.`
          : null;
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
      <form action={action} className="mt-6 space-y-4">
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
                defaultValue={basics?.name ?? name}
                id="tryout-basics-name"
                maxLength={160}
                name="name"
                required
              />
            </label>
            <label className="block" htmlFor="tryout-basics-sport">
              Sport
              <Input
                defaultValue={basics?.sport}
                id="tryout-basics-sport"
                maxLength={80}
                name="sport"
                required
              />
            </label>
            <label className="block" htmlFor="tryout-basics-timezone">
              Timezone
              <Input
                aria-describedby="tryout-basics-timezone-help"
                defaultValue={basics?.timezone}
                id="tryout-basics-timezone"
                maxLength={100}
                name="timezone"
                required
              />
              <span
                className="mt-1 block text-sm text-[var(--color-text-muted)]"
                id="tryout-basics-timezone-help"
              >
                Use an IANA timezone such as America/Edmonton.
              </span>
            </label>
            <label className="block" htmlFor="tryout-basics-opens">
              Registration opens
              <Input
                defaultValue={basics?.registrationStartsAt}
                id="tryout-basics-opens"
                name="registrationStartsAt"
                required
                type="datetime-local"
              />
            </label>
            <label className="block" htmlFor="tryout-basics-closes">
              Registration closes
              <Input
                defaultValue={basics?.registrationEndsAt}
                id="tryout-basics-closes"
                name="registrationEndsAt"
                required
                type="datetime-local"
              />
            </label>
          </>
        ) : step === 'divisions' ? (
          <label className="block">
            Division name
            <Input name="name" required />
          </label>
        ) : step === 'sessions' ? (
          <>
            <label className="block">
              Division
              <select className="w-full" name="divisionId" required>
                {divisions.map((division) => (
                  <option key={division.id} value={division.id}>
                    {division.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              Session name
              <Input name="name" required />
            </label>
            <label className="block">
              Starts
              <Input name="startsAt" required type="datetime-local" />
            </label>
            <label className="block">
              Ends
              <Input name="endsAt" required type="datetime-local" />
            </label>
            <label className="block">
              Group (optional)
              <Input name="groupName" />
            </label>
            <label className="block">
              Position (optional)
              <Input name="positionName" />
            </label>
          </>
        ) : step === 'registration' ? (
          <label className="block">
            Form name
            <Input name="name" required />
          </label>
        ) : step === 'rubrics' ? (
          <>
            <label className="block">
              Session
              <select className="w-full" name="sessionId" required>
                {sessions.map((session) => (
                  <option key={session.id} value={session.id}>
                    {session.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              Rubric name
              <Input name="name" required />
            </label>
            <label className="block">
              Category name
              <Input name="categoryName" required />
            </label>
          </>
        ) : (
          <p className="rounded-lg bg-[var(--color-surface-muted)] p-3 text-sm">
            This step is validated from saved configuration.
          </p>
        )}
        <Button
          disabled={
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
