import { redirect } from 'next/navigation';

import { resetPassword } from '../../../modules/identity/application/reset-password';
import { AuthShell } from '../../../components/layout/auth-shell';
import { ResetPasswordForm } from '../../../modules/identity/ui/reset-password-form';

type ResetPasswordPageProps = {
  searchParams: Promise<{ error?: string }>;
};

export default async function ResetPasswordPage({ searchParams }: ResetPasswordPageProps) {
  const parameters = await searchParams;

  async function submit(formData: FormData) {
    'use server';

    if (formData.get('password') !== formData.get('confirmPassword')) {
      redirect('/reset-password?error=reset_failed');
    }

    const result = await resetPassword({ password: formData.get('password') });

    if (!result.ok) {
      redirect('/reset-password?error=reset_failed');
    }

    redirect('/sign-in?password_updated=1');
  }

  return (
    <AuthShell
      description="Use 8–128 characters with a lowercase letter, an uppercase letter, a number, and a symbol."
      eyebrow="Account recovery"
      footer={<a href="/sign-in">Return to sign in</a>}
      title="Choose a new password"
    >
      {parameters.error ? (
        <p className="auth-alert" role="alert">
          We could not reset your password. Please try again.
        </p>
      ) : null}
      <ResetPasswordForm action={submit} />
    </AuthShell>
  );
}
