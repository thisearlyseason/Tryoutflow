'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { NavigationGroup } from '@/modules/organizations/components/app-navigation-model';
import type { SelectedEventOption } from '@/modules/organizations/components/selected-event';
import { workspaceReturnDestination } from './workspace-return-destination';

export function WorkspaceReturn({
  groups,
  events,
}: {
  groups: readonly NavigationGroup[];
  events: readonly SelectedEventOption[];
}) {
  const destination = workspaceReturnDestination(usePathname(), groups, events);
  if (!destination) return null;
  return (
    <nav aria-label="Return navigation" className="mb-4">
      <Link
        className="button-quiet inline-flex min-h-11 items-center"
        href={destination.href}
        prefetch={false}
      >
        ← {destination.label}
      </Link>
    </nav>
  );
}
