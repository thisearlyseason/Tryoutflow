import type { ReactNode } from 'react';
import { ArrowUpRight, FolderOpen } from 'lucide-react';
import Link from 'next/link';

export function WorkspaceHeader({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <header className="talent-page-header">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="talent-description">{description}</p>
      </div>
      {children && <div className="talent-header-actions talent-no-print">{children}</div>}
    </header>
  );
}
export function WorkspaceStats({
  items,
}: {
  items: { label: string; value: number | string; detail?: string; href?: string }[];
}) {
  return (
    <div className="talent-summary" aria-label="Workspace summary">
      {items.map((item) => {
        const content = (
          <>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
            {item.detail && <small>{item.detail}</small>}
            {item.href && <ArrowUpRight size={16} aria-hidden="true" />}
          </>
        );
        return item.href ? (
          <Link key={item.label} href={item.href}>
            {content}
          </Link>
        ) : (
          <div key={item.label}>{content}</div>
        );
      })}
    </div>
  );
}
export function EmptyState({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="talent-empty-state">
      <span className="talent-empty-icon">
        <FolderOpen size={24} aria-hidden="true" />
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
      {children && <div className="talent-header-actions">{children}</div>}
    </div>
  );
}
export function SectionHeading({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div className="talent-section-heading">
      <div>
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {children && <div className="talent-header-actions">{children}</div>}
    </div>
  );
}
export function StatusPill({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'success' | 'warning' | 'info';
}) {
  return (
    <span className={`talent-status talent-status-${tone}`}>
      <span aria-hidden="true" />
      {children}
    </span>
  );
}
