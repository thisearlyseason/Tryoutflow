'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '../../../components/ui/button';
import { FormField } from '../../../components/ui/form-field';
import { Input } from '../../../components/ui/input';

export function EmailVerificationForm({
  botChallenge,
  participant = false,
}: {
  botChallenge: ReactNode;
  participant?: boolean;
}) {
  const submitting = useRef(false);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    const restore = () => {
      submitting.current = false;
      setPending(false);
    };
    window.addEventListener('pageshow', restore);
    return () => window.removeEventListener('pageshow', restore);
  }, []);
  return (
    <form
      action="/auth/verification"
      method="post"
      onSubmit={(event) => {
        if (submitting.current) {
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
            required
            type="email"
          />
        )}
      </FormField>
      {botChallenge}
      <Button className="mt-2 w-full" busy={pending} type="submit">
        Send verification link
      </Button>
    </form>
  );
}
