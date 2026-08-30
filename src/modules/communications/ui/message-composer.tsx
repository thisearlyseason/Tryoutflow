'use client';

import { useState, useTransition } from 'react';

import { Button } from '../../../components/ui/button';
import type { BatchConfirmation, RecipientPreview } from '../application/create-message-batch';
import type { DecisionMessageKind } from '../application/render-message';

type ActionResult =
  | RecipientPreview
  | { outcome: 'forbidden' | 'invalid_input' | 'stale_snapshot' | 'preview_conflict' };

export function MessageComposer({
  rosterVersions,
  previewAction,
  sendAction,
}: {
  rosterVersions: readonly { id: string; label: string }[];
  previewAction(input: unknown): Promise<ActionResult>;
  sendAction(input: unknown): Promise<{ outcome: string; queuedCount?: number }>;
}) {
  const [rosterVersionId, setRosterVersionId] = useState(rosterVersions[0]?.id ?? '');
  const [kind, setKind] = useState<DecisionMessageKind>('selected');
  const [editableText, setEditableText] = useState('Thank you for taking part in this tryout.');
  const [preview, setPreview] = useState<RecipientPreview>();
  const [status, setStatus] = useState('');
  const [pending, startTransition] = useTransition();

  function requestPreview() {
    startTransition(async () => {
      setStatus('Loading exact recipient preview…');
      const result = await previewAction({ rosterVersionId, kind, editableText });
      if ('outcome' in result) {
        setPreview(undefined);
        setStatus(
          result.outcome === 'stale_snapshot'
            ? 'The finalized roster changed. Refresh and review again.'
            : 'Preview is unavailable.',
        );
        return;
      }
      setPreview(result);
      setStatus(`Preview ready for ${result.count} recipient${result.count === 1 ? '' : 's'}.`);
    });
  }

  function confirmSend() {
    if (!preview) return;
    const confirmation: BatchConfirmation = { ...preview, confirmation: 'SEND EXACT BATCH' };
    startTransition(async () => {
      setStatus('Creating the confirmed batch…');
      const result = await sendAction(confirmation);
      if (result.outcome === 'queued' || result.outcome === 'replayed') {
        setStatus(
          `${result.queuedCount ?? preview.count} message${preview.count === 1 ? '' : 's'} queued. Decisions were not changed.`,
        );
        setPreview(undefined);
      } else {
        setStatus(
          result.outcome === 'stale_snapshot' || result.outcome === 'preview_conflict'
            ? 'The exact preview is stale. Review recipients again before sending.'
            : 'The batch was not created. No message was queued.',
        );
      }
    });
  }

  return (
    <section aria-labelledby="compose-heading" className="grid gap-5">
      <div>
        <p className="text-sm font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
          Decision messages
        </p>
        <h2 id="compose-heading" className="text-2xl font-bold">
          Prepare a confirmed batch
        </h2>
        <p className="mt-2 max-w-2xl text-sm text-[var(--color-text-muted)]">
          Roster, decision, athlete, team, recipient, and snapshot facts are protected. Only the
          organization message below is editable.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-2 font-semibold">
          Finalized roster
          <select
            className="min-h-[var(--target-mobile)] rounded-[var(--radius-control)] border px-3"
            style={{ height: 'var(--target-mobile)', minHeight: 'var(--target-mobile)' }}
            value={rosterVersionId}
            onChange={(event) => {
              setRosterVersionId(event.target.value);
              setPreview(undefined);
            }}
          >
            {rosterVersions.map((roster) => (
              <option key={roster.id} value={roster.id}>
                {roster.label}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-2 font-semibold">
          Decision
          <select
            className="min-h-[var(--target-mobile)] rounded-[var(--radius-control)] border px-3"
            style={{ height: 'var(--target-mobile)', minHeight: 'var(--target-mobile)' }}
            value={kind}
            onChange={(event) => {
              setKind(event.target.value as DecisionMessageKind);
              setPreview(undefined);
            }}
          >
            <option value="callback">Callback</option>
            <option value="selected">Selected</option>
            <option value="waitlisted">Waitlist</option>
            <option value="released">Release</option>
          </select>
        </label>
      </div>
      <label className="grid gap-2 font-semibold">
        Organization message
        <textarea
          className="min-h-36 rounded-[var(--radius-control)] border p-3"
          style={{ minHeight: '9rem' }}
          maxLength={4000}
          value={editableText}
          onChange={(event) => {
            setEditableText(event.target.value);
            setPreview(undefined);
          }}
        />
        <span className="text-sm font-normal text-[var(--color-text-muted)]">
          {editableText.length} of 4,000 characters
        </span>
      </label>
      <div className="flex flex-wrap gap-3">
        <Button
          disabled={pending || !rosterVersionId || !editableText.trim()}
          onClick={requestPreview}
        >
          Preview exact recipients
        </Button>
      </div>
      {preview ? (
        <section
          aria-labelledby="recipient-preview"
          className="rounded-[var(--radius-surface)] border p-4"
        >
          <h3 id="recipient-preview" className="text-lg font-bold">
            Exact recipient preview · {preview.count}
          </h3>
          <ul className="mt-3 grid gap-2">
            {preview.recipients.map((recipient) => (
              <li
                key={recipient.registrationId}
                className="flex flex-wrap justify-between gap-2 border-b py-2"
              >
                <span>{recipient.athletePreferredName}</span>
                <span>{recipient.recipientEmail}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-sm">
            Sending email cannot change a roster decision. Provider failures appear separately in
            delivery status.
          </p>
          <Button className="mt-3" disabled={pending} onClick={confirmSend}>
            Confirm and queue exactly {preview.count}
          </Button>
        </section>
      ) : null}
      <p aria-live="polite" role="status">
        {status}
      </p>
    </section>
  );
}
