'use client';

import { FeedbackButton } from '@/components/ui/button';

import { useEffect, useState } from 'react';
import Link from 'next/link';
type Receipt = { id: string; dueAt: string; status: string };
export function AccountDeletionRequest() {
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [state, setState] = useState<'loading' | 'signed-out' | 'ready' | 'busy' | 'error'>(
    'loading',
  );
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/account/deletion', { signal: controller.signal, cache: 'no-store' })
      .then(async (response) => {
        if (response.status === 401) {
          setState('signed-out');
          return;
        }
        if (!response.ok) throw new Error('Unable to load your request.');
        const data = await response.json();
        setReceipt(data.request);
        setState('ready');
      })
      .catch(() => {
        if (!controller.signal.aborted) setState('error');
      });
    return () => controller.abort();
  }, []);
  async function submit() {
    if (!confirmed || state === 'busy') return;
    setState('busy');
    setMessage('');
    try {
      const response = await fetch('/api/account/deletion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true }),
      });
      const data = await response.json();
      if (response.status === 401) {
        setState('signed-out');
        return;
      }
      if (!response.ok) throw new Error(data.error ?? 'Request could not be saved.');
      setReceipt(data.request);
      setState('ready');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Request could not be saved.');
      setState('ready');
    }
  }
  return (
    <section aria-label="Submit account deletion request" className="my-8 rounded-xl border p-5">
      <h2 className="text-2xl font-bold">Delete your account</h2>
      {state === 'loading' ? (
        <p role="status">Loading request status…</p>
      ) : state === 'signed-out' ? (
        <p className="mt-3">
          <Link className="underline" href="/sign-in?next=%2Fdelete-account">
            Sign in to request account deletion
          </Link>
          . You can also use the support-assisted instructions below.
        </p>
      ) : state === 'error' ? (
        <p role="alert">
          Request status is unavailable. Reload this page or contact gamedaysportstech@gmail.com.
        </p>
      ) : receipt ? (
        <div role="status" className="mt-3">
          <p>
            Your request is saved. Completion is due by {new Date(receipt.dueAt).toLocaleString()}.
          </p>
          <p className="break-all">Reference: {receipt.id}</p>
          <p>
            We will coordinate any agreed ownership transfer or organization closure and email you
            when deletion is complete. Submitting this request has not deleted your account.
          </p>
        </div>
      ) : (
        <>
          <p className="mt-3">
            Request deletion of your account and associated personal information within seven days.
            We will arrange any agreed transfer of shared organization ownership, or confirm closure
            if no member remains. This does not silently transfer ownership or delete shared
            records.
          </p>
          <p className="mt-3">
            Cancel Apple or Google subscriptions in the store. You can request deletion before your
            subscription expires; we will coordinate web billing cancellation.
          </p>
          <label className="my-4 flex gap-3">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
              disabled={state === 'busy'}
            />
            <span>
              I want GameDay Technologies to delete my account and contact me about fulfillment.
            </span>
          </label>
          <FeedbackButton
            busy={state === 'busy'}
            className="button-primary"
            disabled={!confirmed || state === 'busy'}
            onClick={submit}
          >
            {state === 'busy' ? 'Saving request…' : 'Submit deletion request'}
          </FeedbackButton>
        </>
      )}
      {message ? (
        <p role="alert" className="mt-3">
          {message}
        </p>
      ) : null}
    </section>
  );
}
