'use client';

import { FeedbackButton } from '@/components/ui/button';

import {
  BarChart3,
  ClipboardList,
  House,
  LoaderCircle,
  Settings,
  UserRoundCheck,
  Users,
  type LucideIcon,
} from 'lucide-react';
import Link, { useLinkStatus } from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { Brand } from '../ui/brand';
import { MobileNav } from './mobile-nav';
import { OrganizationMark } from '../../modules/organizations/components/organization-mark';
import type {
  NavigationGroup,
  NavigationIcon,
  NavigationItem,
} from '../../modules/organizations/components/app-navigation-model';

const navigationIcons: Record<NavigationIcon, LucideIcon> = {
  home: House,
  tryouts: ClipboardList,
  athletes: Users,
  evaluate: UserRoundCheck,
  reports: BarChart3,
  organization: Settings,
};

export function isNavigationItemActive(pathname: string, item: NavigationItem) {
  return pathname === item.href || (item.label !== 'Home' && pathname.startsWith(`${item.href}/`));
}

function NavigationProgress({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  const { pending } = useLinkStatus();
  return (
    <>
      <span aria-hidden="true" className="app-nav-icon" data-pending={pending}>
        {pending ? (
          <LoaderCircle size={17} className="motion-safe:animate-spin" />
        ) : (
          <Icon size={17} strokeWidth={2.25} />
        )}
      </span>
      <span aria-live="polite" role={pending ? 'status' : undefined} className="sr-only">
        {pending ? `Opening ${label}…` : ''}
      </span>
    </>
  );
}

export function NavigationLink({ item, pathname }: { item: NavigationItem; pathname: string }) {
  const active = isNavigationItemActive(pathname, item);
  const Icon = navigationIcons[item.icon];
  return (
    <Link
      aria-current={active ? 'page' : undefined}
      aria-label={item.accessibleLabel ?? item.label}
      className={active ? 'app-nav-link app-nav-link-active' : 'app-nav-link'}
      href={item.href}
      prefetch={false}
    >
      <NavigationProgress icon={Icon} label={item.accessibleLabel ?? item.label} />
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
  organization: Readonly<{ name: string; slug: string; logoUrl?: string }>;
  roleLabel: string;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const reopenRef = useRef<HTMLButtonElement>(null);
  const collapseRef = useRef<HTMLButtonElement>(null);
  const pendingFocus = useRef(false);
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem('tryoutflow.navigation.collapsed') === 'true');
    } catch {
      /* Navigation remains usable when storage is unavailable. */
    }
  }, []);
  useEffect(() => {
    if (pendingFocus.current) {
      (collapsed ? reopenRef : collapseRef).current?.focus();
      pendingFocus.current = false;
    }
  }, [collapsed]);
  function toggleCollapsed() {
    const next = !collapsed;
    pendingFocus.current = true;
    setCollapsed(next);
    try {
      localStorage.setItem('tryoutflow.navigation.collapsed', String(next));
    } catch {
      /* Persistence is optional. */
    }
  }
  return (
    <>
      <button
        ref={reopenRef}
        className="app-navigation-reopen"
        aria-label="Expand navigation"
        aria-controls="workspace-sidebar"
        aria-expanded={!collapsed}
        onClick={toggleCollapsed}
        type="button"
        hidden={!collapsed}
      >
        ☰ <span>Navigation</span>
      </button>
      <aside className="app-sidebar" id="workspace-sidebar" data-collapsed={collapsed}>
        <button
          ref={collapseRef}
          className="app-navigation-collapse"
          aria-label="Collapse navigation"
          aria-controls="workspace-sidebar"
          aria-expanded={!collapsed}
          onClick={toggleCollapsed}
          type="button"
        >
          ← <span>Collapse navigation</span>
        </button>
        <Link className="app-sidebar-brand" href="/" prefetch={false}>
          <Brand />
        </Link>
        <div className="app-organization">
          <OrganizationMark name={organization.name} logoUrl={organization.logoUrl} />
          <div className="app-organization-copy">
            <p>{organization.name}</p>
            <span>{roleLabel}</span>
          </div>
        </div>
        <nav aria-label="Primary navigation" className="app-navigation">
          {groups.map((group) =>
            group.id === 'organization' ? (
              <details
                className="app-nav-group workflow-settings"
                key={group.id}
                open={group.items.some((item) => isNavigationItemActive(pathname, item))}
              >
                <summary>{group.label}</summary>
                <div>
                  {group.items.map((item) => (
                    <NavigationLink item={item} key={item.href} pathname={pathname} />
                  ))}
                </div>
              </details>
            ) : (
              <section aria-labelledby={`nav-${group.id}`} className="app-nav-group" key={group.id}>
                <h2 id={`nav-${group.id}`}>{group.label}</h2>
                <div>
                  {group.items.map((item) => (
                    <NavigationLink item={item} key={item.href} pathname={pathname} />
                  ))}
                </div>
              </section>
            ),
          )}
        </nav>
        <form action="/auth/sign-out" className="app-sign-out" method="post">
          <Link
            className="button-quiet"
            href={`/app/${organization.slug}/account`}
            prefetch={false}
          >
            Account
          </Link>
          <FeedbackButton className="button-quiet" type="submit">
            Sign out
          </FeedbackButton>
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
