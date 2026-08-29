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
  name,
  step,
}: {
  action: (formData: FormData) => void | Promise<void>;
  blockers: string[];
  name: string;
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
        ) : (
          <p className="rounded-lg bg-[var(--color-surface-muted)] p-3 text-sm">
            Mark this step complete after saving its configuration. Your progress is saved and you
            can resume this draft from any device.
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
