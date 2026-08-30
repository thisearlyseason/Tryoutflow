import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

import type { Database, Json } from '../supabase/database.types';
import {
  claimedIntegrationJobSchema,
  type ClaimedIntegrationJob,
  type IntegrationDispatchGateway,
} from './dispatch-integration-job';

const claimedRowSchema = z.strictObject({
  outbox_job_id: z.uuid(),
  sync_job_id: z.uuid(),
  organization_id: z.uuid(),
  connection_id: z.uuid(),
  provider_key: z.string(),
  actor_user_id: z.uuid(),
  lease_token: z.uuid(),
  lease_generation: z.number().int(),
  lease_expires_at: z.string(),
  provider_idempotency_key: z.string(),
  attempt_number: z.number().int(),
  item_keys: z.array(z.string()),
  confirmed_request: z.unknown(),
});

function parseClaimedRow(input: unknown): ClaimedIntegrationJob {
  const row = claimedRowSchema.safeParse(input);
  if (!row.success) throw new Error('Invalid claimed integration job');
  const parsed = claimedIntegrationJobSchema.safeParse({
    outboxJobId: row.data.outbox_job_id,
    syncJobId: row.data.sync_job_id,
    organizationId: row.data.organization_id,
    connectionId: row.data.connection_id,
    providerKey: row.data.provider_key,
    actorUserId: row.data.actor_user_id,
    leaseToken: row.data.lease_token,
    leaseGeneration: row.data.lease_generation,
    leaseExpiresAt: row.data.lease_expires_at,
    providerIdempotencyKey: row.data.provider_idempotency_key,
    attemptNumber: row.data.attempt_number,
    itemKeys: row.data.item_keys,
    confirmedRequest: row.data.confirmed_request,
  });
  if (!parsed.success) throw new Error('Invalid claimed integration job');
  return parsed.data;
}

export async function claimIntegrationJobs(
  client: SupabaseClient<Database>,
  input: { leaseOwner: string; batchSize: number; leaseSeconds: number },
): Promise<ClaimedIntegrationJob[]> {
  const { data, error } = await client.rpc('claim_integration_outbox_jobs', {
    p_lease_owner: input.leaseOwner,
    p_batch_size: input.batchSize,
    p_lease_seconds: input.leaseSeconds,
  });
  if (error) throw error;
  if (!Array.isArray(data)) throw new Error('Invalid claimed integration job');
  return data.map(parseClaimedRow);
}

const authorizationOutcome = z.enum([
  'authorized',
  'authorization_revoked',
  'delivery_uncertain',
  'not_found',
  'lease_conflict',
]);
const completionOutcome = z.enum([
  'completed',
  'replayed',
  'not_found',
  'lease_conflict',
  'terminal_conflict',
]);
const failureOutcome = z.enum([
  'retry_scheduled',
  'dead_lettered',
  'needs_attention',
  'not_found',
  'lease_conflict',
]);

export class SupabaseIntegrationDispatchGateway implements IntegrationDispatchGateway {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async validateExecution(input: Parameters<IntegrationDispatchGateway['validateExecution']>[0]) {
    const { data, error } = await this.client.rpc('validate_integration_outbox_execution', {
      p_job_id: input.outboxJobId,
      p_lease_token: input.leaseToken,
      p_lease_generation: input.leaseGeneration,
    });
    if (error) throw error;
    const parsed = authorizationOutcome.safeParse(data);
    if (!parsed.success) throw new Error('Invalid integration execution validation result');
    return parsed.data;
  }

  async authorize(input: Parameters<IntegrationDispatchGateway['authorize']>[0]) {
    const { data, error } = await this.client.rpc('authorize_integration_outbox_submission', {
      p_job_id: input.outboxJobId,
      p_lease_token: input.leaseToken,
      p_lease_generation: input.leaseGeneration,
    });
    if (error) throw error;
    const parsed = authorizationOutcome.safeParse(data);
    if (!parsed.success) throw new Error('Invalid integration authorization result');
    return parsed.data;
  }

  async complete(input: Parameters<IntegrationDispatchGateway['complete']>[0]) {
    const { data, error } = await this.client.rpc('complete_integration_outbox_job', {
      p_job_id: input.outboxJobId,
      p_lease_token: input.leaseToken,
      p_lease_generation: input.leaseGeneration,
      p_external_job_id: input.externalJobId,
      p_result: input.result as unknown as Json,
    });
    if (error) throw error;
    const parsed = completionOutcome.safeParse(data);
    if (!parsed.success) throw new Error('Invalid integration completion result');
    return parsed.data;
  }

  async fail(input: Parameters<IntegrationDispatchGateway['fail']>[0]) {
    const { data, error } = await this.client.rpc('fail_integration_outbox_job', {
      p_job_id: input.outboxJobId,
      p_lease_token: input.leaseToken,
      p_lease_generation: input.leaseGeneration,
      p_error_code: input.errorCode,
      p_retryable: input.retryable,
    });
    if (error) throw error;
    const parsed = failureOutcome.safeParse(data);
    if (!parsed.success) throw new Error('Invalid integration failure result');
    return parsed.data;
  }
}
