'use client';

import { FeedbackButton } from '@/components/ui/button';

import { useEffect, useRef, useState, useTransition } from 'react';
import { unstable_rethrow, useRouter } from 'next/navigation';
import { createCalibration, submitCalibration } from '../application/calibration-actions';
export function CalibrationForm({ slug, caseId }: { slug: string; caseId?: string }) {
  const [id, setId] = useState(() => crypto.randomUUID());
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);
  const submitting = useRef(false);
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (!busy && failed) errorRef.current?.focus();
  }, [busy, failed]);
  return (
    <form
      className="talent-form"
      key={id}
      aria-busy={busy}
      onSubmit={(e) => {
        e.preventDefault();
        if (submitting.current || saved) return;
        submitting.current = true;
        const f = Object.fromEntries(new FormData(e.currentTarget));
        setBusy(true);
        setFailed(false);
        setMessage('Saving…');
        startTransition(async () => {
          try {
            const r = caseId
              ? await submitCalibration(slug, { ...f, case_id: caseId })
              : await createCalibration(slug, { ...f, id });
            setMessage(r.message);
            if (r.ok) {
              setSaved(true);
              router.refresh();
            } else {
              setFailed(true);
            }
          } catch (error) {
            unstable_rethrow(error);
            setFailed(true);
            setMessage(
              'We could not confirm this save. Your entries are still here. Check calibration in another tab before trying again.',
            );
          } finally {
            setBusy(false);
            submitting.current = false;
          }
        });
      }}
    >
      <h3>{caseId ? 'Score this calibration case' : 'Create a calibration case'}</h3>
      {failed && !busy && (
        <p ref={errorRef} tabIndex={-1} className="talent-error" role="alert">
          {message}
        </p>
      )}
      <fieldset disabled={busy || saved} className="talent-fieldset">
        {caseId ? (
          <>
            <label>
              Score (1–10)
              <input name="score" type="number" min="1" max="10" step="1" required />
            </label>
            <label>
              Evidence and rationale
              <textarea name="rationale" required maxLength={4000} />
            </label>
          </>
        ) : (
          <>
            <label>
              Title
              <input name="title" required maxLength={160} />
            </label>
            <label>
              Observation / evidence to assess
              <textarea name="prompt" required maxLength={8000} />
            </label>
            <label>
              Rubric anchors and scale guidance
              <textarea name="guidance" required maxLength={4000} />
            </label>
            <label>
              Reference score (1–10)
              <input name="anchor" type="number" min="1" max="10" step="1" required />
            </label>
            <label>
              Reference reasoning
              <textarea name="explanation" required maxLength={4000} />
            </label>
          </>
        )}
      </fieldset>
      <FeedbackButton busy={busy} className="button-primary" disabled={busy || saved}>
        {busy ? 'Saving…' : saved ? 'Saved' : caseId ? 'Submit assessment' : 'Create case'}
      </FeedbackButton>
      {saved && !caseId && (
        <FeedbackButton
          type="button"
          className="button-secondary"
          onClick={() => {
            setId(crypto.randomUUID());
            setSaved(false);
            setMessage('');
            setFailed(false);
          }}
        >
          Create another
        </FeedbackButton>
      )}
      <p role="status">{failed ? '' : message}</p>
    </form>
  );
}
