import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { EmailVerificationForm } from '../../src/modules/identity/ui/email-verification-form';
import { SignUpForm } from '../../src/modules/identity/ui/sign-up-form';

it('resend immediately indicates busy, rejects repeated submits, and recovers on history return', () => {
  const { container } = render(
    <EmailVerificationForm
      participant
      botChallenge={<input name="cf-turnstile-response" value="synthetic-token" readOnly />}
    />,
  );
  const form = container.querySelector('form')!;
  expect(form.action).toContain('/auth/verification');
  expect(container.querySelector('input[name="purpose"]')).toHaveValue('participant');
  expect(fireEvent.submit(form)).toBe(true);
  expect(screen.getByRole('button', { name: 'Send verification link' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Send verification link' })).toHaveAttribute(
    'aria-busy',
    'true',
  );
  expect(fireEvent.submit(form)).toBe(false);
  fireEvent(window, new Event('pageshow'));
  expect(screen.getByRole('button', { name: 'Send verification link' })).not.toBeDisabled();
  expect(fireEvent.submit(form)).toBe(true);
});

it('signup preserves autofill, busy/repeat guard and retry after returning to the form', () => {
  const { container } = render(
    <SignUpForm
      botChallenge={<input name="cf-turnstile-response" value="synthetic-token" readOnly />}
      emailPlaceholder="synthetic@example.test"
    />,
  );
  const form = container.querySelector('form')!;
  (screen.getByLabelText('Password', { exact: true }) as HTMLInputElement).value =
    'SyntheticOnly-123';
  (screen.getByLabelText(/^Confirm password/) as HTMLInputElement).value = 'SyntheticOnly-123';
  expect(fireEvent.submit(form)).toBe(true);
  expect(screen.getByRole('button', { name: 'Create account' })).toBeDisabled();
  expect(fireEvent.submit(form)).toBe(false);
  fireEvent(window, new Event('pageshow'));
  expect(screen.getByRole('button', { name: 'Create account' })).not.toBeDisabled();
  expect(fireEvent.submit(form)).toBe(true);
});
