import { act, fireEvent, render, screen } from '@testing-library/react';
import { hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BotChallenge } from '../../../src/modules/identity/ui/bot-challenge';
import { SignUpForm } from '../../../src/modules/identity/ui/sign-up-form';

describe('signup bot challenge composition', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('preserves the server-issued token when hydrating without server environment flags', async () => {
    const challenge = BotChallenge({ action: 'sign_up' });
    const form = <SignUpForm botChallenge={challenge} emailPlaceholder="owner@example.com" />;
    const container = document.createElement('div');
    container.innerHTML = renderToString(form);
    const serverToken = container.querySelector<HTMLInputElement>(
      '[name="cf-turnstile-response"]',
    )?.value;
    expect(serverToken).toMatch(/^tryoutflow-deterministic-bot-token-v1:/);

    vi.stubEnv('TRYOUTFLOW_SERVER_TEST_ENV', undefined);
    vi.stubEnv('TRYOUTFLOW_BOT_PROTECTION_MODE', undefined);
    vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', undefined);
    const hydrationErrors: unknown[] = [];
    let root: Root | undefined;
    try {
      await act(async () => {
        root = hydrateRoot(container, form, {
          onRecoverableError: (error) => hydrationErrors.push(error),
        });
      });
      expect(hydrationErrors).toEqual([]);
      expect(container.querySelector('[role="alert"]')).toBeNull();
      expect(
        container.querySelector<HTMLInputElement>('[name="cf-turnstile-response"]')?.value,
      ).toBe(serverToken);
    } finally {
      await act(async () => root?.unmount());
    }
  });
});

describe('signup password feedback and autofill', () => {
  it('explains unmet rules and prevents invalid local submission', () => {
    const { container } = render(
      <SignUpForm botChallenge={<div />} emailPlaceholder="owner@example.com" />,
    );
    fireEvent.change(screen.getByLabelText('Password', { exact: true }), {
      target: { value: 'lowercaseonlylong' },
    });
    fireEvent.change(screen.getByLabelText(/^Confirm password/), {
      target: { value: 'lowercaseonlylong' },
    });
    expect(container.querySelector('#password-requirements')!.textContent).toContain(
      'an uppercase letter',
    );
    expect(container.querySelector('#password-requirements')!.textContent).toContain('a number');
    expect(container.querySelector('#password-requirements')!.textContent).toContain('a symbol');
    expect(fireEvent.submit(container.querySelector('form')!)).toBe(false);
  });

  it('accepts valid synthetic autofill even without change events', () => {
    const { container } = render(
      <SignUpForm botChallenge={<div />} emailPlaceholder="owner@example.com" />,
    );
    const password = screen.getByLabelText('Password', { exact: true }) as HTMLInputElement;
    const confirmation = screen.getByLabelText(/^Confirm password/) as HTMLInputElement;
    // Local DOM-only dummy input: no provider or live account request occurs.
    password.value = 'SyntheticOnly-123';
    confirmation.value = 'SyntheticOnly-123';
    expect(screen.getByRole('button', { name: 'Create account' })).not.toBeDisabled();
    expect(fireEvent.submit(container.querySelector('form')!)).toBe(true);
    expect(container.querySelector('#password-requirements')!.textContent).toBe(
      'Passwords match and meet all requirements.',
    );
  });

  it('rejects mismatched synthetic autofill and identifies the confirmation', () => {
    const { container } = render(
      <SignUpForm botChallenge={<div />} emailPlaceholder="owner@example.com" />,
    );
    (screen.getByLabelText('Password', { exact: true }) as HTMLInputElement).value =
      'SyntheticOnly-123';
    (screen.getByLabelText(/^Confirm password/) as HTMLInputElement).value = 'SyntheticOnly-456';
    expect(fireEvent.submit(container.querySelector('form')!)).toBe(false);
    expect(container.querySelector('#password-requirements')!.textContent).toContain(
      'an exact password confirmation',
    );
  });
});

describe('approved eight-character password policy', () => {
  it.each([
    ['Abc12!x', false],
    ['Abc12!xy', true],
    ['ABC12!XY', false],
    ['abc12!xy', false],
    ['Abcde!xy', false],
    ['Abc123xy', false],
    ['Abc123 x', false],
    ['LongerSyntheticPassword12!', true],
    ['Aa1!' + 'X'.repeat(125), false],
  ])('validates synthetic value %s without a network request', (candidate, accepted) => {
    const { container } = render(
      <SignUpForm botChallenge={<div />} emailPlaceholder="owner@example.com" />,
    );
    fireEvent.change(screen.getByLabelText('Password', { exact: true }), {
      target: { value: candidate },
    });
    fireEvent.change(screen.getByLabelText(/^Confirm password/), { target: { value: candidate } });
    expect(fireEvent.submit(container.querySelector('form')!)).toBe(accepted);
    expect(screen.getByRole('list', { name: 'Password checklist' })).toBeInTheDocument();
    if (accepted)
      expect(container.querySelector('#password-requirements')!.textContent).toBe(
        'Passwords match and meet all requirements.',
      );
  });
});

describe('password checklist hydration and page restoration', () => {
  it('reflects synthetic values entered before hydration without submitting', async () => {
    const container = document.createElement('div');
    const form = <SignUpForm botChallenge={<div />} emailPlaceholder="owner@example.invalid" />;
    container.innerHTML = renderToString(form);
    (container.querySelector('#password') as HTMLInputElement).value = 'Abc12!xy';
    (container.querySelector('#confirmPassword') as HTMLInputElement).value = 'Abc12!xy';
    let root: Root | undefined;
    try {
      await act(async () => {
        root = hydrateRoot(container, form);
      });
      expect(container.querySelector('#password-requirements')!.textContent).toBe(
        'Passwords match and meet all requirements.',
      );
      (container.querySelector('#confirmPassword') as HTMLInputElement).value = 'Abc12!xz';
      await act(async () => {
        window.dispatchEvent(new Event('pageshow'));
      });
      expect(container.querySelector('#password-requirements')!.textContent).toContain(
        'an exact password confirmation',
      );
    } finally {
      await act(async () => root?.unmount());
    }
  });
});
