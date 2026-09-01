import { redirect } from 'next/navigation';

import { resetPassword } from '../../../modules/identity/application/reset-password';
import { AuthShell } from '../../../components/layout/auth-shell';
import { Button } from '../../../components/ui/button';
import { FormField } from '../../../components/ui/form-field';
import { Input } from '../../../components/ui/input';

type ResetPasswordPageProps = {
  searchParams: Promise<{ error?: string }>;
};

export default async function ResetPasswordPage({ searchParams }: ResetPasswordPageProps) {
  const parameters = await searchParams;

  async function submit(formData: FormData) {
    'use server';

    const result = await resetPassword({ password: formData.get('password') });

    if (!result.ok) {
      redirect('/reset-password?error=reset_failed');
    }

    redirect('/sign-in');
  }

  return (
    <AuthShell
      description="Use at least 12 characters to protect your organization and athlete records."
      eyebrow="Account recovery"
      footer={<a href="/sign-in">Return to sign in</a>}
      title="Choose a new password"
    >
      {parameters.error ? (
        <p className="auth-alert" role="alert">
          We could not reset your password. Please try again.
        </p>
      ) : null}
      <form action={submit}>
        <FormField
          description="Minimum 12 characters"
          htmlFor="password"
          label="New password"
          required
        >
          {({ describedBy }) => (
            <Input
              aria-describedby={describedBy}
              autoComplete="new-password"
              id="password"
              minLength={12}
              name="password"
              required
              type="password"
            />
          )}
        </FormField>
        <Button className="mt-2 w-full" type="submit">
          Save new password
        </Button>
      </form>
    </AuthShell>
  );
}
