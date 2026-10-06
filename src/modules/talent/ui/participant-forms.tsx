'use client';

import { FeedbackButton } from '@/components/ui/button';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  respondOffer,
  requestCorrection,
  linkParticipant,
  setScoutingGrant,
} from '../application/participant-actions';
export function CorrectionForm({
  organizationId,
  athleteId,
}: {
  organizationId: string;
  athleteId: string;
}) {
  const [text, setText] = useState('');
  const [id] = useState(() => crypto.randomUUID());
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const router = useRouter();
  return (
    <form
      className="talent-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          const r = await requestCorrection({
            id,
            organization_id: organizationId,
            athlete_id: athleteId,
            request_text: text,
          });
          setMessage(r.message);
          if (r.ok) {
            setSaved(true);
            router.refresh();
          }
        } catch {
          setMessage('Could not connect. Your request text is still here.');
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        Request a profile correction
        <textarea
          required
          maxLength={4000}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Describe the information to correct and the replacement."
        />
      </label>
      <FeedbackButton busy={busy} className="button-primary" disabled={busy || saved}>
        {busy ? 'Saving…' : saved ? 'Request saved' : 'Submit correction request'}
      </FeedbackButton>
      <p role="status">{message}</p>
    </form>
  );
}
export function LinkParticipantForm({
  slug,
  athletes,
}: {
  slug: string;
  athletes: { id: string; given_name: string; family_name: string }[];
}) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  return (
    <form
      className="talent-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        setBusy(true);
        try {
          const r = await linkParticipant(slug, Object.fromEntries(f));
          setMessage(r.message);
          if (r.ok) router.refresh();
        } catch {
          setMessage('Connection interrupted. Retry.');
        } finally {
          setBusy(false);
        }
      }}
    >
      <h3>Link a verified participant account</h3>
      <p>
        Verify the person’s relationship to this athlete before granting access. The account will
        see approved feedback, event notices and fee balances.
      </p>
      <div className="talent-form-grid">
        <label>
          Athlete
          <select name="athlete_id" required>
            <option value="">Choose athlete</option>
            {athletes.map((a) => (
              <option key={a.id} value={a.id}>
                {a.given_name} {a.family_name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Verified account email
          <input type="email" name="email" required />
        </label>
        <label>
          Relationship
          <select name="relationship">
            <option value="guardian">Guardian</option>
            <option value="athlete">Athlete</option>
          </select>
        </label>
      </div>
      <FeedbackButton busy={busy} className="button-primary" disabled={busy}>
        Grant participant access
      </FeedbackButton>
      <p role="status">{message}</p>
    </form>
  );
}
export function ScoutingGrantButton({
  slug,
  userId,
  enabled,
}: {
  slug: string;
  userId: string;
  enabled: boolean;
}) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  return (
    <div>
      <FeedbackButton
        busy={busy}
        className="button-secondary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const r = await setScoutingGrant(slug, userId, !enabled);
            setMessage(r.message);
            if (r.ok) router.refresh();
          } catch {
            setMessage('Access could not be changed.');
          } finally {
            setBusy(false);
          }
        }}
      >
        {enabled ? 'Revoke scouting access' : 'Grant scouting access'}
      </FeedbackButton>
      <p role="status">{message}</p>
    </div>
  );
}
export function OfferResponse({
  organizationId,
  scenarioId,
  athleteId,
}: {
  organizationId: string;
  scenarioId: string;
  athleteId: string;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const router = useRouter();
  return (
    <div>
      <p>Record your response to the organizer.</p>
      {(['accepted', 'declined'] as const).map((response) => (
        <FeedbackButton
          busy={busy}
          key={response}
          className={response === 'accepted' ? 'button-primary' : 'button-secondary'}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const r = await respondOffer({
                organization_id: organizationId,
                scenario_id: scenarioId,
                athlete_id: athleteId,
                response,
              });
              setMessage(r.message);
              if (r.ok) router.refresh();
            } catch {
              setMessage('Could not record your response. Retry.');
            } finally {
              setBusy(false);
            }
          }}
        >
          {response === 'accepted' ? 'Accept offer' : 'Decline offer'}
        </FeedbackButton>
      ))}
      <p role="status">{message}</p>
    </div>
  );
}
