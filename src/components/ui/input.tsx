import { forwardRef } from 'react';
import type { InputHTMLAttributes } from 'react';

import { focusRingClassName } from './focus-ring';

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, ...props },
  ref,
) {
  return (
    <input
      {...props}
      ref={ref}
      className={[
        'field-control min-h-[var(--target-mobile)] min-w-[var(--target-mobile)] w-full rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] disabled:cursor-not-allowed disabled:opacity-55',
        focusRingClassName,
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    />
  );
});
