'use client';

import { FeedbackButton } from '@/components/ui/button';

import { useState, useSyncExternalStore } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { Bookmark } from 'lucide-react';
type View = { name: string; href: string };
const subscribe = (listener: () => void) => {
  window.addEventListener('talent-view-change', listener);
  return () => window.removeEventListener('talent-view-change', listener);
};
export function SavedViews({ userId, slug }: { userId: string; slug: string }) {
  const path = usePathname();
  const key = `tryoutflow:views:${userId}:${slug}:${path}`;
  const raw = useSyncExternalStore(
    subscribe,
    () => {
      try {
        return localStorage.getItem(key) || '[]';
      } catch {
        return '[]';
      }
    },
    () => '[]',
  );
  const [message, setMessage] = useState('');
  let views: View[] = [];
  try {
    views = (JSON.parse(raw) as View[])
      .filter(
        (v) =>
          typeof v.name === 'string' && typeof v.href === 'string' && v.href.split('?')[0] === path,
      )
      .slice(0, 12);
  } catch {}
  function write(next: View[]) {
    try {
      localStorage.setItem(key, JSON.stringify(next));
      window.dispatchEvent(new Event('talent-view-change'));
      setMessage('Saved views updated on this device.');
    } catch {
      setMessage('This browser cannot save views. Bookmark the filtered page instead.');
    }
  }
  return (
    <details className="talent-editor talent-saved-views talent-no-print">
      <summary>
        <Bookmark size={14} aria-hidden="true" />
        Saved views{views.length ? ` (${views.length})` : ''}
      </summary>
      <p>Save filters for this account and organization on this device.</p>
      <form
        className="talent-search"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const name = String(f.get('name') ?? '').trim();
          if (name)
            write(
              [
                ...views.filter((v) => v.name !== name),
                { name, href: window.location.pathname + window.location.search },
              ].slice(-12),
            );
        }}
      >
        <label>
          View name
          <input name="name" required maxLength={80} placeholder="U18 centres · skills session" />
        </label>
        <FeedbackButton className="button-secondary">Save current filters</FeedbackButton>
      </form>
      {views.map((v) => (
        <div className="talent-toolbar" key={v.name}>
          <Link href={v.href}>{v.name}</Link>
          <FeedbackButton
            className="button-secondary"
            onClick={() => write(views.filter((x) => x.name !== v.name))}
          >
            Remove {v.name}
          </FeedbackButton>
        </div>
      ))}
      <p role="status">{message}</p>
    </details>
  );
}
