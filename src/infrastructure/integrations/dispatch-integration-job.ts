import { z } from 'zod';

import {
  confirmedRosterExportSchema,
  rosterExportPreviewSchema,
  syncJobResultSchema,
  type ConfirmedRosterExport,
  type SyncJobResult,
} from '../../modules/integrations/domain/contracts';
import {
  normalizeTeamManagementProviderError,
  type TeamManagementProvider,
} from '../../modules/integrations/domain/provider';
import { ensureDemoMockConnection } from './ensure-demo-mock-connection';

export type ClaimedIntegrationJob = Readonly<{
  outboxJobId: string;
  syncJobId: string;
  organizationId: string;
  connectionId: string;
  providerKey: string;
  actorUserId: string;
  leaseToken: string;
  leaseGeneration: number;
  leaseExpiresAt: string;
  providerIdempotencyKey: string;
  attemptNumber: number;
  itemKeys: readonly string[];
  confirmedRequest: ConfirmedRosterExport;
}>;

export type IntegrationDispatchGateway = Readonly<{
  validateExecution(input: {
    outboxJobId: string;
    leaseToken: string;
    leaseGeneration: number;
  }): Promise<
    'authorized' | 'authorization_revoked' | 'delivery_uncertain' | 'not_found' | 'lease_conflict'
  >;
  authorize(input: {
    outboxJobId: string;
    leaseToken: string;
    leaseGeneration: number;
  }): Promise<
    'authorized' | 'authorization_revoked' | 'delivery_uncertain' | 'not_found' | 'lease_conflict'
  >;
  complete(input: {
    outboxJobId: string;
    leaseToken: string;
    leaseGeneration: number;
    externalJobId: string;
    result: SyncJobResult;
  }): Promise<'completed' | 'replayed' | 'not_found' | 'lease_conflict' | 'terminal_conflict'>;
  fail(input: {
    outboxJobId: string;
    leaseToken: string;
    leaseGeneration: number;
    errorCode: string;
    retryable: boolean;
  }): Promise<
    'retry_scheduled' | 'dead_lettered' | 'needs_attention' | 'not_found' | 'lease_conflict'
  >;
}>;

type ProviderRegistry = Readonly<{ get(providerKey: string): TeamManagementProvider }>;
export type IntegrationDispatchOutcome =
  'completed' | 'retry_scheduled' | 'dead_lettered' | 'needs_attention' | 'cancelled';

function providerContext(job: ClaimedIntegrationJob) {
  return {
    organizationId: job.organizationId,
    actorId: job.actorUserId,
    connectionId: job.connectionId,
    correlationId: `integration:${job.syncJobId}`,
    idempotencyKey: job.providerIdempotencyKey,
  };
}

async function requestForAttempt(
  provider: TeamManagementProvider,
  job: ClaimedIntegrationJob,
): Promise<ConfirmedRosterExport> {
  const confirmed = confirmedRosterExportSchema.parse(job.confirmedRequest);
  if (job.attemptNumber === 1) return confirmed;
  const request = {
    destination: confirmed.destination,
    approvedFields: confirmed.approvedFields,
    roster: confirmed.roster,
  };
  const preview = rosterExportPreviewSchema.parse(
    await provider.previewRosterExport(providerContext(job), request),
  );
  return confirmedRosterExportSchema.parse({
    ...request,
    previewId: preview.previewId,
    confirmationToken: preview.confirmationToken,
  });
}

export async function dispatchIntegrationJob(
  job: ClaimedIntegrationJob,
  dependencies: { providers: ProviderRegistry; gateway: IntegrationDispatchGateway },
): Promise<IntegrationDispatchOutcome> {
  const fence = {
    outboxJobId: job.outboxJobId,
    leaseToken: job.leaseToken,
    leaseGeneration: job.leaseGeneration,
  };
  const initialValidation = await dependencies.gateway.validateExecution(fence);
  if (initialValidation !== 'authorized') {
    return initialValidation === 'delivery_uncertain' ? 'needs_attention' : 'cancelled';
  }
  let provider: TeamManagementProvider;
  try {
    provider = dependencies.providers.get(job.providerKey);
    await ensureDemoMockConnection(provider, {
      organizationId: job.organizationId,
      actorId: job.actorUserId,
      connectionId: job.connectionId,
      correlationId: `integration:${job.syncJobId}`,
      idempotencyKey: `connection:${job.syncJobId}`,
      mockData: job.confirmedRequest.destination.mockData,
    });
  } catch (error) {
    const normalized = normalizeTeamManagementProviderError(error);
    const outcome = await dependencies.gateway.fail({
      outboxJobId: job.outboxJobId,
      leaseToken: job.leaseToken,
      leaseGeneration: job.leaseGeneration,
      errorCode: normalized.code,
      retryable: normalized.retryable,
    });
    return outcome === 'lease_conflict' || outcome === 'not_found' ? 'cancelled' : outcome;
  }

  try {
    const connectionValidation = await dependencies.gateway.validateExecution(fence);
    if (connectionValidation !== 'authorized') {
      return connectionValidation === 'delivery_uncertain' ? 'needs_attention' : 'cancelled';
    }
    const request = await requestForAttempt(provider, job);
    if (job.attemptNumber > 1) {
      const previewValidation = await dependencies.gateway.validateExecution(fence);
      if (previewValidation !== 'authorized') {
        return previewValidation === 'delivery_uncertain' ? 'needs_attention' : 'cancelled';
      }
    }
    const authorization = await dependencies.gateway.authorize(fence);
    if (authorization !== 'authorized') return 'cancelled';
    const result = syncJobResultSchema.parse(
      await provider.exportFinalizedRoster(providerContext(job), request),
    );
    const completionAuthorization = await dependencies.gateway.authorize(fence);
    if (completionAuthorization === 'delivery_uncertain') return 'needs_attention';
    if (completionAuthorization !== 'authorized') return 'cancelled';
    const outcome = await dependencies.gateway.complete({
      outboxJobId: job.outboxJobId,
      leaseToken: job.leaseToken,
      leaseGeneration: job.leaseGeneration,
      externalJobId: result.externalJobId,
      result,
    });
    return outcome === 'completed' || outcome === 'replayed' ? 'completed' : 'cancelled';
  } catch (error) {
    const normalized = normalizeTeamManagementProviderError(error);
    const outcome = await dependencies.gateway.fail({
      outboxJobId: job.outboxJobId,
      leaseToken: job.leaseToken,
      leaseGeneration: job.leaseGeneration,
      errorCode: normalized.code,
      retryable: normalized.retryable,
    });
    return outcome === 'lease_conflict' || outcome === 'not_found' ? 'cancelled' : outcome;
  }
}

export const claimedIntegrationJobSchema = z.strictObject({
  outboxJobId: z.uuid(),
  syncJobId: z.uuid(),
  organizationId: z.uuid(),
  connectionId: z.uuid(),
  providerKey: z.string().regex(/^[a-z][a-z0-9-]{1,49}$/u),
  actorUserId: z.uuid(),
  leaseToken: z.uuid(),
  leaseGeneration: z.number().int().min(1),
  leaseExpiresAt: z.iso.datetime({ offset: true }),
  providerIdempotencyKey: z.string().regex(/^integration:[0-9a-f-]{36}:[0-9]{1,3}$/u),
  attemptNumber: z.number().int().min(1).max(100),
  itemKeys: z.array(z.string()).min(1).max(5_100),
  confirmedRequest: confirmedRosterExportSchema,
});
