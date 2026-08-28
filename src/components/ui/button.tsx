import { forwardRef } from 'react';
import type { ButtonHTMLAttributes } from 'react';

import { focusRingClassName } from './focus-ring';

type ButtonVariant = 'primary' | 'secondary' | 'destructive';

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  busy?: boolean;
  variant?: ButtonVariant;
};

const variantClassNames: Record<ButtonVariant, string> = {
  primary: 'bg-[var(--color-primary)] text-[var(--color-primary-foreground)] hover:bg-[#0049d6]',
  secondary:
    'bg-[var(--color-surface)] text-[var(--color-text)] ring-1 ring-inset ring-[var(--color-border)] hover:bg-[var(--color-surface-muted)]',
  destructive:
    'bg-[var(--color-destructive)] text-[var(--color-destructive-foreground)] hover:bg-[#a52222]',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    busy = false,
    children,
    className,
    disabled = false,
    type = 'button',
    variant = 'primary',
    ...props
  },
  ref,
) {
  return (
    <button
      {...props}
      ref={ref}
      aria-busy={busy || undefined}
      className={[
        'inline-flex min-h-[var(--target-mobile)] min-w-[var(--target-mobile)] items-center justify-center rounded-[var(--radius-control)] px-4 py-2 text-sm font-bold tracking-wide transition-colors duration-[var(--duration-enter)] disabled:cursor-not-allowed disabled:opacity-55',
        focusRingClassName,
        variantClassNames[variant],
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      disabled={disabled || busy}
      type={type}
    >
      {children}
    </button>
  );
});
