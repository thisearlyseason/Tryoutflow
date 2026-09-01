import { forwardRef, type TextareaHTMLAttributes } from 'react';

import { focusRingClassName } from './focus-ring';

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, ...props },
  ref,
) {
  return (
    <textarea
      {...props}
      ref={ref}
      className={[
        'field-control min-h-[calc(var(--target-mobile)*2)] min-w-[var(--target-mobile)] w-full resize-y rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] disabled:cursor-not-allowed disabled:opacity-55',
        focusRingClassName,
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    />
  );
});
