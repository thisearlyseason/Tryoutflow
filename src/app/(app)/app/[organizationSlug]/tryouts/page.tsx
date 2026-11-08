import Link from 'next/link';

import { EmptyState } from '@/components/feedback/empty-state';
import { ErrorState } from '@/components/feedback/error-state';
import { PageHeader } from '@/components/layout/page-header';
import { LinkButton } from '@/components/ui/link-button';
import { captureOperationalError } from '@/infrastructure/observability/server-observability';
import { AppError } from '@/modules/observability/domain/app-error';
import { shouldInjectTestLoaderFailure } from '@/modules/observability/application/test-failure-boundary';
import { requireCurrentOrganization } from '@/modules/organizations/application/current-organization';
import { requireCapability } from '@/modules/organizations/application/require-capability';
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
  const canCreate = requireCapability(current.authorization, 'tryout:write', {
    organizationId: current.organization.id,
  }).ok;
  const unavailable = (
    <section className="workspace-stack">
      <PageHeader
        title="Tryouts"
        description="Open a tryout to see its current status and available tasks."
      />
      <ErrorState
        action={
          <a
            className="button-secondary inline-flex min-h-11 items-center"
            href={`/app/${organizationSlug}/tryouts`}
          >
            Retry
          </a>
        }
        description="Tryouts could not be loaded. No data was changed."
        title="Tryouts temporarily unavailable"
      />
    </section>
  );
  if (shouldInjectTestLoaderFailure(requestedFailure, 'tryouts')) {
    captureOperationalError(new AppError('network_unavailable'), {
      actorId: current.userId,
      organizationId: current.organization.id,
      operation: 'tryouts.load',
    });
    return unavailable;
  }
  const tryoutsResult = await current.client
    .from('tryouts')
    .select('id, name, slug, sport, status, updated_at')
    .eq('organization_id', current.organization.id)
    .order('updated_at', { ascending: false });
  if (tryoutsResult.error || tryoutsResult.data === null) {
    captureOperationalError(tryoutsResult.error ?? new AppError('network_unavailable'), {
      actorId: current.userId,
      organizationId: current.organization.id,
      operation: 'tryouts.load',
    });
    return unavailable;
  }
  const tryouts = tryoutsResult.data;
  return (
    <section aria-label="Tryouts" className="workspace-stack">
      <PageHeader
        actions={
          canCreate && Boolean(tryouts?.length) ? (
            <LinkButton href={`/app/${organizationSlug}/tryouts/new`}>Create tryout</LinkButton>
          ) : undefined
        }
        description="Open a tryout to see its current status and available tasks."
        eyebrow="Operations"
        title="Tryouts"
      />
      {tryouts?.length ? (
        <ul className="workspace-card-grid tryout-card-grid">
          {tryouts.map((tryout) => (
            <li key={tryout.id}>
              <TryoutCard
                baseHref={`/app/${organizationSlug}/tryouts/${tryout.id}`}
                management={
                  requireCapability(current.authorization, 'tryout:write', {
                    organizationId: current.organization.id,
                    tryoutId: tryout.id,
                  }).ok
                    ? { organizationSlug, tryoutId: tryout.id }
                    : undefined
                }
                name={tryout.name}
                sport={tryout.sport}
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
              canCreate ? (
                <Link
                  className="button-primary inline-flex min-h-11 items-center"
                  href={`/app/${organizationSlug}/tryouts/new`}
                  prefetch={false}
                >
                  Create tryout
                </Link>
              ) : undefined
            }
            description={
              canCreate
                ? 'Create a draft to begin guided setup.'
                : 'No tryouts are available in your current access. Ask an owner or administrator to create a tryout or check your assignments.'
            }
            title={canCreate ? 'No tryouts yet' : 'No tryouts available'}
          />
        </div>
      )}
    </section>
  );
}

export const metadata = { title: 'Tryouts | TryoutFlow' };
