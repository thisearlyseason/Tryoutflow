'use client';

import { FeedbackButton } from '@/components/ui/button';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createProspect } from '../application/actions';
export function IdentityForm({
  slug,
  athlete,
}: {
  slug: string;
  athlete?: {
    id: string;
    given_name: string;
    family_name: string;
    birth_date: string | null;
    updated_at: string;
  };
}) {
  const router = useRouter();
  const [id] = useState(() => athlete?.id ?? crypto.randomUUID());
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="talent-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        setBusy(true);
        try {
          const result = await createProspect(slug, {
            id,
            given_name: form.get('given_name'),
            family_name: form.get('family_name'),
            birth_date: form.get('birth_date'),
            ...(athlete ? { updated_at: athlete.updated_at } : {}),
          });
          setMessage(result.message);
          if (result.ok && result.athleteId) {
            router.push(`/app/${slug}/athletes/${result.athleteId}`);
            router.refresh();
          }
        } catch {
          setMessage('Could not save. Your entries remain here.');
        } finally {
          setBusy(false);
        }
      }}
    >
      <h3>{athlete ? 'Correct athlete identity' : 'Add a prospect'}</h3>
      <p className="talent-meta">A prospect can be scouted before registering for a tryout.</p>
      <div className="talent-form-grid">
        <label>
          First name
          <input name="given_name" required maxLength={120} defaultValue={athlete?.given_name} />
        </label>
        <label>
          Last name
          <input name="family_name" required maxLength={120} defaultValue={athlete?.family_name} />
        </label>
        <label>
          Birth date, if known
          <input name="birth_date" type="date" defaultValue={athlete?.birth_date ?? ''} />
        </label>
      </div>
      <div className="talent-form-footer">
        <FeedbackButton busy={busy} disabled={busy} className="button-primary">
          {busy ? 'Saving…' : athlete ? 'Save identity' : 'Add prospect'}
        </FeedbackButton>
        <p role="status">{message}</p>
      </div>
    </form>
  );
}
