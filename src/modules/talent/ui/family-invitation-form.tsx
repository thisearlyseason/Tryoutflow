'use client';

import { useEffect, useState } from 'react';
import { Copy, Link2, Share2, ShieldCheck, UserRoundPlus } from 'lucide-react';
import { FeedbackButton } from '@/components/ui/button';
import { createFamilyInvitation, revokeFamilyInvitation } from '../application/family-invitations';

export function FamilyInvitationForm({
  slug,
  athletes,
  selectedAthlete,
  unavailableInvitationIds = [],
}: {
  slug: string;
  athletes: { id: string; given_name: string; family_name: string }[];
  selectedAthlete?: string;
  unavailableInvitationIds?: string[];
}) {
  const [athlete, setAthlete] = useState(
    athletes.some((a) => a.id === selectedAthlete) ? selectedAthlete! : '',
  );
  const [email, setEmail] = useState('');
  const [relationship, setRelationship] = useState('guardian');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [shareUrl, setShareUrl] = useState('');
  const [sharedId, setSharedId] = useState('');
  const [canShare, setCanShare] = useState(false);
  useEffect(() => setCanShare(typeof navigator.share === 'function'), []);
  useEffect(() => {
    if (sharedId && unavailableInvitationIds.includes(sharedId)) {
      setShareUrl('');
      setSharedId('');
      setMessage('This invitation is no longer pending. Check its status below.');
    }
  }, [sharedId, unavailableInvitationIds]);
  const person = athletes.find((a) => a.id === athlete);
  function changed() {
    setConfirmed(false);
    setShareUrl('');
    setSharedId('');
    setMessage('');
  }
  return (
    <form
      className="talent-form family-invitation-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy || !confirmed) return;
        setBusy(true);
        setMessage('');
        setShareUrl('');
        try {
          const result = await createFamilyInvitation(slug, {
            athlete_id: athlete,
            email: email.trim(),
            relationship,
            confirmed,
          });
          setMessage(result.message);
          if (result.ok) {
            setShareUrl(result.shareUrl);
            setSharedId(result.invitationId);
          }
        } catch {
          setMessage(
            'Could not connect. Your choices are still here. Creating another invitation replaces an older pending link for this athlete and email.',
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="family-form-heading">
        <span className="brand-icon">
          <UserRoundPlus aria-hidden="true" />
        </span>
        <div>
          <h2>Invite a family</h2>
          <p>Choose the athlete. We’ll keep the invitation tied to their verified email.</p>
        </div>
      </div>
      <div className="talent-form-grid">
        <label>
          Athlete
          <select
            disabled={busy}
            required
            value={athlete}
            onChange={(e) => {
              setAthlete(e.target.value);
              changed();
            }}
          >
            <option value="">Choose an athlete</option>
            {athletes.map((a) => (
              <option key={a.id} value={a.id}>
                {a.given_name} {a.family_name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Family email
          <input
            required
            type="email"
            disabled={busy}
            autoComplete="email"
            maxLength={254}
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              changed();
            }}
            placeholder="family@example.com"
          />
        </label>
        <label>
          Relationship
          <select
            disabled={busy}
            value={relationship}
            onChange={(e) => {
              setRelationship(e.target.value);
              changed();
            }}
          >
            <option value="guardian">Parent / guardian</option>
            <option value="athlete">Adult athlete</option>
          </select>
        </label>
      </div>
      {person && email ? (
        <div className="family-invite-review">
          <ShieldCheck aria-hidden="true" size={22} />
          <p>
            <strong>
              {person.given_name} {person.family_name}
            </strong>
            <br />
            Invite {email} for family access only.
          </p>
        </div>
      ) : null}
      <label className="family-confirm">
        <input
          type="checkbox"
          disabled={busy}
          required
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
        />
        I’ve confirmed this person should access this athlete.
      </label>
      <FeedbackButton
        className="button-primary"
        busy={busy}
        disabled={busy || !confirmed}
        type="submit"
      >
        <Link2 size={18} aria-hidden="true" />
        {busy ? 'Creating invitation…' : 'Create family invitation'}
      </FeedbackButton>
      <p role="status">{message}</p>
      {shareUrl ? (
        <section className="family-share-card" aria-label="Share family invitation">
          <h3>Your invitation is ready</h3>
          <p>
            Send this private link to <strong>{email}</strong>. It expires in 7 days and works only
            with that verified email.
          </p>
          <label>
            Private invitation link
            <input readOnly value={shareUrl} onFocus={(e) => e.currentTarget.select()} />
          </label>
          <div className="family-invite-actions">
            <button
              className="button-primary"
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(shareUrl);
                  setMessage('Invitation link copied. Share it privately with the invited family.');
                } catch {
                  setMessage('Select the invitation link above and copy it.');
                }
              }}
            >
              <Copy size={17} aria-hidden="true" />
              Copy invitation
            </button>
            {canShare ? (
              <button
                className="button-secondary"
                type="button"
                onClick={async () => {
                  try {
                    await navigator.share({
                      title: 'Your TryoutFlow family invitation',
                      text: 'Your coach invited you to connect your athlete in TryoutFlow. Use the invited email to accept.',
                      url: shareUrl,
                    });
                  } catch (error) {
                    if (!(error instanceof Error && error.name === 'AbortError'))
                      setMessage('Sharing is unavailable. Copy the invitation link instead.');
                  }
                }}
              >
                <Share2 size={17} aria-hidden="true" />
                Share invitation
              </button>
            ) : null}
          </div>
          <small>
            This link is shown only here. Recreating it replaces an older pending invitation for
            this athlete and email.
          </small>
        </section>
      ) : null}
    </form>
  );
}

export function RevokeFamilyInvitationButton({ slug, id }: { slug: string; id: string }) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  return (
    <div>
      <FeedbackButton
        className="button-secondary"
        type="button"
        busy={busy}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const r = await revokeFamilyInvitation(slug, id);
            setMessage(r.message);
          } catch {
            setMessage('Could not connect. Try again.');
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? 'Revoking…' : 'Revoke invitation'}
      </FeedbackButton>
      <p role="status">{message}</p>
    </div>
  );
}
