'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import type { TryoutSetupStep } from '../application/save-tryout-setup-step';

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
  blockers,
  divisions = [],
  error,
  name,
  sessions = [],
  step,
}: {
  action: (formData: FormData) => void | Promise<void>;
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
  return (
    <section
      aria-labelledby="wizard-step-heading"
      className="mt-6 max-w-2xl rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 sm:p-6"
    >
      <p className="eyebrow">Setup step</p>
      <h2 id="wizard-step-heading">{item.title}</h2>
      <p className="mt-2 text-[var(--color-text-muted)]">{item.description}</p>
      {error ? (
        <p className="mt-4 rounded-lg border border-[var(--color-destructive)] p-3" role="alert">
          Could not save this step: {error.replaceAll('_', ' ')}. Your progress was not advanced.
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
            <label className="block">
              Name
              <Input defaultValue={name} name="name" required />
            </label>
            <label className="block">
              Sport
              <Input name="sport" required />
            </label>
            <label className="block">
              Timezone
              <Input name="timezone" required />
            </label>
            <label className="block">
              Registration opens
              <Input name="registrationStartsAt" required type="datetime-local" />
            </label>
            <label className="block">
              Registration closes
              <Input name="registrationEndsAt" required type="datetime-local" />
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
