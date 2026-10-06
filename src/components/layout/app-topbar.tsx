'use client';

import { BookOpen, Search, UserRound } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import type { NavigationGroup } from '../../modules/organizations/components/app-navigation-model';

/** Search the current user's available workspace pages without exposing restricted routes. */
export function AppTopbar({
  groups,
  organization,
  roleLabel,
}: {
  groups: readonly NavigationGroup[];
  organization: { name: string; slug: string };
  roleLabel: string;
}) {
  const [query, setQuery] = useState('');
  const roles = roleLabel.split(' · ');
  const guideAudience = roles.some((role) => ['Owner', 'Administrator', 'Director'].includes(role))
    ? 'coaches'
    : roles.includes('Evaluator')
      ? 'evaluators'
      : roles.includes('Check-in')
        ? 'checkin'
        : roles.includes('Reviewer')
          ? 'reviewers'
          : groups.some((group) => group.items.some((item) => item.href.endsWith('/scouting')))
            ? 'scouting'
            : 'coaches';
  const items = groups
    .flatMap((group) => group.items)
    .filter((item) => item.label.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <header className="app-topbar">
      <div
        className="workspace-search"
        onKeyDown={(event) => {
          if (event.key === 'Escape') setQuery('');
        }}
      >
        <Search aria-hidden="true" size={17} />
        <input
          aria-label="Find athletes, tryouts or pages"
          autoComplete="off"
          placeholder="Find athletes, tryouts or pages…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {query.trim() && (
          <nav aria-label="Workspace search results" className="workspace-search-results">
            <Link
              href={`/app/${organization.slug}/search?q=${encodeURIComponent(query)}`}
              onClick={() => setQuery('')}
            >
              Search athletes, tryouts and evaluators →
            </Link>
            {items.length ? (
              items.map((item) => (
                <Link
                  key={item.href}
                  aria-label={item.accessibleLabel}
                  href={item.href}
                  prefetch={false}
                  onClick={() => setQuery('')}
                >
                  <span>{item.label}</span>
                  <small>{item.accessibleLabel ?? 'Workspace page'}</small>
                </Link>
              ))
            ) : (
              <p>No pages found. Try another name.</p>
            )}
          </nav>
        )}
      </div>
      <div className="topbar-identity">
        <Link
          href={`/how-to?audience=${guideAudience}`}
          className="topbar-help-link inline-flex min-h-11 items-center gap-1 rounded px-2 text-xs font-bold"
          aria-label="How to use TryoutFlow"
        >
          <BookOpen size={17} aria-hidden="true" />
          <span>How to</span>
        </Link>
        <span>
          {organization.name}
          <small>{roleLabel}</small>
        </span>
        <Link aria-label="Your account" href={`/app/${organization.slug}/account`} prefetch={false}>
          <UserRound aria-hidden="true" size={19} />
        </Link>
      </div>
    </header>
  );
}
