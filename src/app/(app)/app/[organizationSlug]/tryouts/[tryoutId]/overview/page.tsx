import { notFound } from 'next/navigation';
import { z } from 'zod';

import { ErrorState } from '@/components/feedback/error-state';
import { trackSupabaseWorkflowSafely } from '@/infrastructure/analytics/supabase-analytics-provider';
import { captureOperationalError } from '@/infrastructure/observability/server-observability';
import { RegistrationShare } from '@/modules/tryouts/ui/registration-share';
import { getPublicAppOrigin } from '@/lib/env';
import {
  canManageTryoutStaffing,
  requireOrganizationRouteContext,
} from '@/modules/organizations/application/organization-route-context';
import { requireCapability } from '@/modules/organizations/application/require-capability';
import { AppError } from '@/modules/observability/domain/app-error';
import { createCorrelationId } from '@/modules/observability/domain/correlation-id';
import { shouldInjectTestLoaderFailure } from '@/modules/observability/application/test-failure-boundary';
import Link from 'next/link';

const tryoutOverviewSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1).max(160),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
  status: z.enum(['draft', 'published', 'finalized']),
});

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
  const result = await current.client
    .from('tryouts')
    .select('id, name, slug, status')
    .eq('organization_id', current.organization.id)
    .eq('id', tryoutId)
    .maybeSingle();
  if (result.error) return unavailable(result.error);
  if (!result.data) notFound();
  const parsed = tryoutOverviewSchema.safeParse(result.data);
  if (!parsed.success) return unavailable(parsed.error);
  const tryout = parsed.data;
  return (
    <section aria-labelledby="tryout-overview-heading">
      <p className="eyebrow">{tryout.status}</p>
      <h2 id="tryout-overview-heading">{tryout.name}</h2>
      {canManageTryoutStaffing(current.authorization, tryoutId) ? (
        <div className="mt-4 flex flex-wrap gap-3">
          <Link
            className="button-secondary inline-flex min-h-11 items-center"
            href={`/app/${organizationSlug}/tryouts/${tryoutId}/registration`}
            prefetch={false}
          >
            Registrations
          </Link>
          <Link
            className="button-secondary inline-flex min-h-11 items-center"
            href={`/app/${organizationSlug}/tryouts/${tryoutId}/sessions`}
            prefetch={false}
          >
            Sessions
          </Link>
          <Link
            className="button-secondary inline-flex min-h-11 items-center"
            href={`/app/${organizationSlug}/tryouts/${tryoutId}/staff`}
            prefetch={false}
          >
            Manage staff
          </Link>
          <Link
            className="button-secondary inline-flex min-h-11 items-center"
            href={`/app/${organizationSlug}/tryouts/${tryoutId}/live`}
            prefetch={false}
          >
            Live dashboard
          </Link>
          <Link
            className="button-secondary inline-flex min-h-11 items-center"
            href={`/app/${organizationSlug}/tryouts/${tryoutId}/rankings`}
            prefetch={false}
          >
            Rankings
          </Link>
          <Link
            className="button-secondary inline-flex min-h-11 items-center"
            href={`/app/${organizationSlug}/tryouts/${tryoutId}/rosters`}
            prefetch={false}
          >
            Rosters
          </Link>
        </div>
      ) : null}
      {tryout.status === 'published' ? (
        <div className="mt-6">
          <RegistrationShare origin={getPublicAppOrigin()} publicSlug={tryout.slug} />
        </div>
      ) : (
        <p className="mt-4 text-[var(--color-text-muted)]">
          Finish guided setup before this tryout can be shared.
        </p>
      )}
    </section>
  );
}
