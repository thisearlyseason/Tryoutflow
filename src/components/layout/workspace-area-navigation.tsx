'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  flattenNavigation,
  type NavigationGroup,
} from '@/modules/organizations/components/app-navigation-model';

/** Contextual discovery reuses authorized links; it never decides permission. */
export function WorkspaceAreaNavigation({ groups }: { groups: readonly NavigationGroup[] }) {
  const pathname = usePathname();
  const allItems = flattenNavigation(groups);
  const group = groups.find(
    (group) =>
      group.presentation === 'context' &&
      group.parentHref &&
      [group.parentHref, ...group.items.map((item) => item.href)].some(
        (href) => pathname === href || pathname.startsWith(`${href}/`),
      ),
  );
  if (!group) return null;
  const parent = allItems.find((item) => item.href === group.parentHref);
  const items = parent ? [parent, ...group.items] : group.items;
  return (
    <nav aria-label={group.label} className="workspace-area-navigation">
      {items.map((item) => (
        <Link
          href={item.href}
          key={item.href}
          prefetch={false}
          aria-current={pathname === item.href ? 'page' : undefined}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
