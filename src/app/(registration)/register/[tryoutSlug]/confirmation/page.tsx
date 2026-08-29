import Link from 'next/link';

export default function RegistrationConfirmationPage() {
  return (
    <main className="mx-auto max-w-xl p-6">
      <h1 className="text-2xl font-bold">Registration received</h1>
      <p className="mt-3">
        Your registration has been saved. If you need to make a change, contact the organization
        directly.
      </p>
      <p className="mt-3 text-[var(--color-text-muted)]">
        We will only confirm delivery by email once the organization has configured a secure
        notification service.
      </p>
      <Link className="mt-6 inline-block underline" href="/">
        Return to TryoutFlow
      </Link>
    </main>
  );
}
