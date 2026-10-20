'use client';

import { FeedbackButton } from '@/components/ui/button';

import { useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { saveEligibility } from '../application/eligibility-actions';
export function EligibilityForm({
  slug,
  hidden,
  children,
}: {
  slug: string;
  hidden: Record<string, string | number>;
  children: ReactNode;
}) {
  const [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  const router = useRouter();
  return (
    <form
      className="talent-form talent-no-print"
      onSubmit={async (e) => {
        e.preventDefault();
        const values = Object.fromEntries(new FormData(e.currentTarget));
        setBusy(true);
        try {
          const r = await saveEligibility(slug, { ...hidden, ...values });
          setMessage(r.message);
          if (r.ok) router.refresh();
        } catch {
          setMessage('Connection interrupted. Your entries are still here.');
        } finally {
          setBusy(false);
        }
      }}
    >
      {children}
      <FeedbackButton busy={busy} className="button-primary" disabled={busy}>
        {busy ? 'Saving…' : 'Save eligibility review'}
      </FeedbackButton>
      <p role="status">{message}</p>
    </form>
  );
}
