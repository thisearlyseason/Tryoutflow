import { createHash, randomUUID } from 'node:crypto';

import { notFound } from 'next/navigation';
import { z } from 'zod';

import { ensureDemoMockConnection } from '@/infrastructure/integrations/ensure-demo-mock-connection';
import { getServerTeamManagementProviderRegistry } from '@/infrastructure/integrations/server-provider-registry';
import { previewRosterExport } from '@/modules/integrations/application/preview-roster-export';
import { retrySyncJob } from '@/modules/integrations/application/retry-sync-job';
import { startRosterExport } from '@/modules/integrations/application/start-roster-export';
import type { ExternalRosterDestination } from '@/modules/integrations/domain/contracts';
import { SupabaseIntegrationGateway } from '@/modules/integrations/infrastructure/supabase-integration-gateway';
import { IntegrationCard } from '@/modules/integrations/ui/integration-card';
import { RosterExportWizard } from '@/modules/integrations/ui/roster-export-wizard';
import { requireOrganizationRouteContext } from '@/modules/organizations/application/organization-route-context';

const digestToken = (prefix: string, value: string) =>
  `${prefix}:${createHash('sha256').update(value).digest('hex')}`;

const jobStateSchema = z.enum([
  'pending',
  'processing',
  'completed',
  'partially_completed',
  'failed',
  'needs_attention',
  'cancelled',
]);

