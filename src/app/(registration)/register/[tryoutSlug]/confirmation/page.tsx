'use client';

import Link from 'next/link';
import { useState } from 'react';

export default function RegistrationConfirmationPage() {
  const [status, setStatus] = useState<'pending' | 'confirmed' | 'invalid'>('pending');
  const [token, setToken] = useState<string | null>(() =>
    typeof window === 'undefined'
      ? null
      : window.sessionStorage.getItem('tryoutflow:registration:confirmation'),
  );

  async function confirm() {
    if (!token) return;
    const response = await fetch('/api/public/registrations/confirmation', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    const result = (await response.json()) as { status: 'confirmed' | 'invalid' };
    setStatus(result.status);
    if (result.status === 'confirmed') {
      window.sessionStorage.removeItem('tryoutflow:registration:confirmation');
      setToken(null);
    }
  }
  return (
    <main className="mx-auto max-w-xl p-6">
      <h1 className="text-2xl font-bold">Registration confirmation</h1>
      {status === 'confirmed' ? (
        <p className="mt-3">Your registration is confirmed.</p>
      ) : token ? (
        <>
          <p className="mt-3">
            Your registration is pending confirmation. Keep this one-time code private until you
            confirm it.
          </p>
          <code className="mt-3 block break-all">{token}</code>
          <button
            className="mt-4 min-h-[44px] rounded bg-[var(--color-primary)] px-4 text-white"
            onClick={confirm}
          >
            Confirm registration
          </button>
        </>
      ) : (
        <p className="mt-3" role="status">
          No confirmation code is available in this browser. Your registration may still be pending;
          contact the organization for help.
        </p>
      )}
      {status === 'invalid' && (
        <p className="mt-3" role="alert">
          That confirmation code is invalid or expired.
        </p>
      )}
      <Link className="mt-6 inline-block underline" href="/">
        Return to TryoutFlow
      </Link>
    </main>
  );
}
