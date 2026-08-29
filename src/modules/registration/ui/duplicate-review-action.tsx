'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function DuplicateReviewAction({
  organizationId,
  payload,
  label,
}: {
  organizationId: string;
  payload:
    | { action: 'resolve_import_duplicate'; previewId: string; row: number }
    | {
        action: 'resolve_registration_duplicate';
        candidateId: string;
        decision: 'keep_separate' | 'dismiss_candidate';
      };
  label: string;
}) {
  const router = useRouter();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  async function resolve() {
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch(`/api/organizations/${organizationId}/athlete-imports`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error('resolution_failed');
      setMessage('Decision recorded.');
      if (payload.action === 'resolve_import_duplicate') {
        router.push(`./import?previewId=${encodeURIComponent(payload.previewId)}`);
      } else {
        router.refresh();
      }
    } catch {
      setMessage('Could not record this decision. Refresh and try again.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mt-3">
      <button
        className="min-h-[var(--target-mobile)] rounded-[var(--radius-control)] border border-[var(--color-border)] px-4 font-bold"
        type="button"
        disabled={busy}
        onClick={resolve}
      >
        {busy ? 'Recording…' : label}
      </button>
      {message ? (
        <p className="mt-2 text-sm" role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}
