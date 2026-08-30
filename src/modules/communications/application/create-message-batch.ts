import { z } from 'zod';

import { type DecisionMessageKind } from './render-message';

const renderedRecipientSchema = z
  .object({
    registrationId: z.uuid(),
    recipientEmail: z.email().max(320),
    athletePreferredName: z.string().trim().min(1).max(120),
    subject: z.string().min(1).max(200),
    text: z.string().min(1).max(20_000),
    html: z.string().min(1).max(30_000),
  })
  .strict();

const recipientPreviewSchema = z
  .object({
    organizationId: z.uuid(),
    tryoutId: z.uuid(),
    divisionId: z.uuid(),
    rosterVersionId: z.uuid(),
    rosterVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    kind: z.enum(['callback', 'selected', 'waitlisted', 'released']),
    templateId: z.string().trim().min(1).max(100),
    templateVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    editableText: z.string().trim().min(1).max(4_000),
    recipients: z.array(renderedRecipientSchema).min(1).max(500),
    count: z.number().int().min(1).max(500),
    digest: z.string().regex(/^[0-9a-f]{64}$/u),
    recipientDigest: z.string().regex(/^[0-9a-f]{64}$/u),
    previewToken: z.string().regex(/^[0-9a-f]{64}$/u),
    issuedAt: z.iso.datetime({ offset: true }),
    expiresAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export type RecipientPreview = Readonly<z.infer<typeof recipientPreviewSchema>>;
export const batchConfirmationSchema = recipientPreviewSchema
  .pick({
    organizationId: true,
    tryoutId: true,
    divisionId: true,
    rosterVersionId: true,
    digest: true,
    previewToken: true,
  })
  .extend({ confirmation: z.literal('SEND EXACT BATCH') })
  .strict();
export type BatchConfirmation = z.infer<typeof batchConfirmationSchema>;

type RpcClient = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
};

export async function loadRecipientPreview(
  input: {
    organizationId: string;
    rosterVersionId: string;
    kind: DecisionMessageKind;
    editableText: string;
    templateId: string;
    expectedTemplateVersion: number;
  },
  client: RpcClient,
): Promise<RecipientPreview | { outcome: 'forbidden' | 'invalid_input' | 'stale_snapshot' }> {
  const { data, error } = await client.rpc('preview_decision_message_batch_v2', {
    p_organization_id: input.organizationId,
    p_roster_version_id: input.rosterVersionId,
    p_decision: input.kind,
    p_editable_text: input.editableText,
    p_template_id: input.templateId,
    p_expected_template_version: input.expectedTemplateVersion,
  });
  if (error || !data || typeof data !== 'object') return { outcome: 'invalid_input' };
  const value = data as Record<string, unknown>;
  if (value.outcome !== 'ok')
    return {
      outcome: ['forbidden', 'stale_snapshot'].includes(String(value.outcome))
        ? (String(value.outcome) as 'forbidden' | 'stale_snapshot')
        : 'invalid_input',
    };
  const { outcome: _outcome, ...previewValue } = value;
  const parsed = recipientPreviewSchema.safeParse(previewValue);
  return parsed.success && parsed.data.count === parsed.data.recipients.length
    ? parsed.data
    : { outcome: 'invalid_input' };
}

export async function createMessageBatch(
  input: unknown,
  client: RpcClient,
): Promise<
  | { outcome: 'queued' | 'replayed'; batchId: string; queuedCount: number }
  | { outcome: 'forbidden' | 'invalid_input' | 'stale_snapshot' | 'preview_conflict' }
> {
  const parsed = batchConfirmationSchema.safeParse(input);
  if (!parsed.success) return { outcome: 'invalid_input' };
  const { data, error } = await client.rpc('create_decision_message_batch_v2', {
    p_organization_id: parsed.data.organizationId,
    p_tryout_id: parsed.data.tryoutId,
    p_division_id: parsed.data.divisionId,
    p_roster_version_id: parsed.data.rosterVersionId,
    p_preview_token: parsed.data.previewToken,
    p_preview_digest: parsed.data.digest,
    p_confirmation: parsed.data.confirmation,
  });
  if (error) return { outcome: 'invalid_input' };
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== 'object') return { outcome: 'invalid_input' };
  const outcome = String((row as Record<string, unknown>).outcome);
  if (outcome === 'queued' || outcome === 'replayed') {
    const batchId = String((row as Record<string, unknown>).batch_id);
    const queuedCount = Number((row as Record<string, unknown>).queued_count);
    if (!z.uuid().safeParse(batchId).success || !Number.isSafeInteger(queuedCount))
      return { outcome: 'invalid_input' };
    return { outcome, batchId, queuedCount };
  }
  return ['forbidden', 'invalid_input', 'stale_snapshot', 'preview_conflict'].includes(outcome)
    ? { outcome: outcome as 'forbidden' | 'invalid_input' | 'stale_snapshot' | 'preview_conflict' }
    : { outcome: 'invalid_input' };
}
