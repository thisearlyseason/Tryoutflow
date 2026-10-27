'use client';

import { useState } from 'react';
import { Button } from '../../../components/ui/button';
import { FormField } from '../../../components/ui/form-field';
import { Input } from '../../../components/ui/input';
import { PasswordFields } from './password-fields';
import { unmetPasswordRequirements } from '../password-requirements';
import { TurnstileClientChallenge } from './turnstile-client';
import { useBotProtectedSubmission } from './use-bot-protected-submission';

export function SignUpForm({
  siteKey,
  deterministicToken,
  emailPlaceholder,
  participant = false,
  next,
}: {
  siteKey?: string;
  deterministicToken?: string;
  emailPlaceholder: string;
  participant?: boolean;
  next?: string;
}) {
  const protection = useBotProtectedSubmission(deterministicToken);
  const { pending } = protection;
  const [validationError, setValidationError] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  return (
    <form
      action="/auth/sign-up"
      method="post"
      aria-busy={pending || undefined}
      onInvalid={() => setValidationError('Check your email and the password requirements below.')}
      onSubmit={(event) => {
        if (!protection.canSubmit()) {
          event.preventDefault();
          return;
        }
        // Validate the current form fields so password-manager autofill does not
        // depend on whether the browser emitted React change events.
        const fields = new FormData(event.currentTarget);
        const candidate = String(fields.get('password') ?? '');
        const repeated = String(fields.get('confirmPassword') ?? '');
        setPassword(candidate);
        setConfirmation(repeated);
        if (!event.currentTarget.checkValidity()) {
          event.preventDefault();
          setValidationError('Check your email and the password requirements below.');
          event.currentTarget.reportValidity();
          return;
        }
        if (unmetPasswordRequirements(candidate, repeated).length) {
          setValidationError('Check the password checklist and enter matching passwords.');
          event.preventDefault();
          return;
        }
        setValidationError('');
        protection.markSubmitted();
      }}
    >
      {validationError ? (
        <p role="alert" className="auth-alert">
          {validationError}
        </p>
      ) : null}
      {participant && <input type="hidden" name="purpose" value="participant" />}
      {participant && next ? <input type="hidden" name="next" value={next} /> : null}
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
            placeholder={emailPlaceholder}
            required
            type="email"
          />
        )}
      </FormField>
      <PasswordFields
        password={password}
        confirmation={confirmation}
        setPassword={setPassword}
        setConfirmation={setConfirmation}
      />
      <TurnstileClientChallenge
        action="sign_up"
        siteKey={siteKey}
        deterministicToken={deterministicToken}
        onReadyChange={protection.onReadyChange}
        onTokenChange={protection.onTokenChange}
        resetKey={protection.resetKey}
      />
      <Button
        className="mt-2 w-full"
        busy={pending}
        disabled={!protection.ready || pending}
        type="submit"
      >
        {pending ? 'Creating account…' : 'Create account'}
      </Button>
    </form>
  );
}
