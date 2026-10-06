'use client';
import { useEffect, useRef } from 'react';
import { FormField } from '../../../components/ui/form-field';
import { Input } from '../../../components/ui/input';
import { unmetPasswordRequirements } from '../password-requirements';
export function PasswordFields({
  password,
  confirmation,
  setPassword,
  setConfirmation,
  passwordLabel = 'Password',
}: {
  passwordLabel?: string;
  password: string;
  confirmation: string;
  setPassword: (value: string) => void;
  setConfirmation: (value: string) => void;
}) {
  const passwordInput = useRef<HTMLInputElement>(null);
  const confirmationInput = useRef<HTMLInputElement>(null);
  const callbacks = useRef({ setPassword, setConfirmation });
  callbacks.current = { setPassword, setConfirmation };
  function syncFields() {
    if (passwordInput.current) callbacks.current.setPassword(passwordInput.current.value);
    if (confirmationInput.current)
      callbacks.current.setConfirmation(confirmationInput.current.value);
  }
  useEffect(() => {
    // Preserve input/password-manager values entered before hydration or history restoration.
    syncFields();
    window.addEventListener('pageshow', syncFields);
    return () => window.removeEventListener('pageshow', syncFields);
  }, []);
  const missing = unmetPasswordRequirements(password, confirmation);
  return (
    <>
      <FormField
        description="Use 8–128 characters, including a lowercase letter, an uppercase letter, a number, and a symbol."
        htmlFor="password"
        label={passwordLabel}
        required
      >
        {({ describedBy }) => (
          <Input
            aria-describedby={[describedBy, 'password-requirements'].filter(Boolean).join(' ')}
            autoComplete="new-password"
            ref={passwordInput}
            onFocus={syncFields}
            onBlur={syncFields}
            id="password"
            maxLength={128}
            minLength={8}
            name="password"
            onChange={(e) => setPassword(e.target.value)}
            required
            type="password"
          />
        )}
      </FormField>
      <FormField htmlFor="confirmPassword" label="Confirm password" required>
        {({ describedBy }) => (
          <Input
            aria-describedby={[describedBy, 'password-requirements'].filter(Boolean).join(' ')}
            autoComplete="new-password"
            ref={confirmationInput}
            onFocus={syncFields}
            onBlur={syncFields}
            id="confirmPassword"
            maxLength={128}
            minLength={8}
            name="confirmPassword"
            onChange={(e) => setConfirmation(e.target.value)}
            required
            type="password"
          />
        )}
      </FormField>
      <p
        aria-live="polite"
        className="text-sm text-slate-600"
        id="password-requirements"
        role="status"
      >
        {password || confirmation
          ? missing.length
            ? `Still needed: ${missing.join(', ')}.`
            : 'Passwords match and meet all requirements.'
          : 'Both password fields must match exactly.'}
      </p>
      <ul aria-label="Password checklist" className="mb-3 space-y-1 text-sm">
        {[
          { label: '8–128 characters', met: password.length >= 8 && password.length <= 128 },
          { label: 'A lowercase letter', met: /[a-z]/u.test(password) },
          { label: 'An uppercase letter', met: /[A-Z]/u.test(password) },
          { label: 'A number', met: /\d/u.test(password) },
          { label: 'A special character (not a space)', met: /[^A-Za-z0-9\s]/u.test(password) },
          { label: 'Passwords match', met: Boolean(confirmation) && password === confirmation },
        ].map(({ label, met }) => (
          <li className={met ? 'text-emerald-700' : 'text-slate-600'} key={label}>
            <span aria-hidden="true">{met ? '✓' : '○'} </span>
            {label}
            <span className="sr-only">: {met ? 'met' : 'still needed'}</span>
          </li>
        ))}
      </ul>
    </>
  );
}
