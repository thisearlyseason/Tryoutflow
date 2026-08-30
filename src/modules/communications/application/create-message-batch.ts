import { createHash } from 'node:crypto';
import { z } from 'zod';

import { type DecisionMessageKind } from './render-message';

const recipientSchema = z
  .object({
    registrationId: z.uuid(),
    recipientEmail: z
      .email()
      .max(320)
      .transform((value) => value.trim().toLowerCase()),
    athletePreferredName: z.string().trim().min(1).max(120),
  })
  .strict();

const previewInputSchema = z
  .object({
    organizationId: z.uuid(),
    rosterVersionId: z.uuid(),
    rosterVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    kind: z.enum(['callback', 'selected', 'waitlisted', 'released']),
    editableText: z.string().trim().min(1).max(4_000),
    recipients: z.array(recipientSchema).min(1).max(500),
  })
  .strict();

type Recipient = z.infer<typeof recipientSchema>;
export type RecipientPreview = Readonly<{
  organizationId: string;
  rosterVersionId: string;
  rosterVersion: number;
  kind: DecisionMessageKind;
  editableText: string;
  recipients: readonly Recipient[];
  count: number;
  digest: string;
}>;

function canonicalPreview(value: z.infer<typeof previewInputSchema>) {
  return {
    organizationId: value.organizationId,
    rosterVersionId: value.rosterVersionId,
    rosterVersion: value.rosterVersion,
    kind: value.kind,
    editableText: value.editableText,
    recipients: [...value.recipients].sort((left, right) =>
      left.registrationId.localeCompare(right.registrationId),
    ),
  };
}

export function createRecipientPreview(input: unknown): RecipientPreview {
  const canonical = canonicalPreview(previewInputSchema.parse(input));
  const digest = createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
  return { ...canonical, count: canonical.recipients.length, digest };
}

export type BatchConfirmation = RecipientPreview & Readonly<{ confirmation: 'SEND EXACT BATCH' }>;

export function bindBatchConfirmation(preview: RecipientPreview): BatchConfirmation {
  return { ...preview, confirmation: 'SEND EXACT BATCH' };
}

type RpcClient = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
};

export async function loadRecipientPreview(
  input: {
    organizationId: string;
    rosterVersionId: string;
    kind: DecisionMessageKind;
    editableText: string;
  },
  client: RpcClient,
): Promise<RecipientPreview | { outcome: 'forbidden' | 'invalid_input' | 'stale_snapshot' }> {
  const { data, error } = await client.rpc('preview_decision_message_batch', {
    p_organization_id: input.organizationId,
    p_roster_version_id: input.rosterVersionId,
    p_decision: input.kind,
    p_editable_text: input.editableText,
  });
  if (error || !data || typeof data !== 'object') return { outcome: 'invalid_input' };
  const value = data as Record<string, unknown>;
  if (value.outcome !== 'ok') {
    return {
      outcome: ['forbidden', 'stale_snapshot'].includes(String(value.outcome))
        ? (String(value.outcome) as 'forbidden' | 'stale_snapshot')
        : 'invalid_input',
    };
  }
  const parsed = previewInputSchema.safeParse({
    organizationId: value.organizationId,
    rosterVersionId: value.rosterVersionId,
    rosterVersion: value.rosterVersion,
    kind: value.kind,
    editableText: value.editableText,
    recipients: value.recipients,
  });
  if (!parsed.success || !/^[0-9a-f]{64}$/u.test(String(value.digest))) {
    return { outcome: 'invalid_input' };
  }
  const canonical = canonicalPreview(parsed.data);
  if (Number(value.count) !== canonical.recipients.length) return { outcome: 'invalid_input' };
  return { ...canonical, count: canonical.recipients.length, digest: String(value.digest) };
}

export async function createMessageBatch(
  input: BatchConfirmation,
  client: RpcClient,
): Promise<
  | { outcome: 'queued' | 'replayed'; batchId: string; queuedCount: number }
  | { outcome: 'forbidden' | 'invalid_input' | 'stale_snapshot' | 'preview_conflict' }
> {
  const preview = createRecipientPreview({
    organizationId: input.organizationId,
    rosterVersionId: input.rosterVersionId,
    rosterVersion: input.rosterVersion,
    kind: input.kind,
    editableText: input.editableText,
    recipients: input.recipients,
  });
  if (
    input.confirmation !== 'SEND EXACT BATCH' ||
    !/^[0-9a-f]{64}$/u.test(input.digest) ||
    input.count !== preview.count
  ) {
    return { outcome: 'preview_conflict' };
  }
  const { data, error } = await client.rpc('create_decision_message_batch', {
    p_organization_id: preview.organizationId,
    p_roster_version_id: preview.rosterVersionId,
    p_expected_version: preview.rosterVersion,
    p_decision: preview.kind,
    p_editable_text: preview.editableText,
    p_preview_digest: input.digest,
    p_expected_recipient_ids: preview.recipients.map((recipient) => recipient.registrationId),
    p_confirmation: input.confirmation,
  });
  if (error) return { outcome: 'invalid_input' };
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== 'object') return { outcome: 'invalid_input' };
  const outcome = String((row as Record<string, unknown>).outcome);
  if (outcome === 'queued' || outcome === 'replayed') {
    return {
      outcome,
      batchId: String((row as Record<string, unknown>).batch_id),
      queuedCount: Number((row as Record<string, unknown>).queued_count),
    };
  }
  if (['forbidden', 'invalid_input', 'stale_snapshot', 'preview_conflict'].includes(outcome)) {
    return {
      outcome: outcome as 'forbidden' | 'invalid_input' | 'stale_snapshot' | 'preview_conflict',
    };
  }
  return { outcome: 'invalid_input' };
}
