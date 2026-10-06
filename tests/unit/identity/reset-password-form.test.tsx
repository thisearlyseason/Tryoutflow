import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ResetPasswordForm } from '../../../src/modules/identity/ui/reset-password-form';
describe('reset password checklist and autofill', () => {
  it.each([
    ['Abc12!x', false],
    ['Abc12!xy', true],
    ['ABC12!XY', false],
    ['abc12!xy', false],
    ['Abcde!xy', false],
    ['Abc123xy', false],
    ['LongerSyntheticPassword12!', true],
  ])('validates synthetic autofill %s without provider requests', async (candidate, accepted) => {
    const action = vi.fn(async () => {});
    const { container } = render(<ResetPasswordForm action={action} />);
    (screen.getByLabelText('New password', { exact: true }) as HTMLInputElement).value = candidate;
    (screen.getByLabelText('Confirm password', { exact: true }) as HTMLInputElement).value =
      candidate;
    fireEvent.submit(container.querySelector('form')!);
    if (accepted) await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('list', { name: 'Password checklist' })).toBeInTheDocument();
    if (!accepted) expect(action).not.toHaveBeenCalled();
  });
  it('blocks mismatched synthetic confirmation', () => {
    const action = vi.fn(async () => {});
    const { container } = render(<ResetPasswordForm action={action} />);
    fireEvent.change(screen.getByLabelText('New password', { exact: true }), {
      target: { value: 'Abc12!xy' },
    });
    fireEvent.change(screen.getByLabelText('Confirm password', { exact: true }), {
      target: { value: 'Abc12!xz' },
    });
    expect(fireEvent.submit(container.querySelector('form')!)).toBe(false);
    expect(screen.getByRole('status').textContent).toContain('an exact password confirmation');
    expect(action).not.toHaveBeenCalled();
  });
});

const resetCommand = vi.hoisted(() => vi.fn(async () => ({ ok: true as const, value: undefined })));
vi.mock('../../../src/modules/identity/application/reset-password', () => ({
  resetPassword: resetCommand,
}));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(url);
  },
}));
import ResetPasswordPage from '../../../src/app/(auth)/reset-password/page';
describe('reset confirmation server boundary', () => {
  beforeEach(() => resetCommand.mockClear());
  async function submitAction() {
    const page = await ResetPasswordPage({ searchParams: Promise.resolve({}) });
    const form = Children.toArray(
      (page as ReactElement<{ children: ReactNode }>).props.children,
    ).find((child) => isValidElement(child) && child.type === ResetPasswordForm) as ReactElement<{
      action: (fields: FormData) => Promise<void>;
    }>;
    return form.props.action;
  }
  it('rejects mismatched confirmation before reaching the password provider', async () => {
    const submit = await submitAction();
    const fields = new FormData();
    fields.set('password', 'Abc12!xy');
    fields.set('confirmPassword', 'Abc12!xz');
    await expect(submit(fields)).rejects.toThrow('/reset-password?error=reset_failed');
    expect(resetCommand).not.toHaveBeenCalled();
  });
  it('passes a matching synthetic eight-character value to the validated command', async () => {
    const submit = await submitAction();
    const fields = new FormData();
    fields.set('password', 'Abc12!xy');
    fields.set('confirmPassword', 'Abc12!xy');
    await expect(submit(fields)).rejects.toThrow('/sign-in?password_updated=1');
    expect(resetCommand).toHaveBeenCalledWith({ password: 'Abc12!xy' });
  });
});
