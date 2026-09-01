'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { MobileNav } from './mobile-nav';
import type {
  NavigationGroup,
  NavigationIcon,
  NavigationItem,
} from '../../modules/organizations/components/app-navigation-model';

const iconLabels: Record<NavigationIcon, string> = {
  home: '01',
  tryouts: '02',
  athletes: '03',
  evaluate: '04',
  reports: '05',
  organization: '06',
};

export function isNavigationItemActive(pathname: string, item: NavigationItem) {
  return pathname === item.href || (item.label !== 'Home' && pathname.startsWith(`${item.href}/`));
}

export function NavigationLink({ item, pathname }: { item: NavigationItem; pathname: string }) {
  const active = isNavigationItemActive(pathname, item);
  return (
    <Link
      aria-current={active ? 'page' : undefined}
      aria-label={item.accessibleLabel}
      className={active ? 'app-nav-link app-nav-link-active' : 'app-nav-link'}
      href={item.href}
      prefetch={false}
    >
      <span aria-hidden="true" className="app-nav-icon">
        {iconLabels[item.icon]}
      </span>
      <span>{item.label}</span>
    </Link>
  );
}

export function AppNavigation({
  groups,
  organization,
  roleLabel,
}: {
  groups: readonly NavigationGroup[];
  organization: Readonly<{ name: string; slug: string }>;
  roleLabel: string;
}) {
  const pathname = usePathname();
  return (
    <>
      <aside className="app-sidebar">
        <Link className="app-sidebar-brand" href="/" prefetch={false}>
          <span aria-hidden="true" className="app-sidebar-mark">
            TF
          </span>
          <span>TryoutFlow</span>
        </Link>
        <div className="app-organization">
          <p>{organization.name}</p>
          <span>{roleLabel}</span>
        </div>
        <nav aria-label="Primary navigation" className="app-navigation">
          {groups.map((group) => (
            <section aria-labelledby={`nav-${group.id}`} className="app-nav-group" key={group.id}>
              <h2 id={`nav-${group.id}`}>{group.label}</h2>
              <div>
                {group.items.map((item) => (
                  <NavigationLink item={item} key={item.href} pathname={pathname} />
                ))}
              </div>
            </section>
          ))}
        </nav>
        <form action="/auth/sign-out" className="app-sign-out" method="post">
          <button className="button-quiet" type="submit">
            Sign out
          </button>
        </form>
      </aside>
      <MobileNav
        groups={groups}
        organization={organization}
        pathname={pathname}
        roleLabel={roleLabel}
      />
    </>
  );
}
