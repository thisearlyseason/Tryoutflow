import Link from 'next/link';

import { requireCurrentOrganization } from '@/modules/organizations/application/current-organization';
import { describeAppRole } from '@/modules/organizations/components/app-navigation-model';

export default async function AccountPage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;
  const current = await requireCurrentOrganization(organizationSlug);
  const [{ data: user }, profile] = await Promise.all([
    current.client.auth.getUser(),
    current.client
      .from('profiles')
      .select('display_name,updated_at')
      .eq('id', current.userId)
      .maybeSingle(),
  ]);
  const displayName =
    profile.data?.display_name?.trim() || user.user?.user_metadata?.full_name || 'Not set';

  return (
    <section aria-labelledby="account-heading" className="grid min-w-0 gap-6">
      <header>
        <p className="eyebrow">Your account</p>
        <h2 id="account-heading">Account details</h2>
        <p className="mt-2 text-[var(--color-text-muted)]">
          Your identity and access for this organization.
        </p>
      </header>
      <div className="card p-6">
        <dl className="grid gap-5 sm:grid-cols-[12rem_1fr]">
          <dt className="font-semibold">Name</dt>
          <dd>{displayName}</dd>
          <dt className="font-semibold">Email</dt>
          <dd>{user.user?.email ?? 'Unavailable'}</dd>
          <dt className="font-semibold">Role</dt>
          <dd>{describeAppRole(current.authorization)}</dd>
          <dt className="font-semibold">Organization</dt>
          <dd>{current.organization.name}</dd>
          <dt className="font-semibold">Account ID</dt>
          <dd className="break-all text-sm text-[var(--color-text-muted)]">{current.userId}</dd>
        </dl>
      </div>
      <nav aria-label="Account help" className="flex flex-wrap gap-4">
        <Link className="button-secondary" href="/support">
          Support
        </Link>
        <Link className="button-secondary" href="/privacy">
          Privacy
        </Link>
        <Link className="button-secondary" href="/delete-account">
          Request account deletion
        </Link>
      </nav>
      <Link
        className="button-secondary inline-flex min-h-11 w-fit items-center"
        href={`/app/${organizationSlug}/home`}
        prefetch={false}
      >
        Back to dashboard
      </Link>
    </section>
  );
}
