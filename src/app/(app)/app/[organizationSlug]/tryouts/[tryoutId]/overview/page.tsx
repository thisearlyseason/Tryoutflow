import { notFound } from 'next/navigation';
import { z } from 'zod';

import { ErrorState } from '@/components/feedback/error-state';
import { PageHeader } from '@/components/layout/page-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { trackSupabaseWorkflowSafely } from '@/infrastructure/analytics/supabase-analytics-provider';
import { captureOperationalError } from '@/infrastructure/observability/server-observability';
import { RegistrationShare } from '@/modules/tryouts/ui/registration-share';
import { TryoutLifecycle } from '@/modules/tryouts/ui/tryout-lifecycle';
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
      <TryoutLifecycle
        completed={
          tryout.status === 'draft'
            ? ['draft']
            : tryout.status === 'published'
              ? ['draft', 'published']
              : ['draft', 'published', 'finalized']
        }
        current={tryout.status}
        hrefs={
          managesTryout
            ? {
                draft: `${base}/setup/basics`,
                published: `${base}/overview`,
                registration: `${base}/registration`,
                evaluation: `${base}/live`,
                decisions: `${base}/rankings`,
                finalized: `${base}/rosters`,
              }
            : {
                evaluation: `${base}/live`,
                decisions: `${base}/rankings`,
                finalized: `${base}/rosters`,
              }
        }
      />
      {managesTryout ? (
        <div className="workspace-actions">
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
        <div className="card p-5">
          <RegistrationShare origin={getPublicAppOrigin()} publicSlug={tryout.slug} />
        </div>
      ) : (
        <p className="workspace-note">Finish guided setup before this tryout can be shared.</p>
      )}
    </section>
  );
}
