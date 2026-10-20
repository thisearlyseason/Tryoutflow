'use client';

import { FeedbackButton } from '@/components/ui/button';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

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
  const bottomNavigation = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const navigation = bottomNavigation.current;
    const frame = navigation?.closest<HTMLElement>('.app-frame');
    if (!navigation || !frame) return;
    const update = () =>
      frame.style.setProperty(
        '--mobile-navigation-height',
        `${navigation.getBoundingClientRect().height}px`,
      );
    update();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(navigation);
    if (!observer) window.addEventListener('resize', update);
    return () => {
      observer?.disconnect();
      if (!observer) window.removeEventListener('resize', update);
      frame.style.removeProperty('--mobile-navigation-height');
    };
  }, []);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);
  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 1100px)');
    const closeOnResize = () => setMoreOpen(false);
    desktop.addEventListener('change', closeOnResize);
    window.addEventListener('orientationchange', closeOnResize);
    return () => {
      desktop.removeEventListener('change', closeOnResize);
      window.removeEventListener('orientationchange', closeOnResize);
    };
  }, []);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !moreOpen) return;
    dialog.showModal();
    closeRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
      if (window.matchMedia('(min-width: 1100px)').matches) {
        document
          .querySelector<HTMLButtonElement>(
            '.app-navigation-reopen:not([hidden]), .app-sidebar[data-collapsed="false"] .app-navigation-collapse',
          )
          ?.focus();
      } else {
        triggerRef.current?.focus();
      }
    };
  }, [moreOpen]);
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
  const billingItem = items.find(({ href }) => href.endsWith('/organization/billing'));
  const primaryItems = items.slice(0, 3);
  const close = () => setMoreOpen(false);
  return (
    <nav aria-label="Mobile navigation" className="mobile-navigation">
      <div className="mobile-organization">
        <OrganizationMark name={organization.name} logoUrl={organization.logoUrl} />
        <span className="mobile-workspace-identity">
          <strong>{organization.name}</strong>
          <small>{roleLabel}</small>
        </span>
        {billingItem ? (
          <Link className="mobile-upgrade-link" href={billingItem.href} prefetch={false}>
            Upgrade &amp; billing
          </Link>
        ) : null}
      </div>
      <div className="mobile-nav-bar" ref={bottomNavigation}>
        {primaryItems.map((item) => (
          <NavigationLink item={item} key={item.href} pathname={pathname} />
        ))}
        <div className="mobile-more">
          <FeedbackButton
            ref={triggerRef}
            aria-haspopup="dialog"
            aria-controls="mobile-more-panel"
            aria-expanded={moreOpen}
            aria-label="More navigation"
            className="app-nav-link"
            onClick={() => setMoreOpen((open) => !open)}
            type="button"
          >
            More
          </FeedbackButton>
          {moreOpen ? (
            <dialog
              ref={dialogRef}
              className="mobile-more-panel"
              id="mobile-more-panel"
              aria-label="Workspace navigation"
              onCancel={(event) => {
                event.preventDefault();
                close();
              }}
              onClose={close}
              onClickCapture={(event) => {
                if ((event.target as Element).closest('a')) close();
              }}
            >
              <div className="mobile-more-heading">
                <strong>Navigation</strong>
                <FeedbackButton
                  ref={closeRef}
                  aria-label="Close navigation"
                  className="mobile-more-close"
                  onClick={close}
                  type="button"
                >
                  ×
                </FeedbackButton>
              </div>
              {groups.map((group) => (
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
              <Link
                className="button-quiet"
                href={`/app/${organization.slug}/account`}
                prefetch={false}
              >
                Account
              </Link>
              <form action="/auth/sign-out" method="post">
                <FeedbackButton className="button-quiet" type="submit">
                  Sign out
                </FeedbackButton>
              </form>
            </dialog>
          ) : null}
        </div>
      </div>
    </nav>
  );
}
