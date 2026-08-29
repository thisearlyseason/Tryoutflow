import Link from 'next/link';
import { notFound } from 'next/navigation';

import { requireCapability } from '@/modules/organizations/application/require-capability';
import { requireCurrentOrganization } from '@/modules/organizations/application/current-organization';

export default async function AthletesPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationSlug: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { organizationSlug } = await params;
  const requestedPage = Number((await searchParams).page ?? '1');
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const pageSize = 50;
  const current = await requireCurrentOrganization(organizationSlug);
  if (
    !requireCapability(current.authorization, 'athlete:read', {
      organizationId: current.organization.id,
    }).ok
  )
    notFound();
  const {
    data: athletes,
    error,
    count,
  } = await current.client
    .from('athletes')
    .select('id,given_name,family_name,birth_date,created_at', { count: 'exact' })
    .eq('organization_id', current.organization.id)
    .order('family_name')
    .order('given_name')
    .order('id')
    .range((page - 1) * pageSize, page * pageSize - 1);
  const administrative = ['owner', 'administrator'].includes(
    current.authorization.organizationRole,
  );
  return (
    <section aria-labelledby="athletes-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="eyebrow">People</p>
          <h2 id="athletes-heading">Athletes</h2>
        </div>
        {administrative ? (
          <div className="flex gap-2">
            <Link
              className="inline-flex min-h-[var(--target-mobile)] items-center rounded-[var(--radius-control)] border border-[var(--color-border)] px-4 font-bold"
              href={`/app/${organizationSlug}/athletes/duplicates`}
            >
              Review duplicates
            </Link>
            <Link
              className="inline-flex min-h-[var(--target-mobile)] items-center rounded-[var(--radius-control)] bg-[var(--color-primary)] px-4 font-bold text-[var(--color-primary-foreground)]"
              href={`/app/${organizationSlug}/athletes/import`}
            >
              Import CSV
            </Link>
          </div>
        ) : null}
      </div>
      {error ? (
        <div className="mt-6 rounded-lg border border-[var(--color-danger)] p-4" role="alert">
          The athlete directory could not be loaded. Refresh to try again.
        </div>
      ) : null}
      <ul className="mt-6 grid gap-3 sm:grid-cols-2">
        {athletes?.map((athlete) => (
          <li
            className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
            key={athlete.id}
          >
            <Link
              className="font-bold text-[var(--color-primary)] underline"
              href={`/app/${organizationSlug}/athletes/${athlete.id}`}
            >
              {athlete.given_name} {athlete.family_name}
            </Link>
            <p className="text-sm text-[var(--color-text-muted)]">Born {athlete.birth_date}</p>
          </li>
        ))}
      </ul>
      {athletes?.length === 0 ? (
        <p className="mt-6 text-[var(--color-text-muted)]">
          No athletes yet. Import a reviewed CSV or publish registration.
        </p>
      ) : null}
      {!error && (count ?? 0) > 0 ? (
        <nav
          aria-label="Athlete pages"
          className="mt-6 flex flex-wrap items-center justify-between gap-3"
        >
          <p className="text-sm text-[var(--color-text-muted)]">
            Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, count ?? 0)} of {count}
          </p>
          <div className="flex gap-2">
            {page > 1 ? (
              <Link
                className="rounded border border-[var(--color-border)] px-4 py-2 font-bold"
                href={`?page=${page - 1}`}
              >
                Previous
              </Link>
            ) : null}
            {page * pageSize < (count ?? 0) ? (
              <Link
                className="rounded border border-[var(--color-border)] px-4 py-2 font-bold"
                href={`?page=${page + 1}`}
              >
                Next
              </Link>
            ) : null}
          </div>
        </nav>
      ) : null}
    </section>
  );
}
