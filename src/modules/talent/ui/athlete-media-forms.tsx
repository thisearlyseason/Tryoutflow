'use client';

import { FeedbackButton } from '@/components/ui/button';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { saveContact, savePortrait } from '../application/athlete-media-actions';
export function PortraitForm({
  slug,
  athleteId,
  version,
}: {
  slug: string;
  athleteId: string;
  version: number;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const router = useRouter();
  return (
    <form
      className="talent-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        setBusy(true);
        try {
          const r = await savePortrait(slug, athleteId, version, f);
          setMessage(r.message);
          if (r.ok) router.refresh();
        } catch {
          setMessage('Could not upload. Retry.');
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        Athlete photo
        <input type="file" name="portrait" required accept="image/png,image/jpeg,image/webp" />
      </label>
      <p>
        JPEG, PNG or WebP, up to 2 MB. Photos are restricted to authorized sporting staff. Image
        location metadata is removed.
      </p>
      <FeedbackButton busy={busy} className="button-primary" disabled={busy}>
        Save photo
      </FeedbackButton>
      <p role="status">{message}</p>
    </form>
  );
}
export function ContactForm({
  slug,
  athleteId,
  contact,
}: {
  slug: string;
  athleteId: string;
  contact?: {
    id: string;
    name: string | null;
    email: string;
    phone: string | null;
    updated_at: string;
    relationship: string;
  };
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const router = useRouter();
  return (
    <form
      className="talent-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = Object.fromEntries(new FormData(e.currentTarget));
        setBusy(true);
        try {
          const r = await saveContact(slug, {
            ...f,
            athlete_id: athleteId,
            ...(contact ? { guardian_id: contact.id, updated_at: contact.updated_at } : {}),
          });
          setMessage(r.message);
          if (r.ok) router.refresh();
        } catch {
          setMessage('Could not save. Your entries remain here.');
        } finally {
          setBusy(false);
        }
      }}
    >
      <h3>{contact ? 'Correct contact' : 'Add or link contact'}</h3>
      <p>
        Use athlete, guardian, emergency contact or representative as appropriate. Contact details
        may be shared across siblings. This does not grant portal access or message consent.
      </p>
      <div className="talent-form-grid">
        <label>
          Name
          <input name="name" required defaultValue={contact?.name ?? ''} />
        </label>
        <label>
          Email
          <input name="email" type="email" required defaultValue={contact?.email ?? ''} />
        </label>
        <label>
          Phone
          <input name="phone" type="tel" defaultValue={contact?.phone ?? ''} />
        </label>
        <label>
          Relationship
          <input name="relationship" required defaultValue={contact?.relationship ?? ''} />
        </label>
      </div>
      <FeedbackButton busy={busy} className="button-primary" disabled={busy}>
        {busy ? 'Saving…' : 'Save contact'}
      </FeedbackButton>
      <p role="status">{message}</p>
    </form>
  );
}
