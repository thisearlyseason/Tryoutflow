import {
  SelectedEvent,
  type SelectedEventOption,
} from '../../modules/organizations/components/selected-event';
import { Suspense, type ReactNode } from 'react';

import { AppTopbar } from './app-topbar';
import { AppNavigation } from './app-navigation';
import type { NavigationGroup } from '../../modules/organizations/components/app-navigation-model';

export type AppShellProps = {
  children: ReactNode;
  mode?: 'lab' | 'game-day';
  navigation?: ReactNode | readonly NavigationGroup[];
  organization?: Readonly<{ name: string; slug: string; logoUrl?: string }>;
  roleLabel?: string;
  events?: readonly SelectedEventOption[];
  eventStorageKey?: string;
};

export function AppShell({
  children,
  mode = 'lab',
  navigation,
  organization,
  roleLabel,
  events = [],
  eventStorageKey = 'tryoutflow.selected-event',
}: AppShellProps) {
  const groupedNavigation = Array.isArray(navigation)
    ? (navigation as readonly NavigationGroup[])
    : null;
  if (!groupedNavigation || !organization || !roleLabel) {
    return (
      <div className="app-frame">
        <main className="app-main" id="main-content">
          {children}
        </main>
        {navigation as ReactNode}
      </div>
    );
  }
  return (
    <div
      className={
        mode === 'game-day'
          ? 'app-frame app-frame-workspace theme-game-day'
          : 'app-frame app-frame-workspace'
      }
    >
      <AppNavigation groups={groupedNavigation} organization={organization} roleLabel={roleLabel} />
      <div className="app-content">
        <AppTopbar groups={groupedNavigation} organization={organization} roleLabel={roleLabel} />
        <main className="app-main" id="main-content">
          <Suspense fallback={null}>
            <SelectedEvent events={events} storageKey={eventStorageKey} />
          </Suspense>
          {children}
        </main>
      </div>
    </div>
  );
}
