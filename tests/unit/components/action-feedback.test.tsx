import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { Button } from '../../../src/components/ui/button';
import { SignUpForm } from '../../../src/modules/identity/ui/sign-up-form';
import { nativeContext } from '../../../src/modules/identity/native-context';
import { readBillingJson } from '../../../src/modules/subscriptions/application/billing-route-boundary';
afterEach(cleanup);
test('an asynchronous action shows busy immediately, runs once, exposes rejection and permits retry', async () => {
  let reject!: (error: Error) => void;
  const action = vi.fn(
    () =>
      new Promise<void>((_resolve, r) => {
        reject = r;
      }),
  );
  render(<Button onClick={action}>Save</Button>);
  const button = screen.getByRole('button', { name: 'Save' });
  act(() => {
    fireEvent.click(button);
    fireEvent.click(button);
  });
  expect(action).toHaveBeenCalledTimes(1);
  expect(button).toHaveAttribute('aria-busy', 'true');
  expect(button).toBeDisabled();
  await act(async () => reject(new Error('fixture network failure')));
  expect(screen.getByRole('alert')).toHaveTextContent('Please try again');
  expect(button).not.toBeDisabled();
});
test('server-action pending state disables repeat submission and resets on completion', async () => {
  let finish!: () => void;
  const action = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  render(
    <form action={action}>
      <Button type="submit">Confirm</Button>
    </form>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  await screen.findByText('Working…');
  expect(screen.getByRole('button', { name: /Confirm/ })).toBeDisabled();
  expect(action).toHaveBeenCalledTimes(1);
  await act(async () => finish());
  expect(screen.getByRole('button', { name: 'Confirm' })).not.toBeDisabled();
});
test('valid native HTTP signup submissions show status and reject a repeated submit, then recover after back navigation', () => {
  const { container } = render(
    <SignUpForm
      botChallenge={<input name="cf-turnstile-response" value="fixture-token" readOnly />}
      emailPlaceholder="owner@example.test"
    />,
  );
  const form = container.querySelector('form')!;
  (form.elements.namedItem('email') as HTMLInputElement).value = 'synthetic@example.test';
  (form.elements.namedItem('password') as HTMLInputElement).value = 'Fixture8!';
  (form.elements.namedItem('confirmPassword') as HTMLInputElement).value = 'Fixture8!';
  expect(fireEvent.submit(form)).toBe(true);
  expect(screen.getByRole('button', { name: /Create account/ })).toBeDisabled();
  expect(fireEvent.submit(form)).toBe(false);
  act(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  expect(screen.getByRole('button', { name: 'Create account' })).not.toBeDisabled();
});
test('native device marker never permits web checkout and unrecognized values do not become native contexts', async () => {
  expect(nativeContext('other=x; tryoutflow-native=apple')).toBe('apple');
  expect(nativeContext('tryoutflow-native=arbitrary')).toBeNull();
  const req = new Request('https://www.tryout.agency/api/billing', {
    method: 'POST',
    headers: {
      cookie: 'tryoutflow-native=google',
      'content-type': 'application/json',
      origin: 'https://www.tryout.agency',
    },
    body: '{}',
  });
  await expect(readBillingJson(req, 'https://www.tryout.agency')).rejects.toEqual({ status: 403 });
});

test('invalid confirmation followed immediately by valid autofill submits once without a stale native lock', () => {
  const { container } = render(
    <SignUpForm botChallenge={<div />} emailPlaceholder="owner@example.invalid" />,
  );
  const form = container.querySelector('form')!;
  (form.elements.namedItem('password') as HTMLInputElement).value = 'Abc12!xy';
  (form.elements.namedItem('confirmPassword') as HTMLInputElement).value = 'Abc12!xz';
  expect(fireEvent.submit(form)).toBe(false);
  (form.elements.namedItem('confirmPassword') as HTMLInputElement).value = 'Abc12!xy';
  expect(fireEvent.submit(form)).toBe(true);
  expect(fireEvent.submit(form)).toBe(false);
});
