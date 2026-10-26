import Link from 'next/link';
import { ArrowRight, Building2, Plus } from 'lucide-react';
import type { ReactNode } from 'react';

import { Brand } from '@/components/ui/brand';

export function OrganizationEntryFrame({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <main className="organization-entry" id="main-content">
      <section className="organization-entry-panel" aria-labelledby="organization-entry-heading">
        <header className="organization-entry-brand brand-on-dark">
          <Brand compact />
          <div>
            <p>TryoutFlow</p>
            <span>Your workspace</span>
          </div>
        </header>
        <div className="organization-entry-content">
          <header className="organization-entry-intro">
            <p className="eyebrow">Welcome back</p>
            <h1 id="organization-entry-heading">{title}</h1>
            <p>{description}</p>
          </header>
          {children}
        </div>
      </section>
    </main>
  );
}

export function OrganizationEntry({
  organizations,
}: {
  organizations: readonly { id: string; name: string; slug: string }[];
}) {
  return (
    <OrganizationEntryFrame
      title="Choose your organization"
      description="Open your workspace to organize a tryout or score athletes."
    >
      <p className="organization-entry-label">Your organizations</p>
      <ul className="organization-entry-list">
        {organizations.map((organization) => (
          <li key={organization.id}>
            <Link
              className="organization-entry-choice"
              aria-label={`Open ${organization.name}`}
              href={`/app/${organization.slug}/home`}
              prefetch={false}
            >
              <span className="organization-entry-icon" aria-hidden="true">
                <Building2 size={24} />
              </span>
              <span className="organization-entry-details">
                <span className="organization-entry-name">{organization.name}</span>
                <span className="organization-entry-hint">Open workspace</span>
              </span>
              <ArrowRight className="organization-entry-arrow" size={20} aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
      <footer className="organization-entry-footer">
        <Link className="button-secondary" href="/start">
          <Plus size={18} aria-hidden="true" />
          Create another organization
        </Link>
      </footer>
    </OrganizationEntryFrame>
  );
}
