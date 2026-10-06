export const REGISTRATION_STEPS = [
  {
    title: 'Registration details',
    description: 'Complete the first set of registration fields.',
  },
  { title: 'Additional details', description: 'Complete the remaining tryout questions.' },
  { title: 'Review registration', description: 'Check each answer before submitting.' },
] as const;

export type RegistrationStepIndex = 0 | 1 | 2;

export type RegistrationReviewItem = {
  label: string;
  name: string;
  value: string;
};

export function RegistrationStepProgress({ currentStep }: { currentStep: RegistrationStepIndex }) {
  return (
    <nav aria-label="Registration progress" className="mt-6">
      <div className="flex items-center justify-between gap-4">
        <p className="m-0 text-sm font-bold text-[var(--color-primary)]">
          Step {currentStep + 1} of {REGISTRATION_STEPS.length}
        </p>
        <p className="m-0 text-sm text-[var(--color-text-muted)]">
          {REGISTRATION_STEPS[currentStep].title}
        </p>
      </div>
      <ol className="mt-3 grid grid-cols-3 gap-2" aria-hidden="true">
        {REGISTRATION_STEPS.map((step, index) => (
          <li
            key={step.title}
            className={`h-1.5 rounded-full ${index <= currentStep ? 'bg-[var(--color-primary)]' : 'bg-[var(--color-border)]'}`}
          />
        ))}
      </ol>
    </nav>
  );
}

export function RegistrationReview({
  headingRef,
  items,
}: {
  headingRef?: Ref<HTMLHeadingElement>;
  items: RegistrationReviewItem[];
}) {
  return (
    <section role="region" aria-label="Registration review" className="grid gap-5">
      <div>
        <p className="eyebrow">Final check</p>
        <h2
          ref={headingRef}
          id="registration-review-heading"
          className="mt-1 text-2xl font-bold"
          tabIndex={-1}
        >
          Review registration
        </h2>
        <p className="mt-2 text-sm text-[var(--color-text-muted)]">
          Confirm these details, then submit the registration.
        </p>
      </div>
      <dl className="divide-y divide-[var(--color-border)] rounded-[var(--radius-surface)] border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-4">
        {items.map((item) => (
          <div
            key={item.name}
            className="grid gap-1 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] sm:gap-5"
          >
            <dt className="text-sm font-semibold text-[var(--color-text-muted)]">{item.label}</dt>
            <dd className="m-0 break-words text-sm font-semibold text-[var(--color-text)]">
              {item.value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
import type { Ref } from 'react';
