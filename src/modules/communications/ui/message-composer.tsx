'use client';

import { useState, useTransition } from 'react';

import { FIELD_EXAMPLES } from '../../../components/forms/field-examples';
import { Button } from '../../../components/ui/button';
import type { RecipientPreview } from '../application/create-message-batch';
import type { DecisionMessageKind } from '../application/render-message';

type ActionResult =
  | RecipientPreview
  | { outcome: 'forbidden' | 'invalid_input' | 'stale_snapshot' | 'preview_conflict' };

export function MessageComposer({
  rosterVersions,
  templates = {},
  canSaveTemplates = false,
  previewAction,
  sendAction,
  saveTemplateAction,
}: {
  rosterVersions: readonly { id: string; label: string }[];
  templates?: Partial<
    Record<DecisionMessageKind, { id: string; editableText: string; version: number }>
  >;
  canSaveTemplates?: boolean;
  previewAction(input: unknown): Promise<ActionResult>;
  sendAction(input: unknown): Promise<{ outcome: string; queuedCount?: number }>;
  saveTemplateAction?(input: unknown): Promise<{
    outcome: string;
    version?: number;
    templateId?: string;
  }>;
}) {
  const [rosterVersionId, setRosterVersionId] = useState(rosterVersions[0]?.id ?? '');
  const [kind, setKind] = useState<DecisionMessageKind>('selected');
  const [editableText, setEditableText] = useState(
    templates.selected?.editableText ?? 'Thank you for taking part in this tryout.',
  );
  const [templateTexts, setTemplateTexts] = useState<Partial<Record<DecisionMessageKind, string>>>(
    () =>
      Object.fromEntries(
        Object.entries(templates).map(([key, value]) => [key, value?.editableText]),
      ),
  );
  const [templateVersions, setTemplateVersions] = useState<
    Partial<Record<DecisionMessageKind, number>>
  >(() =>
    Object.fromEntries(Object.entries(templates).map(([key, value]) => [key, value?.version])),
  );
  const [templateIds, setTemplateIds] = useState<Partial<Record<DecisionMessageKind, string>>>(() =>
    Object.fromEntries(Object.entries(templates).map(([key, value]) => [key, value?.id])),
  );
  const [preview, setPreview] = useState<RecipientPreview>();
  const [confirmation, setConfirmation] = useState('');
  const [status, setStatus] = useState('');
  const [pending, startTransition] = useTransition();

  function requestPreview() {
    startTransition(async () => {
      setStatus('Loading exact recipient preview…');
      const result = await previewAction({
        rosterVersionId,
        kind,
        editableText,
        templateId: templateIds[kind] ?? `builtin:${kind}`,
        expectedTemplateVersion: templateVersions[kind] ?? 1,
      });
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
      setConfirmation('');
      setStatus(`Preview ready for ${result.count} recipient${result.count === 1 ? '' : 's'}.`);
    });
  }

  function confirmSend() {
    if (!preview) return;
    startTransition(async () => {
      setStatus('Creating the confirmed batch…');
      const result = await sendAction({
        organizationId: preview.organizationId,
        tryoutId: preview.tryoutId,
        divisionId: preview.divisionId,
        rosterVersionId: preview.rosterVersionId,
        digest: preview.digest,
        previewToken: preview.previewToken,
        confirmation,
      });
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
    <section
      aria-labelledby="compose-heading"
      className="admin-panel grid gap-5 rounded-[var(--radius-surface)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-[var(--shadow-surface)]"
      data-testid="message-setup"
    >
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
              const nextKind = event.target.value as DecisionMessageKind;
              setKind(nextKind);
              setEditableText(
                templateTexts[nextKind] ?? 'Thank you for taking part in this tryout.',
              );
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
          placeholder={
            editableText ? undefined : `Share next steps for ${FIELD_EXAMPLES.tryoutName}`
          }
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
        {saveTemplateAction && canSaveTemplates ? (
          <Button
            variant="secondary"
            disabled={pending || !editableText.trim()}
            onClick={() =>
              startTransition(async () => {
                setStatus('Saving the organization template…');
                const result = await saveTemplateAction({
                  kind,
                  editableText,
                  expectedVersion: templateVersions[kind] ?? 0,
                });
                if (result.outcome === 'saved' && result.version) {
                  setTemplateVersions((current) => ({ ...current, [kind]: result.version }));
                  if (result.templateId)
                    setTemplateIds((current) => ({ ...current, [kind]: result.templateId }));
                  setTemplateTexts((current) => ({ ...current, [kind]: editableText.trim() }));
                  setStatus('Organization template saved.');
                } else {
                  setStatus(
                    result.outcome === 'version_conflict'
                      ? 'The template changed elsewhere. Refresh before saving.'
                      : 'Template was not saved.',
                  );
                }
              })
            }
          >
            Save template
          </Button>
        ) : null}
      </div>
      {preview ? (
        <section
          aria-labelledby="recipient-preview"
          className="rounded-[var(--radius-surface)] border border-[var(--color-border-strong)] bg-[var(--color-surface-muted)] p-4"
        >
          <h3 id="recipient-preview" className="text-lg font-bold">
            Exact recipient preview · {preview.count}
          </h3>
          <h4 className="mt-3 font-bold">Exact rendered messages</h4>
          <div className="mt-3 grid gap-3">
            {preview.recipients.map((recipient) => (
              <details
                key={recipient.registrationId}
                className="rounded-[var(--radius-control)] border p-3"
              >
                <summary className="min-h-11 cursor-pointer py-2 font-semibold">
                  {recipient.athletePreferredName} · {recipient.recipientEmail}
                </summary>
                <article className="grid min-w-0 gap-3 pt-3">
                  <p>
                    <strong>Subject:</strong> {recipient.subject}
                  </p>
                  <div>
                    <h4 className="font-bold">Plain text</h4>
                    <pre className="mt-1 whitespace-pre-wrap break-words font-sans text-sm">
                      {recipient.text}
                    </pre>
                  </div>
                  <div>
                    <h4 className="font-bold">HTML preview</h4>
                    <iframe
                      className="mt-1 min-h-48 w-full rounded border bg-white"
                      sandbox=""
                      srcDoc={recipient.html}
                      title={`HTML message preview for ${recipient.athletePreferredName}`}
                    />
                  </div>
                  <div>
                    <h4 className="font-bold">Exact HTML source</h4>
                    <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all text-xs">
                      {recipient.html}
                    </pre>
                  </div>
                </article>
              </details>
            ))}
          </div>
          <p className="mt-4 text-sm">
            Sending email cannot change a roster decision. Provider failures appear separately in
            delivery status.
          </p>
          <label className="mt-4 grid gap-2 font-semibold">
            Type SEND EXACT BATCH to confirm
            <input
              className="min-h-11 rounded-[var(--radius-control)] border px-3"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              autoComplete="off"
            />
          </label>
          <Button
            className="mt-3"
            disabled={pending || confirmation !== 'SEND EXACT BATCH'}
            onClick={confirmSend}
          >
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
