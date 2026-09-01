'use client';

import Image from 'next/image';
import { useActionState } from 'react';

type QrState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'issued'; lookupUrl: string; qrDataUrl: string };

export function IssueQrButton({
  action,
  registrationId,
}: {
  action: (previous: QrState, formData: FormData) => Promise<QrState>;
  registrationId: string;
}) {
  const [state, submit, pending] = useActionState(action, { status: 'idle' });
  return (
    <div className="grid gap-2">
      <form action={submit}>
        <input name="registrationId" type="hidden" value={registrationId} />
        <button className="min-h-11 rounded border px-3" disabled={pending} type="submit">
          {pending ? 'Issuing QR…' : 'Issue check-in QR'}
        </button>
      </form>
      {state.status === 'error' ? <p role="alert">{state.message}</p> : null}
      {state.status === 'issued' ? (
        <div className="grid gap-2" role="status">
          <Image
            alt="Check-in lookup QR code"
            height={180}
            src={state.qrDataUrl}
            unoptimized
            width={180}
          />
          <a className="underline" href={state.lookupUrl}>
            Open QR-assisted lookup
          </a>
          <p className="text-sm text-[var(--color-text-muted)]">
            This QR expires in 24 hours and is replaced when a new one is issued.
          </p>
        </div>
      ) : null}
    </div>
  );
}

export type { QrState };
