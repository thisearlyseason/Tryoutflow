import type { ReactNode } from 'react';

export type WorkspaceStateVariant =
  'empty' | 'unavailable' | 'denied' | 'conflict' | 'offline' | 'pending' | 'success';

export type WorkspaceStateProps = {
  action?: ReactNode;
  description?: string;
  title: string;
  variant: WorkspaceStateVariant;
};

const variantClasses: Record<WorkspaceStateVariant, string> = {
  empty: 'border-dashed',
  unavailable: 'border-[var(--color-warning)] bg-[var(--color-warning-surface)]',
  denied: 'border-[var(--color-destructive)] bg-[var(--color-destructive-surface)]',
  conflict: 'border-[var(--color-selection)] bg-[var(--color-warning-surface)]',
  offline: 'border-[var(--color-border-strong)] bg-[var(--color-surface-inset)]',
  pending: 'border-[var(--color-primary)] bg-[var(--color-info-surface)]',
  success: 'border-[var(--color-success)] bg-[var(--color-success-surface)]',
};

export function WorkspaceState({ action, description, title, variant }: WorkspaceStateProps) {
  const role = ['unavailable', 'denied', 'conflict'].includes(variant) ? 'alert' : 'status';
  return (
    <section
      aria-live={role === 'alert' ? 'assertive' : 'polite'}
      className={`workspace-state ${variantClasses[variant]}`}
      data-state={variant}
      role={role}
    >
      <h2 className="text-lg">{title}</h2>
      {description ? (
        <p className="mt-2 text-sm text-[var(--color-text-muted)]">{description}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </section>
  );
}
