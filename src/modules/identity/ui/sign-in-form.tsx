'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '../../../components/ui/button';
import { FormField } from '../../../components/ui/form-field';
import { Input } from '../../../components/ui/input';
import { PasswordInput } from '../../../components/ui/password-input';
import { TurnstileClientChallenge } from './turnstile-client';

// Cloudflare tokens expire after five minutes; allow time for the request to arrive.
const TOKEN_SUBMISSION_WINDOW_MS = 270_000;

export function SignInForm({
  next,
  siteKey,
  deterministicToken,
}: {
  next?: string;
  siteKey?: string;
  deterministicToken?: string;
}) {
  const [ready, setReady] = useState(Boolean(deterministicToken));
  const [pending, setPending] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const submitting = useRef(false);
  const verifiedAt = useRef<number | null>(null);
  const rememberVerification = useCallback((token: string) => {
    verifiedAt.current = token ? Date.now() : null;
  }, []);

  useEffect(() => {
    function restore(event: PageTransitionEvent) {
      if (!event.persisted) return;
      submitting.current = false;
      setPending(false);
      setReady(Boolean(deterministicToken));
      setResetKey((value) => value + 1);
    }
    window.addEventListener('pageshow', restore);
    return () => window.removeEventListener('pageshow', restore);
  }, [deterministicToken]);

  return (
    <form
      action="/auth/sign-in"
      method="post"
      onSubmit={(event) => {
        if (!ready || submitting.current) {
          event.preventDefault();
          return;
        }
        // Mobile browsers may suspend the provider's expiry callback while asleep.
        if (
          !deterministicToken &&
          (verifiedAt.current === null ||
            Date.now() - verifiedAt.current >= TOKEN_SUBMISSION_WINDOW_MS)
        ) {
          event.preventDefault();
          setReady(false);
          setResetKey((value) => value + 1);
          return;
        }
        submitting.current = true;
        setPending(true);
      }}
    >
      {next ? <input name="next" type="hidden" value={next} /> : null}
      <FormField htmlFor="email" label="Email" required>
        {({ describedBy }) => (
          <Input
            aria-describedby={describedBy}
            autoComplete="email"
            id="email"
            name="email"
            required
            type="email"
          />
        )}
      </FormField>
      <FormField htmlFor="password" label="Password" required>
        {({ describedBy }) => (
          <PasswordInput
            aria-describedby={describedBy}
            autoComplete="current-password"
            id="password"
            minLength={1}
            name="password"
            required
          />
        )}
      </FormField>
      <TurnstileClientChallenge
        action="sign_in"
        deterministicToken={deterministicToken}
        siteKey={siteKey}
        onReadyChange={setReady}
        onTokenChange={rememberVerification}
        resetKey={resetKey}
      />
      <Button className="mt-2 w-full" disabled={!ready} busy={pending} type="submit">
        Sign in
      </Button>
    </form>
  );
}
