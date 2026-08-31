import type { OnboardingProgress } from '../application/onboarding-progress';

export function OnboardingChecklist({ progress }: { progress: OnboardingProgress }) {
  return (
    <section
      aria-labelledby="onboarding-heading"
      className="rounded-[var(--radius-card)] bg-[var(--color-surface)] p-6 shadow-[var(--shadow-card)]"
    >
      <p className="eyebrow">Getting started</p>
      <h2 id="onboarding-heading">Your tryout operations checklist</h2>
      <div
        aria-label="Onboarding progress"
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={progress.percent}
        className="mt-4 h-2 overflow-hidden rounded-full bg-[var(--color-border)]"
        role="progressbar"
      >
        <div
          className="h-full bg-[var(--color-accent)]"
          style={{ width: `${progress.percent}%` }}
        />
      </div>
      <p className="mt-2 text-sm text-[var(--color-text-muted)]">
        {progress.completedCount} of {progress.totalCount} complete
      </p>
      <ol className="mt-5 grid gap-2">
        {progress.items.map((item) => (
          <li
            className="flex min-h-11 items-center justify-between gap-3 rounded-[var(--radius-surface)] border border-[var(--color-border)] px-4 py-2"
            key={item.key}
          >
            <span>{item.label}</span>
            <span className="text-sm font-semibold">
              {item.complete ? 'Complete' : 'Not complete'}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
