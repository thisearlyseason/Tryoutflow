'use client';

import { FeedbackButton } from '@/components/ui/button';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createCalibration, submitCalibration } from '../application/calibration-actions';
export function CalibrationForm({ slug, caseId }: { slug: string; caseId?: string }) {
  const [id, setId] = useState(() => crypto.randomUUID());
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const router = useRouter();
  return (
    <form
      className="talent-form"
      key={id}
      onSubmit={async (e) => {
        e.preventDefault();
        const f = Object.fromEntries(new FormData(e.currentTarget));
        setBusy(true);
        try {
          const r = caseId
            ? await submitCalibration(slug, { ...f, case_id: caseId })
            : await createCalibration(slug, { ...f, id });
          setMessage(r.message);
          if (r.ok) {
            setSaved(true);
            router.refresh();
          }
        } catch {
          setMessage('Connection interrupted. Your entries remain here.');
        } finally {
          setBusy(false);
        }
      }}
    >
      <h3>{caseId ? 'Score this calibration case' : 'Create a calibration case'}</h3>
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
          }}
        >
          Create another
        </FeedbackButton>
      )}
      <p role="status">{message}</p>
    </form>
  );
}
