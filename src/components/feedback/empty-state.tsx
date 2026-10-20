import type { ReactNode } from 'react';

export type EmptyStateProps = {
  action?: ReactNode;
  description?: string;
  title: string;
};

export function EmptyState({ action, description, title }: EmptyStateProps) {
  return (
    <section className="rounded-[var(--radius-surface)] border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-center shadow-[var(--shadow-surface)]">
      <h2 className="font-[var(--font-bib)] text-xl text-[var(--color-text)]">{title}</h2>
      {description ? (
        <p className="mt-2 text-sm text-[var(--color-text-muted)]">{description}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </section>
  );
}
