import { z } from 'zod';

import { can, type AuthorizationContext } from '../../organizations/application/capabilities';
import { parseOrganizationId } from '../../../lib/ids';

const retrySyncJobInputSchema = z.strictObject({
  organizationId: z.uuid(),
  jobId: z.uuid(),
  idempotencyKey: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{15,199}$/u),
});

export type RetrySyncJobInput = z.input<typeof retrySyncJobInputSchema>;
type DurableSyncJobState =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'partially_completed'
  | 'failed'
  | 'needs_attention'
  | 'cancelled';
export type RetrySyncJobResult =
  | {
      outcome: 'queued' | 'replayed' | 'nothing_to_retry' | 'manual_attention_required';
      jobId: string;
      state: DurableSyncJobState;
      retriedItemCount: number;
      preservedCompletedItemCount: number;
      preservedSkippedItemCount: number;
      completedCount: number;
      skippedCount: number;
      failedCount: number;
      retryEligibleCount: number;
    }
  | {
      outcome: 'invalid_input' | 'forbidden' | 'not_found' | 'conflict' | 'unavailable';
    };

export type RetrySyncJobGateway = Readonly<{
  retry(input: {
    organizationId: string;
    actorId: string;
    jobId: string;
    idempotencyKey: string;
  }): Promise<Exclude<RetrySyncJobResult, { outcome: 'invalid_input' | 'unavailable' }>>;
}>;

export async function retrySyncJob(
  input: RetrySyncJobInput,
  actor: AuthorizationContext,
  dependencies: { gateway: RetrySyncJobGateway },
): Promise<RetrySyncJobResult> {
  const parsed = retrySyncJobInputSchema.safeParse(input);
  if (!parsed.success) return { outcome: 'invalid_input' };
  if (
    !can(actor, 'integration:manage', {
      organizationId: parseOrganizationId(parsed.data.organizationId),
    })
  ) {
    return { outcome: 'forbidden' };
  }
  try {
    const result = await dependencies.gateway.retry({ ...parsed.data, actorId: actor.userId });
    if ('jobId' in result && result.jobId !== parsed.data.jobId) {
      return { outcome: 'unavailable' };
    }
    return result;
  } catch {
    return { outcome: 'unavailable' };
  }
}
