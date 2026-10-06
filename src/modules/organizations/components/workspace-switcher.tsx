'use client';
import { useRouter } from 'next/navigation';
import type { WorkspaceNavigation } from '../application/team-workspaces';

export function WorkspaceSwitcher({
  currentId,
  navigation,
}: {
  currentId: string;
  navigation: WorkspaceNavigation;
}) {
  const router = useRouter();
  if (!navigation.isTeam && navigation.workspaces.length < 2) return null;
  return (
    <nav
      aria-label="Workspace switcher"
      style={{ minHeight: 0, display: 'flex' }}
      className="workspace-card mb-5 flex flex-wrap items-center justify-between gap-3 !p-4"
    >
      <div>
        <p className="eyebrow">{navigation.isTeam ? 'Team workspace' : 'Organization workspace'}</p>
        {navigation.parent ? (
          <p className="text-sm text-[var(--color-text-muted)]">Part of {navigation.parent.name}</p>
        ) : null}
      </div>
      <label className="grid min-w-0 max-w-full gap-1 text-sm font-bold">
        Switch workspace
        <select
          className="min-h-11 max-w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3"
          value={currentId}
          onChange={(event) => {
            const workspace = navigation.workspaces.find((item) => item.id === event.target.value);
            if (workspace) router.push(`/app/${encodeURIComponent(workspace.slug)}/home`);
          }}
        >
          {navigation.workspaces.map((workspace) => (
            <option key={workspace.id} value={workspace.id}>
              {workspace.name}
              {workspace.isTeam ? '' : ' · Organization'}
            </option>
          ))}
        </select>
      </label>
    </nav>
  );
}
