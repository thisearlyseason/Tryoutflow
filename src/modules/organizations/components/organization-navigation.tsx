import Link from 'next/link';

import type { AuthorizationContext } from '../application/capabilities';
import { buildAppNavigation, flattenNavigation } from './app-navigation-model';

export function OrganizationNavigation({
  authorization,
  organizationSlug,
}: {
  authorization: AuthorizationContext;
  organizationSlug: string;
}) {
  const items = flattenNavigation(buildAppNavigation({ authorization, organizationSlug }));
  return (
    <nav aria-label="Organization navigation">
      {items.map((item) => (
        <Link aria-label={item.accessibleLabel} href={item.href} key={item.href} prefetch={false}>
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
