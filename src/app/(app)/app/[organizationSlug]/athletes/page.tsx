import { FeedbackButton } from '@/components/ui/button';
import Link from 'next/link';
import Form from 'next/form';
import { notFound, redirect } from 'next/navigation';

import { requireCapability } from '@/modules/organizations/application/require-capability';
import { requireCurrentOrganization } from '@/modules/organizations/application/current-organization';
import { normalizeAthleteDirectoryPage } from '@/modules/athletes/application/directory-pagination';
import { EmptyState } from '@/components/feedback/empty-state';
import { ErrorState } from '@/components/feedback/error-state';
import { PageHeader } from '@/components/layout/page-header';

export default async function AthletesPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationSlug: string }>;
  searchParams: Promise<{ page?: string | string[]; q?: string | string[] }>;
}) {
  const { organizationSlug } = await params;
  const filters = await searchParams;
  const rawQuery = Array.isArray(filters.q) ? filters.q[0] : filters.q;
  const query = (rawQuery ?? '').trim().slice(0, 120);
  const rawPage = Array.isArray(filters.page) ? filters.page[0] : filters.page;
  const requestedPage = Number(rawPage ?? '1');
  const requestedSafePage =
    Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const pageSize = 50;
  const current = await requireCurrentOrganization(organizationSlug);
  if (
    !requireCapability(current.authorization, 'athlete:read', {
      organizationId: current.organization.id,
    }).ok
  ) {
    const talent = await current.client.rpc('can_use_talent', {
      p_organization_id: current.organization.id,
    });
    if (!talent.data) notFound();
  }
  const search = query.replace(/[^\p{L}\p{N}\s'-]/gu, ' ').trim();
  let directory = current.client
    .from('athletes')
    .select('id,given_name,family_name,birth_date,created_at', { count: 'exact' })
    .eq('organization_id', current.organization.id);
  for (const token of search.split(/\s+/).filter(Boolean).slice(0, 8))
    directory = directory.or(`given_name.ilike.%${token}%,family_name.ilike.%${token}%`);
  const {
    data: athletes,
    error,
    count,
  } = await directory
    .order('family_name')
    .order('given_name')
    .order('id')
    .range((requestedSafePage - 1) * pageSize, requestedSafePage * pageSize - 1);
  const unavailable = Boolean(error) || athletes === null;
  const retryParams = new URLSearchParams();
  if (query) retryParams.set('q', query);
  if (requestedSafePage > 1) retryParams.set('page', String(requestedSafePage));
  const directoryHref = `/app/${organizationSlug}/athletes`;
  const retryHref = `${directoryHref}${retryParams.size ? `?${retryParams}` : ''}`;
  const page = normalizeAthleteDirectoryPage(requestedPage, count ?? 0, pageSize);
  if (!unavailable && page !== requestedSafePage)
    redirect(`?page=${page}&q=${encodeURIComponent(query)}`);
  const administrative = ['owner', 'administrator'].includes(
    current.authorization.organizationRole,
  );
  return (
    <section aria-labelledby="athletes-heading" className="workspace-stack">
      <PageHeader
        actions={
          administrative && (unavailable || Boolean(query) || Boolean(athletes?.length)) ? (
            <div className="flex flex-wrap gap-2">
              <Link
                prefetch={false}
                className="button-primary"
                href={`/app/${organizationSlug}/athletes/new`}
              >
                Add athlete
              </Link>
              <Link
                className="button-secondary"
                href={`/app/${organizationSlug}/athletes/duplicates`}
                prefetch={false}
              >
                Review duplicates
              </Link>
              <Link
                className="button-secondary"
                href={`/app/${organizationSlug}/athletes/import`}
                prefetch={false}
              >
                Import spreadsheet
              </Link>
            </div>
          ) : null
        }
        description="Manage athletes; register them separately for each tryout."
        eyebrow="People"
        title="Athletes"
      />
      <Form action="" prefetch={false} className="talent-search">
        <label>
          Search athletes
          <input
            key={query}
            type="search"
            name="q"
            defaultValue={query}
            placeholder="First or last name"
          />
        </label>
        <FeedbackButton className="button-secondary">Search</FeedbackButton>
      </Form>
      <div>
        <h2 className="sr-only" id="athletes-heading">
          Athletes
        </h2>
        {unavailable ? (
          <ErrorState
            title="Athletes temporarily unavailable"
            description="The athlete directory could not be loaded. Try again, or change your search."
            action={
              <a className="button-secondary inline-flex min-h-11 items-center" href={retryHref}>
                Retry athletes
              </a>
            }
          />
        ) : null}
        {!unavailable && athletes && athletes.length > 0 && (
          <div className="card overflow-x-auto">
            <table aria-label="Athlete directory" className="w-full min-w-[520px] text-left">
              <thead>
                <tr>
                  <th scope="col">Athlete</th>
                  <th scope="col">Date of birth</th>
                  <th scope="col">Added</th>
                  <th scope="col">
                    <span className="sr-only">Profile</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {athletes.map((athlete) => (
                  <tr key={athlete.id}>
                    <td>
                      <Link
                        className="athlete-directory-name"
                        href={`/app/${organizationSlug}/athletes/${athlete.id}`}
                        prefetch={false}
                      >
                        <span className="athlete-avatar" aria-hidden="true">
                          {athlete.given_name[0]}
                          {athlete.family_name[0]}
                        </span>
                        {athlete.given_name} {athlete.family_name}
                      </Link>
                    </td>
                    <td>{athlete.birth_date ?? 'Not provided'}</td>
                    <td>
                      {new Date(athlete.created_at).toLocaleDateString('en-CA', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                        timeZone: 'UTC',
                      })}
                    </td>
                    <td>
                      <Link
                        className="text-[var(--color-primary)]"
                        href={`/app/${organizationSlug}/athletes/${athlete.id}`}
                        aria-label={`View ${athlete.given_name} ${athlete.family_name}`}
                        prefetch={false}
                      >
                        View profile →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!unavailable && athletes?.length === 0 ? (
          <EmptyState
            title={
              query
                ? 'No matching athletes'
                : administrative
                  ? 'No athletes yet'
                  : 'No athletes available'
            }
            description={
              query
                ? 'Try a different name or clear the search to return to the directory.'
                : administrative
                  ? 'Add a prospect or import reviewed athlete records. Athletes also appear here when families register for a tryout.'
                  : 'Athletes appear here after they are added or registered. Ask an owner or administrator to add records or check your access.'
            }
            action={
              query ? (
                <Link
                  className="button-secondary inline-flex min-h-11 items-center"
                  href={directoryHref}
                  prefetch={false}
                >
                  Clear search
                </Link>
              ) : administrative ? (
                <div className="flex flex-wrap justify-center gap-2">
                  <Link
                    className="button-secondary inline-flex min-h-11 items-center"
                    href={`${directoryHref}/new`}
                    prefetch={false}
                  >
                    Add prospect
                  </Link>
                  <Link
                    className="button-primary inline-flex min-h-11 items-center"
                    href={`${directoryHref}/import`}
                    prefetch={false}
                  >
                    Import athletes
                  </Link>
                </div>
              ) : undefined
            }
          />
        ) : null}
        {!unavailable && (count ?? 0) > 0 ? (
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
                  href={`?page=${page - 1}&q=${encodeURIComponent(query)}`}
                  prefetch={false}
                >
                  Previous
                </Link>
              ) : null}
              {page * pageSize < (count ?? 0) ? (
                <Link
                  className="rounded border border-[var(--color-border)] px-4 py-2 font-bold"
                  href={`?page=${page + 1}&q=${encodeURIComponent(query)}`}
                  prefetch={false}
                >
                  Next
                </Link>
              ) : null}
            </div>
          </nav>
        ) : null}
      </div>
    </section>
  );
}

export const metadata = { title: 'Athletes | TryoutFlow' };
