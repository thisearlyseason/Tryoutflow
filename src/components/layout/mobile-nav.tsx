'use client';

import Link from 'next/link';
import { useState } from 'react';

import type { NavigationGroup } from '../../modules/organizations/components/app-navigation-model';
import { flattenNavigation } from '../../modules/organizations/components/app-navigation-model';
import { NavigationLink } from './app-navigation';
import { OrganizationMark } from '../../modules/organizations/components/organization-mark';

export function MobileNav({
  groups,
  items: legacyItems,
  organization,
  pathname = '',
  roleLabel,
}: {
  groups?: readonly NavigationGroup[];
  items?: readonly Readonly<{ href: string; label: string }>[];
  organization?: Readonly<{ name: string; slug: string; logoUrl?: string }>;
  pathname?: string;
  roleLabel?: string;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
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
  const primaryHrefs = new Set(primaryItems.map(({ href }) => href));
  const moreGroups = groups
    .map((group) => ({
      ...group,
      items: group.items.filter(({ href }) => !primaryHrefs.has(href)),
    }))
    .filter(({ items: groupItems }) => groupItems.length > 0);
  const close = () => setMoreOpen(false);
  return (
    <nav aria-label="Mobile navigation" className="mobile-navigation">
      <div className="mobile-organization">
        <OrganizationMark name={organization.name} logoUrl={organization.logoUrl} />
        <span>
          <strong>{organization.name}</strong>
          <small>{roleLabel}</small>
        </span>
      </div>
      <div className="mobile-nav-bar">
        {primaryItems.map((item) => (
          <NavigationLink item={item} key={item.href} pathname={pathname} />
        ))}
        {moreGroups.length ? (
          <div className="mobile-more">
            <button
              aria-controls="mobile-more-panel"
              aria-expanded={moreOpen}
              aria-label="More navigation"
              className="app-nav-link"
              onClick={() => setMoreOpen((open) => !open)}
              type="button"
            >
              More
            </button>
            {moreOpen ? (
              <div className="mobile-more-panel" id="mobile-more-panel" onClickCapture={close}>
                <div className="mobile-more-heading">
                  <strong>More</strong>
                  <button
                    aria-label="Close navigation"
                    className="mobile-more-close"
                    onClick={close}
                    type="button"
                  >
                    ×
                  </button>
                </div>
                {moreGroups.map((group) => (
                  <section
                    aria-labelledby={`mobile-nav-${group.id}`}
                    className="mobile-more-group"
                    key={group.id}
                  >
                    <h2 id={`mobile-nav-${group.id}`}>{group.label}</h2>
                    {group.items.map((item) => (
                      <NavigationLink item={item} key={item.href} pathname={pathname} />
                    ))}
                  </section>
                ))}
                <form action="/auth/sign-out" method="post">
                  <button className="button-quiet" type="submit">
                    Sign out
                  </button>
                </form>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </nav>
  );
}
