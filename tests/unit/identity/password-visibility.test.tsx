import { createRef } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PasswordInput } from '../../../src/components/ui/password-input';
import { SignInForm } from '../../../src/modules/identity/ui/sign-in-form';
import { PasswordFields } from '../../../src/modules/identity/ui/password-fields';

describe('password visibility', () => {
  afterEach(() => vi.restoreAllMocks());

  it('renders masked and disables the toggle until client hydration', () => {
    const container = document.createElement('div');
    container.innerHTML = renderToString(<PasswordInput id="secret" name="password" />);
    expect(container.querySelector('input')).toHaveAttribute('type', 'password');
    expect(container.querySelector('button')).toHaveAttribute('type', 'button');
    expect(container.querySelector('button')).toBeDisabled();
  });

  it('preserves password-manager input entered before hydration and keeps it masked', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const form = <PasswordInput id="secret" name="password" autoComplete="current-password" />;
    container.innerHTML = renderToString(form);
    const input = container.querySelector('input')!;
    input.value = 'Synthetic-Prehydration1!';
    let root: Root | undefined;
    const hydrationErrors: unknown[] = [];
    try {
      await act(async () => {
        root = hydrateRoot(container, form, {
          onRecoverableError: (error) => hydrationErrors.push(error),
        });
      });
      expect(hydrationErrors).toEqual([]);
      expect(container.querySelector('input')).toBe(input);
      expect(input).toHaveValue('Synthetic-Prehydration1!');
      expect(input).toHaveAttribute('type', 'password');
      expect(screen.getByRole('button', { name: 'Show password' })).toBeEnabled();
      fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
      expect(input).toHaveValue('Synthetic-Prehydration1!');
    } finally {
      await act(async () => root?.unmount());
      container.remove();
    }
  });

  it('retains the same input, autofill value, selection and submission data when toggled', () => {
    const ref = createRef<HTMLInputElement>();
    const submit = vi.fn((event) => event.preventDefault());
    render(
      <form onSubmit={submit}>
        <PasswordInput id="secret" name="password" autoComplete="current-password" ref={ref} />
      </form>,
    );
    const input = ref.current!;
    // Synthetic password-manager fill, without a React change event.
    input.value = 'Synthetic-Autofill1!';
    input.focus();
    input.setSelectionRange(3, 7);
    const toggle = screen.getByRole('button', { name: 'Show password' });
    fireEvent.pointerDown(toggle);
    fireEvent.click(toggle);
    expect(ref.current).toBe(input);
    expect(input).toHaveAttribute('type', 'text');
    expect(input).toHaveAttribute('autocomplete', 'current-password');
    expect(input).toHaveFocus();
    expect([input.selectionStart, input.selectionEnd]).toEqual([3, 7]);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(new FormData(input.form!).get('password')).toBe('Synthetic-Autofill1!');
    expect(submit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(input).toHaveAttribute('type', 'password');
    expect(input.value).toBe('Synthetic-Autofill1!');
  });

  it('conceals a revealed input when restored from browser history', () => {
    render(<PasswordInput id="secret" />);
    fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
    fireEvent(window, new Event('pageshow'));
    expect(screen.getByRole('button', { name: 'Show password' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('conceals the same input on an inactive page without erasing its value', () => {
    render(<PasswordInput id="secret" defaultValue="Synthetic-Background1!" />);
    const input = screen
      .getByRole('button', { name: 'Show password' })
      .parentElement!.querySelector('input')!;
    fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    fireEvent(document, new Event('visibilitychange'));
    expect(input).toHaveAttribute('type', 'password');
    expect(input).toHaveValue('Synthetic-Background1!');
    expect(screen.getByRole('button', { name: 'Show password' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('keeps a disabled field and its visibility control disabled', () => {
    render(<PasswordInput id="secret" disabled defaultValue="Synthetic-Disabled1!" />);
    const toggle = screen.getByRole('button', { name: 'Show password' });
    fireEvent.click(toggle);
    expect(toggle).toBeDisabled();
    expect(toggle.parentElement!.querySelector('input')).toHaveAttribute('type', 'password');
  });

  it('retains validation and description attributes while revealing the input', () => {
    const { container } = render(
      <PasswordInput
        id="secret"
        name="password"
        aria-describedby="password-guidance"
        required
        minLength={8}
        maxLength={128}
        autoComplete="new-password"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
    const input = container.querySelector('input')!;
    expect(input).toBeRequired();
    expect(input).toHaveAttribute('minlength', '8');
    expect(input).toHaveAttribute('maxlength', '128');
    expect(input).toHaveAttribute('aria-describedby', 'password-guidance');
    expect(input).toHaveAttribute('autocomplete', 'new-password');
    expect(screen.getByRole('button', { name: 'Hide password' })).toHaveAttribute(
      'aria-controls',
      'secret',
    );
  });

  it('keeps confirmation visibility independent and preserves new-password autofill', () => {
    render(
      <PasswordFields
        password=""
        confirmation=""
        setPassword={() => {}}
        setConfirmation={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Show confirm password' }));
    expect(screen.getByLabelText(/^Password/, { selector: 'input' })).toHaveAttribute(
      'type',
      'password',
    );
    expect(screen.getByLabelText(/^Confirm password/)).toHaveAttribute('type', 'text');
    expect(screen.getByLabelText(/^Confirm password/)).toHaveAttribute(
      'autocomplete',
      'new-password',
    );
  });

  it('does not submit sign-in or unlock bot protection when showing the password', () => {
    render(<SignInForm />);
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled();
    expect(screen.getByLabelText(/^Password/, { selector: 'input' })).toHaveAttribute(
      'type',
      'text',
    );
  });
});
