'use client';

import { FeedbackButton } from '@/components/ui/button';

import { useState } from 'react';
import { previewNotice, queueNotice, type NoticePreview } from '../application/notice-actions';
export function NoticeDelivery({ slug, noticeId }: { slug: string; noticeId: string }) {
  const [preview, setPreview] = useState<NoticePreview>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [sent, setSent] = useState(false);
  return (
    <details className="talent-editor">
      <summary>Email reminder preview</summary>
      <p>
        Optional email reminders respect each linked contact’s communication permissions. Review
        every recipient before queueing.
      </p>
      <FeedbackButton
        busy={busy}
        className="button-secondary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const r = await previewNotice(slug, noticeId);
            setMessage(r.message);
            setPreview(r.preview);
            setSent(false);
          } catch {
            setMessage('Preview could not load.');
          } finally {
            setBusy(false);
          }
        }}
      >
        Refresh recipient preview
      </FeedbackButton>
      {preview && (
        <>
          <h4>{preview.title}</h4>
          <p className="talent-prose">{preview.body}</p>
          <ul>
            {preview.recipients.map((r) => (
              <li key={`${r.registration_id}:${r.guardian_id}`}>
                {r.name || 'Contact'} · {r.email} ·{' '}
                {r.eligible ? 'Eligible' : 'Suppressed by preferences'}
              </li>
            ))}
          </ul>
          <FeedbackButton
            className="button-primary"
            disabled={
              busy ||
              sent ||
              preview.status !== 'published' ||
              !preview.recipients.some((r) => r.eligible)
            }
            onClick={async () => {
              setBusy(true);
              try {
                const r = await queueNotice(slug, noticeId, preview.digest);
                setMessage(r.message);
                setSent(r.ok);
              } catch {
                setMessage(
                  'Connection interrupted. The same notice can be retried without duplicate messages.',
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            Queue email reminders to {preview.recipients.filter((r) => r.eligible).length} contacts
          </FeedbackButton>
        </>
      )}
      <p role="status">{message}</p>
    </details>
  );
}
