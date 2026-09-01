import Link from 'next/link';

import { EmptyState } from '@/components/feedback/empty-state';
import { ErrorState } from '@/components/feedback/error-state';
import { captureOperationalError } from '@/infrastructure/observability/server-observability';
import { AppError } from '@/modules/observability/domain/app-error';
import { shouldInjectTestLoaderFailure } from '@/modules/observability/application/test-failure-boundary';
import { requireCurrentOrganization } from '@/modules/organizations/application/current-organization';

export default async function TryoutsPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationSlug: string }>;
  searchParams: Promise<{ __testLoaderFailure?: string }>;
}) {
  const { organizationSlug } = await params;
  const requestedFailure = (await searchParams).__testLoaderFailure;
  const current = await requireCurrentOrganization(organizationSlug);
  if (shouldInjectTestLoaderFailure(requestedFailure, 'tryouts')) {
    captureOperationalError(new AppError('network_unavailable'), {
      actorId: current.userId,
      organizationId: current.organization.id,
      operation: 'tryouts.load',
    });
    return (
      <ErrorState
        action={
          <Link
            className="button-secondary inline-flex min-h-11 items-center"
            href={`/app/${organizationSlug}/tryouts`}
            prefetch={false}
          >
            Retry
          </Link>
        }
        description="Tryouts could not be loaded. No data was changed."
        title="Tryouts temporarily unavailable"
      />
    );
  }
  const tryoutsResult = await current.client
    .from('tryouts')
    .select('id, name, slug, status, updated_at')
    .eq('organization_id', current.organization.id)
    .order('updated_at', { ascending: false });
  if (tryoutsResult.error) {
    captureOperationalError(tryoutsResult.error, {
      actorId: current.userId,
      organizationId: current.organization.id,
      operation: 'tryouts.load',
    });
    return (
      <ErrorState
        action={
          <Link
            className="button-secondary inline-flex min-h-11 items-center"
            href=""
            prefetch={false}
          >
            Retry
          </Link>
        }
        description="Tryouts could not be loaded. No data was changed."
        title="Tryouts temporarily unavailable"
      />
    );
  }
  const tryouts = tryoutsResult.data;
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
          prefetch={false}
        >
          Create tryout
        </Link>
      </div>
      {tryouts?.length ? (
        <ul className="mt-6 space-y-3">
          {tryouts.map((tryout) => (
            <li
              key={tryout.id}
              className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
            >
              <Link
                className="font-bold text-[var(--color-primary)] underline"
                href={`/app/${organizationSlug}/tryouts/${tryout.id}/${tryout.status === 'draft' ? 'setup/basics' : 'overview'}`}
                prefetch={false}
              >
                {tryout.name}
              </Link>
              <p className="text-sm text-[var(--color-text-muted)]">{tryout.status}</p>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-6">
          <EmptyState
            action={
              <Link
                className="button-secondary inline-flex min-h-11 items-center"
                href={`/app/${organizationSlug}/tryouts/new`}
                prefetch={false}
              >
                Create tryout
              </Link>
            }
            description="Create a draft to begin guided setup."
            title="No tryouts yet"
          />
        </div>
      )}
    </section>
  );
}
