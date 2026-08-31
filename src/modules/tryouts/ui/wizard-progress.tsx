import Link from 'next/link';

import { tryoutSetupSteps, type TryoutSetupStep } from '../application/save-tryout-setup-step';

const labels: Record<TryoutSetupStep, string> = {
  basics: 'Basics',
  divisions: 'Divisions',
  sessions: 'Sessions',
  registration: 'Registration',
  rubrics: 'Rubrics',
  review: 'Review',
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
    <nav aria-label="Tryout setup progress" className="overflow-x-auto pb-2">
      <ol className="flex min-w-max gap-2">
        {tryoutSetupSteps.map((step, index) => {
          const complete = completedSteps.includes(step);
          const current = currentStep === step;
          return (
            <li key={step}>
              <Link
                aria-current={current ? 'step' : undefined}
                className={`inline-flex min-h-[var(--target-mobile)] items-center gap-2 rounded-full px-3 text-sm font-bold ${
                  current
                    ? 'bg-[var(--color-primary)] text-[var(--color-primary-foreground)]'
                    : complete
                      ? 'bg-[var(--color-performance)] text-[var(--color-performance-foreground)]'
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
