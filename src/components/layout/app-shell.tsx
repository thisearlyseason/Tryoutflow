import type { ReactNode } from 'react';

import { AppNavigation } from './app-navigation';
import type { NavigationGroup } from '../../modules/organizations/components/app-navigation-model';

export type AppShellProps = {
  children: ReactNode;
  mode?: 'lab' | 'game-day';
  navigation?: ReactNode | readonly NavigationGroup[];
  organization?: Readonly<{ name: string; slug: string }>;
  roleLabel?: string;
};

export function AppShell({
  children,
  mode = 'lab',
  navigation,
  organization,
  roleLabel,
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
    <div className={mode === 'game-day' ? 'app-frame theme-game-day' : 'app-frame'}>
      <AppNavigation groups={groupedNavigation} organization={organization} roleLabel={roleLabel} />
      <main className="app-main" id="main-content">
        {children}
      </main>
    </div>
  );
}
