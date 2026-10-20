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
  const [validationError, setValidationError] = useState('');
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
      aria-busy={pending || undefined}
      onInvalid={() => setValidationError('Enter a valid email address and your password.')}
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
        if (!event.currentTarget.checkValidity()) {
          event.preventDefault();
          setValidationError('Enter a valid email address and your password.');
          event.currentTarget.reportValidity();
          return;
        }
        setValidationError('');
        submitting.current = true;
        setPending(true);
      }}
    >
      {validationError ? (
        <p role="alert" className="auth-alert">
          {validationError}
        </p>
      ) : null}
      {next ? <input name="next" type="hidden" value={next} /> : null}
      <FormField htmlFor="email" label="Email" required>
        {({ describedBy }) => (
          <Input
            aria-describedby={describedBy}
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            inputMode="email"
            maxLength={254}
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
            maxLength={128}
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
        {pending ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  );
}
