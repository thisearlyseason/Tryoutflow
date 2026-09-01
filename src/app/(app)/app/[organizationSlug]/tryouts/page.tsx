import Link from 'next/link';

import { EmptyState } from '@/components/feedback/empty-state';
import { ErrorState } from '@/components/feedback/error-state';
import { PageHeader } from '@/components/layout/page-header';
import { LinkButton } from '@/components/ui/link-button';
import { captureOperationalError } from '@/infrastructure/observability/server-observability';
import { AppError } from '@/modules/observability/domain/app-error';
import { shouldInjectTestLoaderFailure } from '@/modules/observability/application/test-failure-boundary';
import { requireCurrentOrganization } from '@/modules/organizations/application/current-organization';
import { TryoutCard } from '@/modules/tryouts/ui/tryout-card';

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
    <section aria-label="Tryouts" className="workspace-stack">
      <PageHeader
        actions={
          <LinkButton href={`/app/${organizationSlug}/tryouts/new`}>Create tryout</LinkButton>
        }
        description="Create, publish, operate, and close each evaluation cycle from one durable workspace."
        eyebrow="Operations"
        title="Tryouts"
      />
      {tryouts?.length ? (
        <ul className="workspace-card-grid">
          {tryouts.map((tryout) => (
            <li key={tryout.id}>
              <TryoutCard
                baseHref={`/app/${organizationSlug}/tryouts/${tryout.id}`}
                name={tryout.name}
                status={
                  tryout.status === 'draft' ||
                  tryout.status === 'published' ||
                  tryout.status === 'finalized'
                    ? tryout.status
                    : 'unavailable'
                }
                updatedAt={tryout.updated_at}
              />
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
