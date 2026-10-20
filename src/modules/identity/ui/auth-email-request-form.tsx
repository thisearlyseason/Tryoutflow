'use client';

import { useState } from 'react';
import { Button } from '../../../components/ui/button';
import { FormField } from '../../../components/ui/form-field';
import { Input } from '../../../components/ui/input';
import { TurnstileClientChallenge } from './turnstile-client';
import { useBotProtectedSubmission } from './use-bot-protected-submission';

export function AuthEmailRequestForm({
  action,
  participant = false,
  siteKey,
  deterministicToken,
}: {
  action: 'recovery' | 'verification';
  participant?: boolean;
  siteKey?: string;
  deterministicToken?: string;
}) {
  const protection = useBotProtectedSubmission(deterministicToken);
  const [validationError, setValidationError] = useState('');
  const label = action === 'recovery' ? 'Send reset instructions' : 'Send verification link';
  return (
    <form
      action={action === 'recovery' ? '/auth/recovery' : '/auth/verification'}
      method="post"
      aria-busy={protection.pending || undefined}
      onInvalid={() => setValidationError('Enter a valid email address.')}
      onSubmit={(event) => {
        if (!protection.canSubmit()) {
          event.preventDefault();
          return;
        }
        if (!event.currentTarget.checkValidity()) {
          event.preventDefault();
          setValidationError('Enter a valid email address.');
          event.currentTarget.reportValidity();
          return;
        }
        setValidationError('');
        protection.markSubmitted();
      }}
    >
      {validationError ? (
        <p className="auth-alert" role="alert">
          {validationError}
        </p>
      ) : null}
      {action === 'verification' && participant ? (
        <input type="hidden" name="purpose" value="participant" />
      ) : null}
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
      <TurnstileClientChallenge
        action={action}
        siteKey={siteKey}
        deterministicToken={deterministicToken}
        onReadyChange={protection.onReadyChange}
        onTokenChange={protection.onTokenChange}
        resetKey={protection.resetKey}
      />
      <Button
        className="mt-2 w-full"
        busy={protection.pending}
        disabled={!protection.ready || protection.pending}
        type="submit"
      >
        {protection.pending
          ? action === 'recovery'
            ? 'Sending reset instructions…'
            : 'Sending verification link…'
          : label}
      </Button>
    </form>
  );
}
