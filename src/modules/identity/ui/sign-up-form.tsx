'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '../../../components/ui/button';
import { FormField } from '../../../components/ui/form-field';
import { Input } from '../../../components/ui/input';
import { PasswordFields } from './password-fields';
import { unmetPasswordRequirements } from '../password-requirements';

export function SignUpForm({
  botChallenge,
  emailPlaceholder,
  participant = false,
}: {
  botChallenge: ReactNode;
  emailPlaceholder: string;
  participant?: boolean;
}) {
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  useEffect(() => {
    const restore = () => {
      submitting.current = false;
      setPending(false);
    };
    window.addEventListener('pageshow', restore);
    return () => window.removeEventListener('pageshow', restore);
  }, []);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  return (
    <form
      action="/auth/sign-up"
      method="post"
      onSubmit={(event) => {
        if (submitting.current) {
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
        if (unmetPasswordRequirements(candidate, repeated).length) {
          event.preventDefault();
          return;
        }
        submitting.current = true;
        setPending(true);
      }}
    >
      {participant && <input type="hidden" name="purpose" value="participant" />}
      <FormField htmlFor="email" label="Email" required>
        {({ describedBy }) => (
          <Input
            aria-describedby={describedBy}
            autoComplete="email"
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
      {botChallenge}
      <Button className="mt-2 w-full" busy={pending} type="submit">
        Create account
      </Button>
    </form>
  );
}
