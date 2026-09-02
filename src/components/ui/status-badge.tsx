import type { HTMLAttributes } from 'react';

export type Status =
  | 'callback'
  | 'complete'
  | 'draft'
  | 'failed'
  | 'finalized'
  | 'in-progress'
  | 'not-started'
  | 'published'
  | 'ready'
  | 'selected'
  | 'unavailable'
  | 'waitlisted'
  | 'warning';

const statusLabels: Record<Status, string> = {
  callback: 'Callback',
  complete: 'Complete',
  draft: 'Draft',
  failed: 'Failed',
  finalized: 'Finalized',
  'in-progress': 'In progress',
  'not-started': 'Not started',
  published: 'Published',
  ready: 'Ready',
  selected: 'Selected',
  unavailable: 'Unavailable',
  waitlisted: 'Waitlisted',
  warning: 'Warning',
};

const statusClassNames: Record<Status, string> = {
  callback: 'bg-[var(--color-selection)] text-[var(--color-selection-foreground)]',
  complete: 'bg-[var(--color-performance)] text-[var(--color-performance-foreground)]',
  draft:
    'bg-[var(--color-surface-muted)] text-[var(--color-text)] ring-1 ring-inset ring-[var(--color-border)]',
  failed: 'bg-[var(--color-destructive)] text-[var(--color-destructive-foreground)]',
  finalized: 'bg-[var(--color-text)] text-[var(--color-text-inverted)]',
  'in-progress': 'bg-[var(--color-primary)] text-[var(--color-primary-foreground)]',
  'not-started':
    'bg-[var(--color-surface-muted)] text-[var(--color-text)] ring-1 ring-inset ring-[var(--color-border)]',
  published: 'bg-[var(--color-primary)] text-[var(--color-primary-foreground)]',
  ready: 'bg-[var(--color-success-surface)] text-[var(--color-success)]',
  selected: 'bg-[var(--color-performance)] text-[var(--color-performance-foreground)]',
  unavailable:
    'bg-[var(--color-surface-muted)] text-[var(--color-text-muted)] ring-1 ring-inset ring-[var(--color-border)]',
  waitlisted:
    'bg-[var(--color-surface-muted)] text-[var(--color-text)] ring-1 ring-inset ring-[var(--color-border)]',
  warning: 'bg-[var(--color-warning-surface)] text-[var(--color-warning)]',
};

export type StatusBadgeProps = HTMLAttributes<HTMLSpanElement> & {
  status: Status;
};

export function StatusBadge({ children, className, status, ...props }: StatusBadgeProps) {
  return (
    <span
      {...props}
      className={[
        'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-bold tracking-wide',
        statusClassNames[status],
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      data-status={status}
    >
      {children ?? statusLabels[status]}
    </span>
  );
}
