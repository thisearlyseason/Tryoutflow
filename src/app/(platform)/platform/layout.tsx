import type { ReactNode } from 'react';

import { requirePlatformRouteContext } from '@/modules/observability/application/platform-route-context';
import { PlatformNavigation } from '@/modules/observability/ui/platform-administration';

export default async function PlatformLayout({ children }: { children: ReactNode }) {
  await requirePlatformRouteContext();
  return (
    <div className="min-h-screen bg-[var(--color-canvas)] md:grid md:grid-cols-[15rem_minmax(0,1fr)]">
      <aside className="min-w-0 border-b border-[var(--color-border)] md:border-r md:border-b-0">
        <PlatformNavigation />
      </aside>
      <main id="main-content" className="min-w-0 p-4 [overflow-wrap:anywhere] sm:p-8">
        <header className="mb-6">
          <p className="eyebrow">Restricted operations</p>
          <h1>Platform administration</h1>
        </header>
        {children}
      </main>
    </div>
  );
}
