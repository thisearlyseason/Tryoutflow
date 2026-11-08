import type { ReactNode } from 'react';
import { PrivateSessionBoundary } from '@/modules/identity/ui/private-session-boundary';
import { requireParticipantContext } from '@/modules/registration/application/participant-context';
import { FamilyPortalNavigation } from '@/modules/registration/ui/family-portal-navigation';

export default async function ParticipantLayout({ children }: { children: ReactNode }) {
  const { user } = await requireParticipantContext();
  return (
    <PrivateSessionBoundary userId={user.id}>
      <div className="family-portal-shell">
        <a className="workspace-skip-link" href="#participant-main">
          Skip to content
        </a>
        <FamilyPortalNavigation />
        <main id="participant-main" tabIndex={-1}>
          {children}
        </main>
      </div>
    </PrivateSessionBoundary>
  );
}
