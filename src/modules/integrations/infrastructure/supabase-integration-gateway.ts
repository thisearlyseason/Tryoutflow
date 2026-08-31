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
    source_id: z.uuid(),
    source_digest: z.string().regex(/^[0-9a-f]{64}$/u),
    existing_athlete_ids: z.array(z.uuid()),
    provider_key: z.string().regex(/^[a-z][a-z0-9-]{1,49}$/u),
    mock_data: z.boolean(),
    roster: finalizedRosterSnapshotSchema,
  }),
  z.strictObject({
    outcome: z.enum(['forbidden', 'not_found', 'invalid_state', 'invalid_input']),
    source_id: z.null(),
    source_digest: z.null(),
    existing_athlete_ids: z.null(),
    provider_key: z.null(),
    mock_data: z.null(),
    roster: z.null(),
  }),
]);

const confirmationSchema = z.discriminatedUnion('outcome', [
  z.strictObject({
    outcome: z.enum(['queued', 'replayed', 'completed']),
    job_id: id,
    state: z.string(),
    item_count: z.number().int(),
    completed_count: z.number().int(),
    skipped_count: z.number().int(),
    failed_count: z.number().int(),
    retry_eligible_count: z.number().int().min(0).max(5_100),
  }),
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
    state: z.null(),
    item_count: z.number().int(),
    completed_count: z.number().int(),
    skipped_count: z.number().int(),
    failed_count: z.number().int(),
    retry_eligible_count: z.number().int().min(0).max(5_100),
  }),
]);

const retrySchema = z.discriminatedUnion('outcome', [
  z.strictObject({
    outcome: z.enum(['queued', 'replayed']),
    job_id: id,
    state: z.string(),
    retried_item_count: z.number().int().min(1).max(5_100),
    preserved_completed_item_count: z.number().int().min(0).max(5_100),
    preserved_skipped_item_count: z.number().int().min(0).max(5_100),
    completed_count: z.number().int().min(0).max(5_100),
    skipped_count: z.number().int().min(0).max(5_100),
    failed_count: z.number().int().min(0).max(5_100),
    retry_eligible_count: z.number().int().min(0).max(5_100),
  }),
  z.strictObject({
    outcome: z.enum([
      'forbidden',
      'not_found',
      'nothing_to_retry',
      'conflict',
      'invalid_input',
      'manual_attention_required',
    ]),
    job_id: id.nullable(),
    state: z.string().nullable(),
    retried_item_count: z.number().int().min(0).max(5_100),
    preserved_completed_item_count: z.number().int().min(0).max(5_100),
    preserved_skipped_item_count: z.number().int().min(0).max(5_100),
    completed_count: z.number().int().min(0).max(5_100),
    skipped_count: z.number().int().min(0).max(5_100),
    failed_count: z.number().int().min(0).max(5_100),
    retry_eligible_count: z.number().int().min(0).max(5_100),
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

  async issuePreviewSource(input: Parameters<PreviewRosterExportGateway['issuePreviewSource']>[0]) {
    const { data, error } = await this.client.rpc('issue_roster_export_source', {
      p_organization_id: input.organizationId,
      p_connection_id: input.connectionId,
      p_roster_version_id: input.rosterVersionId,
      p_destination: input.destination as unknown as Json,
      p_approved_fields: input.approvedFields,
    });
    if (error) throw error;
    const parsed = previewContextRowSchema.safeParse(data);
    if (!parsed.success) throw new Error('Invalid integration roster context');
    if (parsed.data.outcome !== 'ok') return { outcome: parsed.data.outcome };
    return {
      outcome: 'ok' as const,
      providerKey: parsed.data.provider_key,
      mockData: parsed.data.mock_data,
      roster: parsed.data.roster,
      sourceId: parsed.data.source_id,
      sourceDigest: parsed.data.source_digest,
      existingAthleteIds: parsed.data.existing_athlete_ids,
    };
  }

  async savePreview(input: Parameters<PreviewRosterExportGateway['savePreview']>[0]) {
    const { data, error } = await this.client.rpc('save_roster_export_preview_v2', {
      p_organization_id: input.organizationId,
      p_source_id: input.sourceId,
      p_source_digest: input.sourceDigest,
      p_provider_preview_id: input.previewId,
      p_confirmation_token: input.confirmationToken,
      p_preview: input.preview as unknown as Json,
    });
    if (error) throw error;
    const outcome = previewPersistenceOutcome.safeParse(data);
    if (!outcome.success) throw new Error('Invalid integration preview persistence result');
    return { outcome: outcome.data };
  }

  async confirmPreview(input: Parameters<StartRosterExportGateway['confirmPreview']>[0]) {
    const { data, error } = await this.client.rpc('confirm_roster_export_preview_v3', {
      p_organization_id: input.organizationId,
      p_provider_preview_id: input.previewId,
      p_confirmation_token: input.confirmationToken,
      p_idempotency_key: input.idempotencyKey,
    });
    if (error) throw error;
    const parsed = confirmationSchema.safeParse(data);
    if (!parsed.success) throw new Error('Invalid integration export confirmation result');
    if (
      parsed.data.outcome === 'queued' ||
      parsed.data.outcome === 'replayed' ||
      parsed.data.outcome === 'completed'
    ) {
      return {
        outcome: parsed.data.outcome,
        jobId: parsed.data.job_id,
        state: parsed.data.state,
        itemCount: parsed.data.item_count,
        completedCount: parsed.data.completed_count,
        skippedCount: parsed.data.skipped_count,
        failedCount: parsed.data.failed_count,
        retryEligibleCount: parsed.data.retry_eligible_count,
      };
    }
    return { outcome: parsed.data.outcome };
  }

  async retry(input: Parameters<RetrySyncJobGateway['retry']>[0]) {
    const { data, error } = await this.client.rpc('retry_integration_sync_job_v3', {
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
        state: parsed.data.state,
        retriedItemCount: parsed.data.retried_item_count,
        preservedCompletedItemCount: parsed.data.preserved_completed_item_count,
        preservedSkippedItemCount: parsed.data.preserved_skipped_item_count,
        completedCount: parsed.data.completed_count,
        skippedCount: parsed.data.skipped_count,
        failedCount: parsed.data.failed_count,
        retryEligibleCount: parsed.data.retry_eligible_count,
      };
    }
    return { outcome: parsed.data.outcome };
  }
}
