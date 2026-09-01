import type { NavigationGroup } from '../../modules/organizations/components/app-navigation-model';
import { flattenNavigation } from '../../modules/organizations/components/app-navigation-model';
import { NavigationLink } from './app-navigation';

export function MobileNav({
  groups,
  items: legacyItems,
  organization,
  pathname = '',
  roleLabel,
}: {
  groups?: readonly NavigationGroup[];
  items?: readonly Readonly<{ href: string; label: string }>[];
  organization?: Readonly<{ name: string; slug: string }>;
  pathname?: string;
  roleLabel?: string;
}) {
  if (legacyItems) {
    return (
      <nav aria-label="Primary navigation" className="mobile-nav-bar">
        {legacyItems.map((item) => (
          <Link
            className="app-nav-link min-h-[var(--target-mobile)] min-w-[var(--target-mobile)]"
            href={item.href}
            key={item.href}
          >
            {item.label}
          </Link>
        ))}
      </nav>
    );
  }
  if (!groups || !organization || !roleLabel) return null;
  const items = flattenNavigation(groups);
  const primaryItems = items.slice(0, 3);
  const moreItems = items.slice(3);
  return (
    <nav aria-label="Mobile navigation" className="mobile-navigation">
      <div className="mobile-organization">
        <span aria-hidden="true" className="app-sidebar-mark">
          TF
        </span>
        <span>
          <strong>{organization.name}</strong>
          <small>{roleLabel}</small>
        </span>
      </div>
      <div className="mobile-nav-bar">
        {primaryItems.map((item) => (
          <NavigationLink item={item} key={item.href} pathname={pathname} />
        ))}
        {moreItems.length ? (
          <details className="mobile-more">
            <summary className="app-nav-link">More</summary>
            <div className="mobile-more-panel">
              {moreItems.map((item) => (
                <NavigationLink item={item} key={item.href} pathname={pathname} />
              ))}
              <form action="/auth/sign-out" method="post">
                <button className="button-quiet" type="submit">
                  Sign out
                </button>
              </form>
            </div>
          </details>
        ) : null}
      </div>
    </nav>
  );
}
import Link from 'next/link';
