import type { ReactNode } from 'react';

import { AppShell } from '@/components/layout/app-shell';
import { requirePlatformRouteContext } from '@/modules/observability/application/platform-route-context';
import { PlatformNavigation } from '@/modules/observability/ui/platform-administration';

export default async function PlatformLayout({ children }: { children: ReactNode }) {
  await requirePlatformRouteContext();
  return (
    <AppShell navigation={<PlatformNavigation />}>
      <header className="mb-6">
        <p className="eyebrow">Restricted operations</p>
        <h1>Platform administration</h1>
      </header>
      {children}
    </AppShell>
  );
}
