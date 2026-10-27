'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

export type SelectedEventOption = Readonly<{ id: string; name: string; href: string }>;

/** A saved preference never grants access or initiates navigation. The server supplies every option. */
export function SelectedEvent({
  events,
  storageKey,
}: {
  events: readonly SelectedEventOption[];
  storageKey: string;
}) {
  const pathname = usePathname();
  const search = useSearchParams();
  const queryIds = search.getAll('tryout');
  const evaluatorRoute = pathname.endsWith('/evaluate') && queryIds.length > 0;
  const hasEventScope = evaluatorRoute || pathname.includes('/tryouts/');
  const queryId = evaluatorRoute && queryIds.length === 1 ? queryIds[0] : null;
  const routeEvent = events.find((event) =>
    evaluatorRoute ? event.id === queryId : pathname.includes(`/tryouts/${event.id}/`),
  );
  const [selected, setSelected] = useState(routeEvent?.id ?? '');
  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(storageKey);
    } catch {
      /* Optional preference. */
    }
    const next =
      routeEvent?.id ??
      (!hasEventScope && events.some(({ id }) => id === saved) ? saved : '') ??
      '';
    setSelected(next);
    if (routeEvent) {
      try {
        localStorage.setItem(storageKey, routeEvent.id);
      } catch {
        /* Optional preference. */
      }
    }
  }, [storageKey, events, routeEvent, hasEventScope]);
  const event = events.find(({ id }) => id === selected);
  // Session routes carry no verified event ID here. Their own server-loaded header supplies context.
  if (!events.length || pathname.includes('/evaluate/session/') || pathname.includes('/tryouts/'))
    return null;
  return (
    <details className="tryout-shortcut" open={evaluatorRoute}>
      <summary>Tryout shortcut</summary>
      <div className="selected-event">
        <label>
          <span>Tryout shortcut</span>
          <select
            aria-label="Tryout shortcut"
            value={event?.id ?? ''}
            onChange={(e) => {
              const next = events.find(({ id }) => id === e.target.value);
              if (!next) return;
              setSelected(next.id);
              try {
                localStorage.setItem(storageKey, next.id);
              } catch {
                /* Optional preference. */
              }
            }}
          >
            <option value="">Choose a tryout</option>
            {events.map(({ id, name }) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
        {event ? (
          <Link
            href={event.href}
            prefetch={false}
            className="button-secondary"
            aria-label={`Open ${event.name}`}
          >
            Open tryout →
          </Link>
        ) : null}
      </div>
    </details>
  );
}
