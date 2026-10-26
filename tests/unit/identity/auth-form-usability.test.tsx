import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SignInForm } from '@/modules/identity/ui/sign-in-form';
import { SignUpForm } from '@/modules/identity/ui/sign-up-form';
import SignInPage from '@/app/(auth)/sign-in/page';
import SignUpPage from '@/app/(auth)/sign-up/page';
vi.mock('@/modules/identity/ui/turnstile-client', () => ({
  TurnstileClientChallenge: () => <div>Inert bot fixture</div>,
}));
function signIn() {
  return render(<SignInForm deterministicToken="fixture-only" />);
}
function validFields() {
  fireEvent.change(screen.getByLabelText('Email', { exact: true }), {
    target: { value: 'synthetic@example.invalid' },
  });
  fireEvent.change(screen.getByLabelText('Password', { exact: true }), {
    target: { value: 'Abc12!xy' },
  });
}
describe('accessible account forms without network or provider calls', () => {
  it('toggles sign-in password visibility without changing or submitting it', () => {
    const { container } = signIn();
    validFields();
    const input = screen.getByLabelText('Password', { exact: true });
    fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(input).toHaveAttribute('type', 'text');
    expect(input).toHaveValue('Abc12!xy');
    expect(container.querySelector('form')).not.toHaveAttribute('aria-busy');
    fireEvent.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(input).toHaveAttribute('type', 'password');
  });
  it('immediately announces sign-in progress, prevents duplicates and restores after history return', () => {
    const { container } = signIn();
    validFields();
    const form = container.querySelector('form')!;
    expect(fireEvent.submit(form)).toBe(true);
    expect(screen.getByRole('button', { name: 'Signing in…' })).toBeDisabled();
    expect(form).toHaveAttribute('aria-busy', 'true');
    expect(fireEvent.submit(form)).toBe(false);
    act(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  });
  it('explains malformed email and empty credentials without a stuck spinner', () => {
    const { container } = signIn();
    fireEvent.change(screen.getByLabelText('Email', { exact: true }), {
      target: { value: 'invalid' },
    });
    expect(fireEvent.submit(container.querySelector('form')!)).toBe(false);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Enter a valid email address and your password.',
    );
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  });
  it('shows safe generic failure feedback for known and unknown server errors', async () => {
    const first = render(
      await SignInPage({ searchParams: Promise.resolve({ error: 'invalid_credentials' }) }),
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      'We could not verify that email and password',
    );
    first.unmount();
    render(
      await SignInPage({ searchParams: Promise.resolve({ error: 'private-provider-detail' }) }),
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Sign-in could not be completed.');
    expect(screen.queryByText('private-provider-detail')).toBeNull();
  });
  it('independently reveals both signup fields, shows matching rules and immediate signup progress', () => {
    const { container } = render(
      <SignUpForm emailPlaceholder="synthetic@example.invalid" deterministicToken="fixture-only" />,
    );
    validFields();
    fireEvent.change(screen.getByLabelText('Confirm password', { exact: true }), {
      target: { value: 'Abc12!xy' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Show confirm password' }));
    expect(screen.getByLabelText('Password', { exact: true })).toHaveAttribute('type', 'password');
    expect(screen.getByLabelText('Confirm password', { exact: true })).toHaveAttribute(
      'type',
      'text',
    );
    expect(screen.getByText(/A password manager can create/)).toBeVisible();
    expect(screen.getByRole('list', { name: 'Password checklist' })).toBeVisible();
    expect(fireEvent.submit(container.querySelector('form')!)).toBe(true);
    expect(screen.getByRole('button', { name: 'Creating account…' })).toBeDisabled();
  });
  it('rejects malformed signup email while retaining useful password feedback', () => {
    const { container } = render(
      <SignUpForm emailPlaceholder="synthetic@example.invalid" deterministicToken="fixture-only" />,
    );
    validFields();
    fireEvent.change(screen.getByLabelText('Email', { exact: true }), {
      target: { value: 'invalid' },
    });
    fireEvent.change(screen.getByLabelText('Confirm password', { exact: true }), {
      target: { value: 'Abc12!xy' },
    });
    expect(fireEvent.submit(container.querySelector('form')!)).toBe(false);
    expect(screen.getByRole('alert')).toHaveTextContent('Check your email');
    expect(screen.getByRole('button', { name: 'Create account' })).toBeEnabled();
  });
});

it.each(['__proto__', 'constructor', 'toString'])(
  'renders safe account errors for inherited key %s',
  async (error) => {
    const signin = render(await SignInPage({ searchParams: Promise.resolve({ error }) }));
    expect(screen.getByRole('alert')).toHaveTextContent('Sign-in could not be completed.');
    signin.unmount();
    render(await SignUpPage({ searchParams: Promise.resolve({ error }) }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Account creation is temporarily unavailable.',
    );
  },
);
