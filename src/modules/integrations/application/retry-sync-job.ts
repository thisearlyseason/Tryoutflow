import { z } from 'zod';

import { can, type AuthorizationContext } from '../../organizations/application/capabilities';
import { parseOrganizationId } from '../../../lib/ids';

const retrySyncJobInputSchema = z.strictObject({
  organizationId: z.uuid(),
  jobId: z.uuid(),
  idempotencyKey: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{15,199}$/u),
});

export type RetrySyncJobInput = z.input<typeof retrySyncJobInputSchema>;
const durableSyncJobStateSchema = z.enum([
  'pending',
  'processing',
  'completed',
  'partially_completed',
  'failed',
  'needs_attention',
  'cancelled',
]);
const jobBoundRetryResultSchema = z.strictObject({
  outcome: z.enum(['queued', 'replayed', 'nothing_to_retry', 'manual_attention_required']),
  jobId: z.uuid(),
  state: durableSyncJobStateSchema,
  retriedItemCount: z.number().int().nonnegative(),
  preservedCompletedItemCount: z.number().int().nonnegative(),
  preservedSkippedItemCount: z.number().int().nonnegative(),
  completedCount: z.number().int().nonnegative(),
  skippedCount: z.number().int().nonnegative(),
  failedCount: z.number().int().nonnegative(),
  retryEligibleCount: z.number().int().nonnegative(),
});
const jobBoundRetryOutcomes: ReadonlySet<string> = new Set(
  jobBoundRetryResultSchema.shape.outcome.options,
);

export type RetrySyncJobResult =
  | z.infer<typeof jobBoundRetryResultSchema>
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
    if (jobBoundRetryOutcomes.has(result.outcome)) {
      const jobBoundResult = jobBoundRetryResultSchema.safeParse(result);
      if (!jobBoundResult.success || jobBoundResult.data.jobId !== parsed.data.jobId) {
        return { outcome: 'unavailable' };
      }
      return jobBoundResult.data;
    }
    return result;
  } catch {
    return { outcome: 'unavailable' };
  }
}
