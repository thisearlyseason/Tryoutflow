import { focusRingClassName } from './focus-ring';
export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'destructive';
const variantClassNames: Record<ButtonVariant, string> = {
  primary: 'button-primary hover:bg-[var(--color-primary-hover)]',
  secondary: 'button-secondary hover:bg-[var(--color-surface-muted)]',
  quiet: 'button-quiet hover:bg-[var(--color-surface-muted)]',
  destructive: 'button-destructive hover:brightness-90',
};

export function buttonClassName(variant: ButtonVariant, className?: string) {
  return [
    'min-h-[var(--target-mobile)] min-w-[var(--target-mobile)] transition-colors duration-[var(--duration-enter)] disabled:cursor-not-allowed disabled:opacity-55',
    focusRingClassName,
    variantClassNames[variant],
    className,
  ]
    .filter(Boolean)
    .join(' ');
}
