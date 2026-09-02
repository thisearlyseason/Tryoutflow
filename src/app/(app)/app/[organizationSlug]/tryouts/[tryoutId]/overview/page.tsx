import { notFound } from 'next/navigation';

import { ErrorState } from '@/components/feedback/error-state';
import { PageHeader } from '@/components/layout/page-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { trackSupabaseWorkflowSafely } from '@/infrastructure/analytics/supabase-analytics-provider';
import { captureOperationalError } from '@/infrastructure/observability/server-observability';
import { RegistrationShare } from '@/modules/tryouts/ui/registration-share';
import {
  loadTryoutJourney,
  TryoutJourneyLoadError,
} from '@/modules/tryouts/application/load-tryout-journey';
import { TryoutJourney } from '@/modules/tryouts/ui/tryout-journey';
import { getPublicAppOrigin } from '@/lib/env';
import { requireOrganizationRouteContext } from '@/modules/organizations/application/organization-route-context';
import { requireCapability } from '@/modules/organizations/application/require-capability';
import { AppError } from '@/modules/observability/domain/app-error';
import { createCorrelationId } from '@/modules/observability/domain/correlation-id';
import { shouldInjectTestLoaderFailure } from '@/modules/observability/application/test-failure-boundary';
import Link from 'next/link';

export default async function TryoutOverviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationSlug: string; tryoutId: string }>;
  searchParams: Promise<{ __testLoaderFailure?: string }>;
}) {
  const [{ organizationSlug, tryoutId }, query] = await Promise.all([params, searchParams]);
  const current = await requireOrganizationRouteContext(organizationSlug);
  if (
    !requireCapability(current.authorization, 'tryout:read', {
      organizationId: current.organization.id,
      tryoutId,
    }).ok
  )
    notFound();

  async function unavailable(error: unknown) {
    captureOperationalError(error, {
      actorId: current.userId,
      organizationId: current.organization.id,
      tryoutId,
      operation: 'tryouts.load',
    });
    await trackSupabaseWorkflowSafely(current.client, {
      name: 'workflow.failed',
      workflow: 'tryout_setup',
      organizationId: current.organization.id,
      correlationId: createCorrelationId(),
    });
    return (
      <ErrorState
        action={
          <Link
            className="button-secondary inline-flex min-h-11 items-center"
            href={`/app/${organizationSlug}/tryouts/${tryoutId}/overview`}
            prefetch={false}
          >
            Retry
          </Link>
        }
        description="Tryout details could not be loaded. No data was changed."
        title="Tryout temporarily unavailable"
      />
    );
  }

  if (shouldInjectTestLoaderFailure(query.__testLoaderFailure, 'overview'))
    return unavailable(new AppError('network_unavailable'));
  let journey;
  try {
    journey = await loadTryoutJourney(current.client, {
      organizationId: current.organization.id,
      tryoutId,
      organizationSlug,
      authorization: current.authorization,
    });
  } catch (error) {
    if (
      error instanceof TryoutJourneyLoadError &&
      (error.code === 'not_found' || error.code === 'forbidden' || error.code === 'invalid_scope')
    )
      notFound();
    return unavailable(error);
  }
  const tryout = journey.tryout;
  return (
    <section aria-label="Tryout overview" className="workspace-stack">
      <PageHeader
        actions={<StatusBadge status={tryout.status}>{tryout.status}</StatusBadge>}
        description="Follow the operational path from setup through evidence review and immutable roster decisions."
        eyebrow="Tryout control room"
        title={tryout.name}
      />
      <TryoutJourney journey={journey} />
      {tryout.status === 'published' ? (
        <div className="card p-5">
          <RegistrationShare origin={getPublicAppOrigin()} publicSlug={tryout.slug} />
        </div>
      ) : (
        <p className="workspace-note">Finish guided setup before this tryout can be shared.</p>
      )}
    </section>
  );
}
