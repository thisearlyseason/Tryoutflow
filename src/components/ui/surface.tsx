import type { HTMLAttributes, ReactNode } from 'react';

export type SurfaceProps = HTMLAttributes<HTMLElement> & {
  as?: 'article' | 'aside' | 'div' | 'section';
  children: ReactNode;
  variant?: 'card' | 'inset' | 'metric' | 'decision';
};

const variantClasses: Record<NonNullable<SurfaceProps['variant']>, string> = {
  card: 'bg-[var(--color-surface)] shadow-[var(--shadow-card)]',
  inset: 'bg-[var(--color-surface-inset)]',
  metric: 'bg-[var(--color-surface-raised)] shadow-[var(--shadow-card)]',
  decision:
    'border-l-4 border-l-[var(--color-primary)] bg-[var(--color-surface)] shadow-[var(--shadow-card)]',
};

export function Surface({
  as: Component = 'div',
  className,
  variant = 'card',
  ...props
}: SurfaceProps) {
  return (
    <Component
      {...props}
      className={[
        'min-w-0 rounded-[var(--radius-surface)] border border-[var(--color-border)] p-5',
        variantClasses[variant],
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    />
  );
}
