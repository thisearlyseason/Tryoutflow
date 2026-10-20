'use client';
import { useState } from 'react';
import { Button } from '../../../components/ui/button';
import { PasswordFields } from './password-fields';
import { unmetPasswordRequirements } from '../password-requirements';
export function ResetPasswordForm({ action }: { action: (fields: FormData) => Promise<void> }) {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  return (
    <form
      action={action}
      onSubmit={(event) => {
        const fields = new FormData(event.currentTarget);
        const candidate = String(fields.get('password') ?? '');
        const repeated = String(fields.get('confirmPassword') ?? '');
        setPassword(candidate);
        setConfirmation(repeated);
        if (unmetPasswordRequirements(candidate, repeated).length) event.preventDefault();
      }}
    >
      <PasswordFields
        passwordLabel="New password"
        password={password}
        confirmation={confirmation}
        setPassword={setPassword}
        setConfirmation={setConfirmation}
      />
      <Button className="mt-2 w-full" type="submit">
        Save new password
      </Button>
    </form>
  );
}
