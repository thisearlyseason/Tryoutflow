import { randomUUID } from 'node:crypto';

import { revalidatePath } from 'next/cache';

import { getServerTeamManagementProviderRegistry } from '@/infrastructure/integrations/server-provider-registry';
import { connectDemoProvider } from '@/modules/integrations/application/connect-demo-provider';
import { SupabaseIntegrationGateway } from '@/modules/integrations/infrastructure/supabase-integration-gateway';
import { IntegrationCard } from '@/modules/integrations/ui/integration-card';
import { requireOrganizationRouteContext } from '@/modules/organizations/application/organization-route-context';

export default async function IntegrationsPage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;
  const scoped = await requireOrganizationRouteContext(organizationSlug);
  const registry = getServerTeamManagementProviderRegistry();
  const descriptor = registry.list().find((item) => item.providerKey === 'the-squad');
  const { data: connection } = await scoped.client
    .from('integration_connections')
    .select('id,display_name,state,mock_data')
    .eq('organization_id', scoped.organization.id)
    .eq('created_by_user_id', scoped.userId)
    .eq('provider_key', 'the-squad')
    .maybeSingle();

  async function connectAction() {
    'use server';
    const current = await requireOrganizationRouteContext(organizationSlug);
    const nonce = randomUUID();
    await connectDemoProvider(
      {
        organizationId: current.organization.id,
        correlationId: `connection:${nonce}`,
        idempotencyKey: `connection:${nonce}`,
      },
      current.authorization,
      {
        providers: getServerTeamManagementProviderRegistry(),
        gateway: new SupabaseIntegrationGateway(current.client),
      },
    );
    revalidatePath(`/app/${organizationSlug}/organization/integrations`);
  }

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-4 sm:p-8">
      <header>
        <p className="text-sm font-bold uppercase tracking-[0.18em] text-blue-700">
          Organization settings
        </p>
        <h1 className="mt-2 text-4xl font-black tracking-tight text-slate-950">Integrations</h1>
        <p className="mt-3 max-w-2xl text-slate-700">
          Connections, reviewed mappings, and synchronization history are stored per organization.
        </p>
      </header>
      <IntegrationCard
        providerName="The Squad (demo/mock)"
        enabled={descriptor !== undefined}
        connected={connection?.state === 'connected' && connection.mock_data}
        connectionLabel={connection?.display_name}
        connectAction={descriptor ? connectAction : undefined}
      />
    </div>
  );
}
