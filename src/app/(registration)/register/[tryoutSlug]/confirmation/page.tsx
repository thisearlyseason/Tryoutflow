'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';

type ConfirmationStatus =
  | 'loading'
  | 'pending'
  | 'unknown'
  | 'confirmed'
  | 'already_confirmed'
  | 'expired'
  | 'invalid'
  | 'rate_limited';

const sessionKey = 'tryoutflow:registration:confirmation';

function currentTryoutSlug() {
  return /^\/register\/([^/]+)\/confirmation\/?$/u.exec(window.location.pathname)?.[1] ?? '';
}

export default function RegistrationConfirmationPage() {
  const [status, setStatus] = useState<ConfirmationStatus>('loading');
  const [token, setToken] = useState<string | null>(null);
  const [tryoutSlug, setTryoutSlug] = useState('');
  const [guardianEmail, setGuardianEmail] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const slug = decodeURIComponent(currentTryoutSlug());
    setTryoutSlug(slug);
    const stored = window.sessionStorage.getItem(sessionKey);
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as { token?: unknown; tryoutSlug?: unknown };
        if (
          typeof parsed.token === 'string' &&
          /^[0-9a-f]{64}$/iu.test(parsed.token) &&
          parsed.tryoutSlug === slug
        ) {
          window.localStorage.removeItem(`tryoutflow:registration:${slug}:confirmed`);
          setToken(parsed.token.toLowerCase());
          setStatus('pending');
          return;
        }
      } catch {
        // Older or malformed browser state is intentionally discarded.
      }
      window.sessionStorage.removeItem(sessionKey);
    }
    if (
      slug &&
      window.localStorage.getItem(`tryoutflow:registration:${slug}:confirmed`) === 'true'
    ) {
      setStatus('confirmed');
      return;
    }
    setStatus('unknown');
  }, []);

  function persistConfirmed() {
    if (tryoutSlug) {
      window.localStorage.setItem(`tryoutflow:registration:${tryoutSlug}:confirmed`, 'true');
    }
    window.sessionStorage.removeItem(sessionKey);
    setToken(null);
  }

  async function confirm() {
    if (!token) return;
    setBusy(true);
    try {
      const response = await fetch('/api/public/registrations/confirmation', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const result = (await response.json()) as { status: ConfirmationStatus };
      setStatus(result.status);
      if (result.status === 'confirmed' || result.status === 'already_confirmed') {
        persistConfirmed();
      }
    } catch {
      setStatus('invalid');
    } finally {
      setBusy(false);
    }
  }

  async function reissue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || !guardianEmail) return;
    setBusy(true);
    try {
      const response = await fetch('/api/public/registrations/confirmation/reissue', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, guardianEmail }),
      });
      const result = (await response.json()) as {
        status: ConfirmationStatus | 'reissued';
        manualConfirmationToken?: string;
      };
      if (
        result.status === 'reissued' &&
        result.manualConfirmationToken &&
        /^[0-9a-f]{64}$/iu.test(result.manualConfirmationToken)
      ) {
        const nextToken = result.manualConfirmationToken.toLowerCase();
        window.sessionStorage.setItem(sessionKey, JSON.stringify({ token: nextToken, tryoutSlug }));
        setToken(nextToken);
        setGuardianEmail('');
        setStatus('pending');
      } else if (result.status === 'already_confirmed') {
        setStatus('already_confirmed');
        persistConfirmed();
      } else {
        setStatus(result.status === 'reissued' ? 'invalid' : result.status);
      }
    } catch {
      setStatus('invalid');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-xl p-6">
      <h1 className="text-2xl font-bold">Registration confirmation</h1>
      {status === 'loading' ? (
        <p className="mt-3" aria-live="polite">
          Checking confirmation status…
        </p>
      ) : status === 'confirmed' || status === 'already_confirmed' ? (
        <p className="mt-3">Your registration is confirmed.</p>
      ) : status === 'pending' && token ? (
        <>
          <p className="mt-3">
            Your registration is pending confirmation. Keep this one-time code private until you
            confirm it.
          </p>
          <code className="mt-3 block break-all">{token}</code>
          <button
            className="mt-4 min-h-[44px] rounded bg-[var(--color-primary)] px-4 text-white"
            onClick={confirm}
            disabled={busy}
          >
            {busy ? 'Confirming…' : 'Confirm registration'}
          </button>
        </>
      ) : status === 'unknown' || !token ? (
        <p className="mt-3" role="status">
          No confirmation code is available in this browser. Your registration may still be pending;
          contact the organization for help.
        </p>
      ) : null}
      {(status === 'invalid' || status === 'rate_limited') && (
        <p className="mt-3" role="alert">
          {status === 'rate_limited'
            ? 'Too many confirmation attempts. Wait before trying again.'
            : 'That confirmation code is invalid.'}
        </p>
      )}
      {(status === 'expired' || status === 'invalid') && token && (
        <section className="mt-4" aria-labelledby="reissue-heading">
          <h2 id="reissue-heading" className="font-semibold">
            {status === 'expired'
              ? 'This confirmation code has expired'
              : 'Request another confirmation code'}
          </h2>
          <p className="mt-2">
            Enter the guardian email used during registration to get a new code.
          </p>
          <form className="mt-3 grid gap-3" onSubmit={reissue}>
            <label>
              Guardian email
              <input
                className="min-h-[44px] w-full rounded border px-3"
                type="email"
                value={guardianEmail}
                onChange={(event) => setGuardianEmail(event.currentTarget.value)}
                required
              />
            </label>
            <button
              className="min-h-[44px] rounded bg-[var(--color-primary)] px-4 text-white"
              type="submit"
              disabled={busy}
            >
              {busy ? 'Requesting…' : 'Get a new confirmation code'}
            </button>
          </form>
        </section>
      )}
      <Link className="mt-6 inline-block underline" href="/">
        Return to TryoutFlow
      </Link>
    </main>
  );
}
