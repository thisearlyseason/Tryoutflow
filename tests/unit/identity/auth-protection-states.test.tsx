import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SignUpForm } from '@/modules/identity/ui/sign-up-form';
import { AuthEmailRequestForm } from '@/modules/identity/ui/auth-email-request-form';
import SignInPage from '@/app/(auth)/sign-in/page';

vi.mock('next/script', () => ({
  default: ({ onReady, onError }: { onReady: () => void; onError: () => void }) => (
    <button type="button" onClick={onReady} onDoubleClick={onError}>
      Inert script callback
    </button>
  ),
}));

type Configuration = {
  callback: (token: string) => void;
  'error-callback': () => void;
  'expired-callback': () => void;
  'timeout-callback': () => void;
};
function provider() {
  let configuration: Configuration;
  let input: HTMLInputElement | undefined;
  const api = {
    render: vi.fn((element: HTMLElement, next: Configuration) => {
      // Model the real widget's ordinary hidden response field, without loading a provider.
      input = document.createElement('input');
      input.type = 'hidden';
      input.name = 'cf-turnstile-response';
      element.appendChild(input);
      configuration = {
        ...next,
        callback(token) {
          input!.value = token;
          next.callback(token);
        },
        'expired-callback'() {
          input!.value = '';
          next['expired-callback']();
        },
        'error-callback'() {
          input!.value = '';
          next['error-callback']();
        },
        'timeout-callback'() {
          input!.value = '';
          next['timeout-callback']();
        },
      };
      return 'inert-widget';
    }),
    reset: vi.fn(() => {
      if (input) input.value = '';
    }),
    remove: vi.fn(() => input?.remove()),
  };
  window.turnstile = api;
  return { api, configuration: () => configuration };
}
const cases = [
  { kind: 'sign_up', label: 'Create account', pending: 'Creating account…', path: '/auth/sign-up' },
  {
    kind: 'recovery',
    label: 'Send reset instructions',
    pending: 'Sending reset instructions…',
    path: '/auth/recovery',
  },
  {
    kind: 'verification',
    label: 'Send verification link',
    pending: 'Sending verification link…',
    path: '/auth/verification',
  },
] as const;
function form(kind: (typeof cases)[number]['kind'], siteKey?: string) {
  return kind === 'sign_up'
    ? render(
        <SignUpForm participant emailPlaceholder="synthetic@example.invalid" siteKey={siteKey} />,
      )
    : render(<AuthEmailRequestForm participant action={kind} siteKey={siteKey} />);
}
function fill(kind: (typeof cases)[number]['kind']) {
  fireEvent.change(screen.getByLabelText('Email', { exact: true }), {
    target: { value: 'synthetic@example.invalid' },
  });
  if (kind === 'sign_up') {
    fireEvent.change(screen.getByLabelText('Password', { exact: true }), {
      target: { value: 'Abc12!xy' },
    });
    fireEvent.change(screen.getByLabelText('Confirm password', { exact: true }), {
      target: { value: 'Abc12!xy' },
    });
  }
}
afterEach(() => {
  delete window.turnstile;
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe.each(cases)(
  '$kind protected form states (DOM events only)',
  ({ kind, label, pending, path }) => {
    it('disables unavailable actions and refuses direct submit while retaining the visible failure', () => {
      const view = form(kind);
      expect(screen.getByRole('alert')).toHaveTextContent('Bot protection is unavailable');
      expect(screen.getByRole('button', { name: label })).toBeDisabled();
      expect(fireEvent.submit(view.container.querySelector('form')!)).toBe(false);
      expect(view.container.querySelector('form')).not.toHaveAttribute('aria-busy');
    });
    it('requires verification, revokes it on expiry/error/timeout, and recovers through the challenge', () => {
      const p = provider();
      const view = form(kind, 'inert-key');
      fill(kind);
      const button = screen.getByRole('button', { name: label });
      expect(button).toBeDisabled();
      expect(screen.getByText('Bot protection is loading…')).toBeVisible();
      fireEvent.click(screen.getByRole('button', { name: 'Inert script callback' }));
      for (const callback of ['expired-callback', 'error-callback', 'timeout-callback'] as const) {
        act(() => p.configuration().callback('inert-token'));
        expect(button).toBeEnabled();
        act(() => p.configuration()[callback]());
        expect(button).toBeDisabled();
        expect(fireEvent.submit(view.container.querySelector('form')!)).toBe(false);
        expect(screen.getByLabelText('Email', { exact: true })).toHaveValue(
          'synthetic@example.invalid',
        );
        if (callback === 'error-callback') {
          expect(screen.getByRole('alert')).toHaveTextContent('Bot protection could not load');
          fireEvent.click(screen.getByRole('button', { name: 'Retry bot protection' }));
          expect(p.api.reset).toHaveBeenCalled();
        }
      }
      act(() => p.configuration().callback('fresh-inert-token'));
      expect(button).toBeEnabled();
    });
    it('shows immediate progress, prevents duplicate submits, preserves POST fields and rechecks after Back', () => {
      const p = provider();
      const view = form(kind, 'inert-key');
      fill(kind);
      fireEvent.click(screen.getByRole('button', { name: 'Inert script callback' }));
      act(() => p.configuration().callback('inert-token'));
      const element = view.container.querySelector('form')!;
      expect(element).toHaveAttribute('action', path);
      expect(element).toHaveAttribute('method', 'post');
      if (kind !== 'recovery') expect(new FormData(element).get('purpose')).toBe('participant');
      expect(new FormData(element).get('cf-turnstile-response')).toBe('inert-token');
      expect(fireEvent.submit(element)).toBe(true);
      expect(element).toHaveAttribute('aria-busy', 'true');
      expect(screen.getByRole('button', { name: pending })).toBeDisabled();
      expect(fireEvent.submit(element)).toBe(false);
      act(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
      expect(element).not.toHaveAttribute('aria-busy');
      expect(screen.getByRole('button', { name: label })).toBeDisabled();
      expect(p.api.reset).toHaveBeenCalledWith('inert-widget');
      act(() => p.configuration().callback('fresh-back-token'));
      expect(screen.getByRole('button', { name: label })).toBeEnabled();
    });
    it('rejects stale tokens when a phone missed the provider expiry callback', () => {
      vi.useFakeTimers();
      const p = provider();
      const view = form(kind, 'inert-key');
      fill(kind);
      fireEvent.click(screen.getByRole('button', { name: 'Inert script callback' }));
      act(() => p.configuration().callback('stale-inert-token'));
      vi.setSystemTime(Date.now() + 270_000);
      expect(fireEvent.submit(view.container.querySelector('form')!)).toBe(false);
      expect(screen.getByRole('button', { name: label })).toBeDisabled();
      expect(p.api.reset).toHaveBeenCalledWith('inert-widget');
    });
    it('keeps invalid email recoverable without entering pending state or consuming a valid challenge', () => {
      const p = provider();
      const view = form(kind, 'inert-key');
      fill(kind);
      fireEvent.change(screen.getByLabelText('Email', { exact: true }), {
        target: { value: 'invalid' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Inert script callback' }));
      act(() => p.configuration().callback('inert-token'));
      expect(fireEvent.submit(view.container.querySelector('form')!)).toBe(false);
      expect(screen.getByRole('alert')).toHaveTextContent(/email/i);
      expect(view.container.querySelector('form')).not.toHaveAttribute('aria-busy');
      expect(screen.getByRole('button', { name: label })).toBeEnabled();
    });
    it('keeps the action disabled during a slow challenge and permits a genuine late callback', () => {
      vi.useFakeTimers();
      const p = provider();
      form(kind, 'inert-key');
      fireEvent.click(screen.getByRole('button', { name: 'Inert script callback' }));
      act(() => vi.advanceTimersByTime(30_000));
      expect(screen.getByRole('alert')).toHaveTextContent('taking longer');
      expect(screen.getByRole('button', { name: label })).toBeDisabled();
      act(() => p.configuration().callback('late-inert-token'));
      expect(screen.getByRole('button', { name: label })).toBeEnabled();
    });
  },
);

it('uses athlete/family sign-in copy and participant account links together', async () => {
  render(await SignInPage({ searchParams: Promise.resolve({ next: '/participant' }) }));
  expect(screen.getByRole('heading', { name: 'Athlete and family portal' })).toBeVisible();
  expect(screen.getByText('Your linked athletes')).toBeVisible();
  expect(screen.queryByText('Roster decisions and communication')).toBeNull();
  expect(screen.getByRole('link', { name: 'Coach & staff sign-in' })).toHaveAttribute(
    'href',
    '/sign-in',
  );
  expect(screen.getByText(/Sign in to your athlete and family portal/)).toBeVisible();
  expect(screen.queryByText(/Create an organization account first/)).toBeNull();
  expect(screen.getByRole('link', { name: 'Create an athlete or family account' })).toHaveAttribute(
    'href',
    '/sign-up?purpose=participant',
  );
});
