import type { ReactNode } from 'react';

export type PageHeaderProps = {
  actions?: ReactNode;
  context?: ReactNode;
  description?: string;
  eyebrow?: string;
  title: string;
};

export function PageHeader({ actions, context, description, eyebrow, title }: PageHeaderProps) {
  return (
    <header className="page-header mb-2 grid min-w-0 gap-4 pb-2 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
      <div className="min-w-0">
        {context ? (
          <div className="mb-3 text-sm text-[var(--color-text-muted)]">{context}</div>
        ) : null}
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h1 className="m-0 text-balance">{title}</h1>
        {description ? (
          <p className="mt-2 mb-0 max-w-3xl text-sm text-[var(--color-text-muted)]">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2 lg:justify-end">{actions}</div> : null}
    </header>
  );
}
