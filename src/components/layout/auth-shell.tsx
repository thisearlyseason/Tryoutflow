import Link from 'next/link';
import type { ReactNode } from 'react';

const defaultProofItems = [
  'Registration and check-in',
  'Evidence-based evaluation',
  'Roster decisions and communication',
] as const;

export type AuthShellProps = {
  children: ReactNode;
  description: string;
  eyebrow?: string;
  footer?: ReactNode;
  proofItems?: readonly string[];
  title: string;
};

export function AuthShell({
  children,
  description,
  eyebrow = 'TryoutFlow',
  footer,
  proofItems = defaultProofItems,
  title,
}: AuthShellProps) {
  return (
    <main className="auth-page">
      <div className="auth-layout">
        <section aria-label="TryoutFlow product summary" className="auth-proof">
          <Link aria-label="TryoutFlow home" className="auth-brand" href="/">
            <span aria-hidden="true" className="auth-brand-mark">
              TF
            </span>
            <span>TryoutFlow</span>
          </Link>
          <div>
            <p className="auth-kicker">Built for the decision room</p>
            <h2>Move from first registration to final roster with evidence intact.</h2>
            <ul className="auth-proof-list">
              {proofItems.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
          <p className="auth-proof-note">Durable workflows. Human decisions.</p>
        </section>
        <section aria-labelledby="auth-heading" className="auth-card">
          <header>
            <p className="eyebrow">{eyebrow}</p>
            <h1 id="auth-heading">{title}</h1>
            <p className="auth-description">{description}</p>
          </header>
          <div className="auth-content">{children}</div>
          {footer ? <footer className="auth-footer">{footer}</footer> : null}
        </section>
      </div>
    </main>
  );
}
