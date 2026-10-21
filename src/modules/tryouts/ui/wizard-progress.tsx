import Link from 'next/link';

import { tryoutSetupSteps, type TryoutSetupStep } from '../application/save-tryout-setup-step';

const labels: Record<TryoutSetupStep, string> = {
  basics: 'Tryout details',
  divisions: 'Divisions',
  sessions: 'Sessions',
  registration: 'Registration',
  rubrics: 'Scoring criteria',
  review: 'Check setup',
  publish: 'Publish',
};

export function WizardProgress({
  completedSteps,
  currentStep,
  hrefBase,
}: {
  completedSteps: string[];
  currentStep: TryoutSetupStep;
  hrefBase: string;
}) {
  return (
    <nav aria-label="Tryout setup progress" className="wizard-progress overflow-x-auto pb-2">
      <p className="mb-2 text-sm font-bold">
        Step {tryoutSetupSteps.indexOf(currentStep) + 1} of {tryoutSetupSteps.length}:{' '}
        {labels[currentStep]}
      </p>
      <ol className="flex min-w-max gap-2">
        {tryoutSetupSteps.map((step, index) => {
          const complete = completedSteps.includes(step);
          const current = currentStep === step;
          return (
            <li key={step}>
              <Link
                aria-current={current ? 'step' : undefined}
                className={`inline-flex min-h-[var(--target-mobile)] items-center gap-2 rounded-[var(--radius-control)] px-3 text-sm font-bold ${
                  current
                    ? 'bg-[var(--color-primary)] text-[var(--color-primary-foreground)]'
                    : complete
                      ? 'bg-[var(--color-success-surface)] text-[var(--color-success)]'
                      : 'bg-[var(--color-surface-muted)] text-[var(--color-text)]'
                }`}
                href={`${hrefBase}/${step}`}
                prefetch={false}
              >
                <span aria-hidden="true">{complete ? '✓' : index + 1}</span>
                {labels[step]}
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
