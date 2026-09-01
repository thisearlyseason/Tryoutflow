import { forwardRef, type SelectHTMLAttributes } from 'react';

import { focusRingClassName } from './focus-ring';

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, ...props },
  ref,
) {
  return (
    <select
      {...props}
      ref={ref}
      className={[
        'min-h-[var(--target-mobile)] min-w-[var(--target-mobile)] w-full rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-[var(--color-text)] disabled:cursor-not-allowed disabled:opacity-55',
        focusRingClassName,
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    />
  );
});
