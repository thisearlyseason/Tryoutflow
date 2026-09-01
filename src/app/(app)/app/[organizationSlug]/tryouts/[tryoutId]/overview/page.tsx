import { notFound } from 'next/navigation';
import { z } from 'zod';

import { ErrorState } from '@/components/feedback/error-state';
import { PageHeader } from '@/components/layout/page-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { trackSupabaseWorkflowSafely } from '@/infrastructure/analytics/supabase-analytics-provider';
import { captureOperationalError } from '@/infrastructure/observability/server-observability';
import { RegistrationShare } from '@/modules/tryouts/ui/registration-share';
import { TryoutActionPlan } from '@/modules/tryouts/ui/tryout-action-plan';
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
  const [result, participantCountResult] = await Promise.all([
    current.client
      .from('tryouts')
      .select('id, name, slug, status')
      .eq('organization_id', current.organization.id)
      .eq('id', tryoutId)
      .maybeSingle(),
    current.client
      .from('tryout_registrations')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', current.organization.id)
      .eq('tryout_id', tryoutId),
  ]);
  if (result.error) return unavailable(result.error);
  if (!result.data) notFound();
  const parsed = tryoutOverviewSchema.safeParse(result.data);
  if (!parsed.success) return unavailable(parsed.error);
  const tryout = parsed.data;
  if (participantCountResult.error)
    captureOperationalError(participantCountResult.error, {
      actorId: current.userId,
      organizationId: current.organization.id,
      tryoutId,
      operation: 'registrations.load',
    });
  const managesTryout = canManageTryoutStaffing(current.authorization, tryoutId);
  const base = `/app/${organizationSlug}/tryouts/${tryoutId}`;
  return (
    <section aria-label="Tryout overview" className="workspace-stack">
      <PageHeader
        actions={<StatusBadge status={tryout.status}>{tryout.status}</StatusBadge>}
        description="Follow the operational path from setup through evidence review and immutable roster decisions."
        eyebrow="Tryout control room"
        title={tryout.name}
      />
      {managesTryout ? (
        <TryoutActionPlan
          baseHref={base}
          participantCount={
            participantCountResult.error ? null : (participantCountResult.count ?? 0)
          }
          status={tryout.status}
        />
      ) : null}
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
