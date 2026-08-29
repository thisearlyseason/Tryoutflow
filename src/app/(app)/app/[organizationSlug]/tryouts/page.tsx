import Link from 'next/link';

import { requireCurrentOrganization } from '@/modules/organizations/application/current-organization';

export default async function TryoutsPage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;
  const current = await requireCurrentOrganization(organizationSlug);
  const { data: tryouts } = await current.client
    .from('tryouts')
    .select('id, name, slug, status, updated_at')
    .eq('organization_id', current.organization.id)
    .order('updated_at', { ascending: false });
  return (
    <section aria-labelledby="tryouts-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="eyebrow">Operations</p>
          <h2 id="tryouts-heading">Tryouts</h2>
        </div>
        <Link
          className="inline-flex min-h-[var(--target-mobile)] items-center rounded-[var(--radius-control)] bg-[var(--color-primary)] px-4 font-bold text-[var(--color-primary-foreground)]"
          href={`/app/${organizationSlug}/tryouts/new`}
        >
          Create tryout
        </Link>
      </div>
      <ul className="mt-6 space-y-3">
        {tryouts?.map((tryout) => (
          <li
            key={tryout.id}
            className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
          >
            <Link
              className="font-bold text-[var(--color-primary)] underline"
              href={`/app/${organizationSlug}/tryouts/${tryout.id}/${tryout.status === 'draft' ? 'setup/basics' : 'overview'}`}
            >
              {tryout.name}
            </Link>
            <p className="text-sm text-[var(--color-text-muted)]">{tryout.status}</p>
          </li>
        ))}
      </ul>
      {tryouts?.length === 0 ? (
        <p className="mt-6 text-[var(--color-text-muted)]">Create a draft to begin guided setup.</p>
      ) : null}
    </section>
  );
}