export default async function RosterExportPage({
  params,
}: {
  params: Promise<{ organizationSlug: string; tryoutId: string; rosterVersionId: string }>;
}) {
  const { organizationSlug, tryoutId, rosterVersionId } = await params;
  const scoped = await requireOrganizationRouteContext(organizationSlug);
  const { data: roster } = await scoped.client
    .from('roster_versions')
    .select('id,organization_id,tryout_id,state')
    .eq('organization_id', scoped.organization.id)
    .eq('tryout_id', tryoutId)
    .eq('id', rosterVersionId)
    .maybeSingle();
  if (!roster || roster.state !== 'finalized') notFound();

  const { data: connection, error: connectionError } = await scoped.client
    .from('integration_connections')
    .select('id,provider_key,display_name,state,mock_data')
    .eq('organization_id', scoped.organization.id)
    .eq('created_by_user_id', scoped.userId)
    .eq('provider_key', 'the-squad')
    .eq('state', 'connected')
    .maybeSingle();
  if (connectionError) {
    return (
      <div className="mx-auto max-w-4xl p-4 sm:p-8">
        <IntegrationCard
          providerName="The Squad (demo/mock)"
          enabled={false}
          notice="Connection status could not be loaded. Try again later."
        />
      </div>
    );
  }
  if (!connection) {
    return (
      <div className="mx-auto max-w-4xl p-4 sm:p-8">
        <IntegrationCard providerName="The Squad (demo/mock)" enabled={false} />
        <p className="mt-5 font-semibold text-slate-800">
          Connect the enabled demo provider from Organization → Integrations before exporting.
        </p>
      </div>
    );
  }
  const connectionSnapshot = connection;

  const registry = getServerTeamManagementProviderRegistry();
  let destinations: ExternalRosterDestination[] = [];
  let availabilityMessage: string | undefined;
  try {
    const provider = registry.get(connectionSnapshot.provider_key);
    const nonce = randomUUID();
    const providerContext = {
      organizationId: scoped.organization.id,
      actorId: scoped.userId,
      connectionId: connectionSnapshot.id,
      correlationId: `destination:${nonce}`,
      idempotencyKey: `destination:${nonce}`,
    };
    await ensureDemoMockConnection(provider, {
      ...providerContext,
      mockData: connectionSnapshot.mock_data,
    });
    const organizations = await provider.listOrganizations(providerContext);
    if (organizations[0])
      destinations = await provider.listDestinations(providerContext, organizations[0]);
    if (destinations.length === 0) {
      availabilityMessage = 'No demo destinations are available for this connection.';
    }
  } catch {
    destinations = [];
    availabilityMessage =
      'Demo destinations could not be loaded. Verify the connection or try again later.';
  }

  const { data: latestJob, error: latestJobError } = await scoped.client
    .from('integration_sync_jobs')
    .select('id,state')
    .eq('organization_id', scoped.organization.id)
    .eq('connection_id', connectionSnapshot.id)
    .eq('roster_version_id', rosterVersionId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestJobError) {
    availabilityMessage = 'Export history could not be loaded. Refresh before confirming.';
  }
  let initialJob:
    | {
        id: string;
        state:
          | 'pending'
          | 'processing'
          | 'completed'
          | 'partially_completed'
          | 'failed'
          | 'needs_attention'
          | 'cancelled';
        completedCount: number;
        skippedCount: number;
        failedCount: number;
      }
    | undefined;
  const parsedLatestJob = latestJob
    ? jobStateSchema.safeParse(latestJob.state)
    : { success: false as const };
  if (latestJob && parsedLatestJob.success) {
    const { data: items, error: itemsError } = await scoped.client
      .from('integration_sync_items')
      .select('state')
      .eq('organization_id', scoped.organization.id)
      .eq('sync_job_id', latestJob.id);
    if (itemsError) {
      availabilityMessage = 'Export item history could not be loaded. Refresh before retrying.';
    } else {
      initialJob = {
        id: latestJob.id,
        state: parsedLatestJob.data,
        completedCount: items?.filter((item) => item.state === 'completed').length ?? 0,
        skippedCount: items?.filter((item) => item.state === 'skipped').length ?? 0,
        failedCount:
          items?.filter((item) => ['failed', 'requires_review'].includes(item.state)).length ?? 0,
      };
    }
  }

  async function previewAction(input: {
    destination: ExternalRosterDestination;
    approvedFields: readonly (
      'first_name' | 'last_name' | 'email' | 'phone' | 'position' | 'team_name' | 'tryout_number'
    )[];
  }) {
    'use server';
    const current = await requireOrganizationRouteContext(organizationSlug);
    const provider = getServerTeamManagementProviderRegistry().get(connectionSnapshot.provider_key);
    const nonce = randomUUID();
    await ensureDemoMockConnection(provider, {
      organizationId: current.organization.id,
      actorId: current.userId,
      connectionId: connectionSnapshot.id,
      correlationId: `preview:${nonce}`,
      idempotencyKey: `connection:${rosterVersionId}`,
      mockData: connectionSnapshot.mock_data,
    });
    return previewRosterExport(
      {
        organizationId: current.organization.id,
        connectionId: connectionSnapshot.id,
        rosterVersionId,
        destination: input.destination,
        approvedFields: input.approvedFields,
        correlationId: `preview:${nonce}`,
      },
      current.authorization,
      {
        gateway: new SupabaseIntegrationGateway(current.client),
        providers: getServerTeamManagementProviderRegistry(),
      },
    );
  }

  async function confirmAction(input: { previewId: string; confirmationToken: string }) {
    'use server';
    const current = await requireOrganizationRouteContext(organizationSlug);
    return startRosterExport(
      {
        organizationId: current.organization.id,
        previewId: input.previewId,
        confirmationToken: input.confirmationToken,
        idempotencyKey: digestToken('export', input.previewId),
      },
      current.authorization,
      { gateway: new SupabaseIntegrationGateway(current.client) },
    );
  }

  async function retryAction(jobId: string) {
    'use server';
    const current = await requireOrganizationRouteContext(organizationSlug);
    return retrySyncJob(
      {
        organizationId: current.organization.id,
        jobId,
        idempotencyKey: `retry:${randomUUID()}`,
      },
      current.authorization,
      { gateway: new SupabaseIntegrationGateway(current.client) },
    );
  }

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-8">
      <RosterExportWizard
        rosterVersionId={rosterVersionId}
        destinations={destinations}
        onPreview={previewAction}
        onConfirm={confirmAction}
        onRetry={retryAction}
        initialJob={initialJob}
        availabilityMessage={availabilityMessage}
      />
    </div>
  );
}
