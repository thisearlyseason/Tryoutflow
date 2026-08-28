import type { ReactNode } from 'react';

export type ErrorStateProps = {
  action?: ReactNode;
  description?: string;
  title: string;
};

export function ErrorState({ action, description, title }: ErrorStateProps) {
  return (
    <section
      aria-live="assertive"
      className="rounded-[var(--radius-surface)] border border-[var(--color-destructive)] bg-[var(--color-surface)] p-4 text-[var(--color-text)]"
      role="alert"
    >
      <h2 className="font-bold">{title}</h2>
      {description ? (
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">{description}</p>
      ) : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </section>
  );
}
