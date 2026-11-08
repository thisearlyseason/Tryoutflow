import Link from 'next/link';
import { requireParticipantContext } from '@/modules/registration/application/participant-context';
import { PageHeader } from '@/components/layout/page-header';

export const metadata = { title: 'Family account | TryoutFlow' };
export default async function FamilyAccountPage() {
  const { client, user } = await requireParticipantContext();
  const profile = await client
    .from('profiles')
    .select('display_name')
    .eq('id', user.id)
    .maybeSingle();
  const metadataName = user.user_metadata?.full_name;
  const name =
    profile.data?.display_name?.trim() ||
    (typeof metadataName === 'string' && metadataName.trim()) ||
    'Not set';
  return (
    <section className="talent-stack">
      <PageHeader
        title="Your account"
        description="Your sign-in identity for the athlete and family portal."
      />
      {profile.error ? (
        <p role="alert">
          Profile details could not load. Refresh to try again. Your verified sign-in email is shown
          below.
        </p>
      ) : null}
      <dl className="grid gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5 sm:grid-cols-[8rem_1fr]">
        <dt className="font-bold">Name</dt>
        <dd>{profile.error ? 'Unavailable' : name}</dd>
        <dt className="font-bold">Email</dt>
        <dd className="break-all">{user.email ?? 'Unavailable'}</dd>
      </dl>
      <p>
        Ask your organizer to link this account email to your athlete. Family access is granted
        individually; it does not give staff permissions.
      </p>
      <nav aria-label="Account help" className="flex flex-wrap gap-3">
        <Link className="button-secondary" href="/forgot-password" prefetch={false}>
          Reset password
        </Link>
        <Link className="button-secondary" href="/support" prefetch={false}>
          Support
        </Link>
        <Link className="button-secondary" href="/privacy" prefetch={false}>
          Privacy
        </Link>
        <Link className="button-secondary" href="/delete-account" prefetch={false}>
          Request account deletion
        </Link>
      </nav>
      <Link className="button-secondary w-fit" href="/participant" prefetch={false}>
        Back to family portal
      </Link>
    </section>
  );
}
