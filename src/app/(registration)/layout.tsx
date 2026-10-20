import Link from 'next/link';
import type { ReactNode } from 'react';

import { Brand } from '../../components/ui/brand';

export default function RegistrationLayout({ children }: { children: ReactNode }) {
  return (
    <div className="public-registration-shell">
      <header className="public-registration-brandbar">
        <Link prefetch={false} href="/" aria-label="TryoutFlow home">
          <Brand />
        </Link>
        <span>Plan. Run. Evaluate.</span>
      </header>
      {children}
      <footer className="public-registration-footer">
        <p>Built for a stronger tomorrow.</p>
        <nav aria-label="Registration legal links">
          <Link prefetch={false} href="/privacy">
            Privacy
          </Link>
          <Link prefetch={false} href="/terms">
            Terms
          </Link>
        </nav>
      </footer>
    </div>
  );
}
