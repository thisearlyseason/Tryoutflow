import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

import type { Database, Json } from '../../../infrastructure/supabase/database.types';
import { finalizedRosterSnapshotSchema } from '../domain/contracts';
import type { PreviewRosterExportGateway } from '../application/preview-roster-export';
import type { RetrySyncJobGateway } from '../application/retry-sync-job';
import type { StartRosterExportGateway } from '../application/start-roster-export';
import type { DemoConnectionGateway } from '../application/connect-demo-provider';

const id = z.uuid();
const previewContextRowSchema = z.discriminatedUnion('outcome', [
  z.strictObject({
    outcome: z.literal('ok'),
    provider_key: z.string().regex(/^[a-z][a-z0-9-]{1,49}$/u),
    mock_data: z.boolean(),
    roster: finalizedRosterSnapshotSchema,
  }),
  z.strictObject({
    outcome: z.enum(['forbidden', 'not_found', 'invalid_state']),
    provider_key: z.null(),
    mock_data: z.null(),
    roster: z.null(),
  }),
]);

const confirmationSchema = z.discriminatedUnion('outcome', [
  z.strictObject({ outcome: z.enum(['queued', 'replayed']), job_id: id }),
  z.strictObject({
    outcome: z.enum([
      'forbidden',
      'not_found',
      'stale',
      'conflict',
      'already_consumed',
      'invalid_input',
    ]),
    job_id: z.null(),
  }),
]);

const retrySchema = z.discriminatedUnion('outcome', [
  z.strictObject({
    outcome: z.enum(['queued', 'replayed']),
    job_id: id,
    retried_item_count: z.number().int().min(1).max(5_100),
    preserved_completed_item_count: z.number().int().min(0).max(5_100),
  }),
  z.strictObject({
    outcome: z.enum(['forbidden', 'not_found', 'nothing_to_retry', 'conflict', 'invalid_input']),
    job_id: id.nullable(),
    retried_item_count: z.number().int().min(0).max(5_100),
    preserved_completed_item_count: z.number().int().min(0).max(5_100),
  }),
]);

const previewPersistenceOutcome = z.enum([
  'created',
  'replayed',
  'forbidden',
  'conflict',
  'stale',
  'not_found',
]);
const connectionPersistenceOutcome = z.enum([
  'connected',
  'replayed',
  'forbidden',
  'invalid_input',
  'conflict',
]);

export class SupabaseIntegrationGateway
  implements
    PreviewRosterExportGateway,
    StartRosterExportGateway,
    RetrySyncJobGateway,
    DemoConnectionGateway
{
  constructor(private readonly client: SupabaseClient<Database>) {}

  async saveConnection(input: Parameters<DemoConnectionGateway['saveConnection']>[0]) {
    const { data, error } = await this.client.rpc('save_integration_connection', {
      p_organization_id: input.organizationId,
      p_provider_key: input.providerKey,
      p_connection_id: input.connectionId,
      p_display_name: input.displayName,
      p_mock_data: input.mockData,
    });
    if (error) throw error;
    const parsed = connectionPersistenceOutcome.safeParse(data);
    if (!parsed.success) throw new Error('Invalid integration connection persistence result');
    return parsed.data;
  }

  async loadPreviewContext(input: Parameters<PreviewRosterExportGateway['loadPreviewContext']>[0]) {
    const { data, error } = await this.client.rpc('load_roster_export_context', {
      p_organization_id: input.organizationId,
      p_connection_id: input.connectionId,
      p_roster_version_id: input.rosterVersionId,
    });
    if (error) throw error;
    if (!Array.isArray(data) || data.length !== 1) {
      throw new Error('Invalid integration roster context');
    }
    const parsed = previewContextRowSchema.safeParse(data[0]);
    if (!parsed.success) throw new Error('Invalid integration roster context');
    if (parsed.data.outcome !== 'ok') return { outcome: parsed.data.outcome };
    return {
      outcome: 'ok' as const,
      providerKey: parsed.data.provider_key,
      mockData: parsed.data.mock_data,
      roster: parsed.data.roster,
    };
  }

  async savePreview(input: Parameters<PreviewRosterExportGateway['savePreview']>[0]) {
    const { data, error } = await this.client.rpc('save_roster_export_preview', {
      p_organization_id: input.organizationId,
      p_connection_id: input.connectionId,
      p_roster_version_id: input.rosterVersionId,
      p_destination: input.destination as unknown as Json,
      p_approved_fields: input.approvedFields,
      p_provider_preview_id: input.previewId,
      p_confirmation_token: input.confirmationToken,
      p_snapshot_digest: input.snapshotDigest,
      p_preview: input.preview as unknown as Json,
      p_payload_digest: input.payloadDigest,
    });
    if (error) throw error;
    const outcome = previewPersistenceOutcome.safeParse(data);
    if (!outcome.success) throw new Error('Invalid integration preview persistence result');
    return { outcome: outcome.data };
  }

  async confirmPreview(input: Parameters<StartRosterExportGateway['confirmPreview']>[0]) {
    const { data, error } = await this.client.rpc('confirm_roster_export_preview', {
      p_organization_id: input.organizationId,
      p_provider_preview_id: input.previewId,
      p_confirmation_token: input.confirmationToken,
      p_idempotency_key: input.idempotencyKey,
    });
    if (error) throw error;
    const parsed = confirmationSchema.safeParse(data);
    if (!parsed.success) throw new Error('Invalid integration export confirmation result');
    if (parsed.data.outcome === 'queued' || parsed.data.outcome === 'replayed') {
      return { outcome: parsed.data.outcome, jobId: parsed.data.job_id };
    }
    return { outcome: parsed.data.outcome };
  }

  async retry(input: Parameters<RetrySyncJobGateway['retry']>[0]) {
    const { data, error } = await this.client.rpc('retry_integration_sync_job', {
      p_organization_id: input.organizationId,
      p_job_id: input.jobId,
      p_idempotency_key: input.idempotencyKey,
    });
    if (error) throw error;
    const parsed = retrySchema.safeParse(data);
    if (!parsed.success) throw new Error('Invalid integration retry result');
    if (parsed.data.outcome === 'queued' || parsed.data.outcome === 'replayed') {
      return {
        outcome: parsed.data.outcome,
        jobId: parsed.data.job_id,
        retriedItemCount: parsed.data.retried_item_count,
        preservedCompletedItemCount: parsed.data.preserved_completed_item_count,
      };
    }
    return { outcome: parsed.data.outcome };
  }
}
