import type { HTMLAttributes } from 'react';

export type Status = 'callback' | 'complete' | 'in-progress' | 'selected' | 'waitlisted';

const statusLabels: Record<Status, string> = {
  callback: 'Callback',
  complete: 'Complete',
  'in-progress': 'In progress',
  selected: 'Selected',
  waitlisted: 'Waitlisted',
};

const statusClassNames: Record<Status, string> = {
  callback: 'bg-[var(--color-selection)] text-[var(--color-selection-foreground)]',
  complete: 'bg-[var(--color-performance)] text-[var(--color-performance-foreground)]',
  'in-progress': 'bg-[var(--color-primary)] text-[var(--color-primary-foreground)]',
  selected: 'bg-[var(--color-performance)] text-[var(--color-performance-foreground)]',
  waitlisted:
    'bg-[var(--color-surface-muted)] text-[var(--color-text)] ring-1 ring-inset ring-[var(--color-border)]',
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
