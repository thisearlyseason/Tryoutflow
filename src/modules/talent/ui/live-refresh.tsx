'use client';

import { FeedbackButton } from '@/components/ui/button';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
export function LiveRefresh({ asOf }: { asOf: string }) {
  const router = useRouter();
  const [automatic, setAutomatic] = useState(true);
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    if (!automatic) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') startTransition(() => router.refresh());
    }, 30000);
    return () => clearInterval(timer);
  }, [automatic, router]);
  return (
    <div className="talent-toolbar">
      <p className="talent-meta">
        Loaded {asOf.slice(11, 19)} UTC ·{' '}
        {pending ? 'Refreshing…' : automatic ? 'refreshes every 30 seconds' : 'manual refresh'}
      </p>
      <label>
        <input
          type="checkbox"
          checked={automatic}
          onChange={(e) => setAutomatic(e.target.checked)}
        />{' '}
        Automatic refresh
      </label>
      <FeedbackButton
        busy={pending}
        className="button-secondary"
        disabled={pending}
        onClick={() => startTransition(() => router.refresh())}
      >
        Refresh now
      </FeedbackButton>
    </div>
  );
}
