import { z } from 'zod';

import { can, type AuthorizationContext } from '../../organizations/application/capabilities';
import { parseOrganizationId } from '../../../lib/ids';

const retrySyncJobInputSchema = z.strictObject({
  organizationId: z.uuid(),
  jobId: z.uuid(),
  idempotencyKey: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{15,199}$/u),
});

export type RetrySyncJobInput = z.input<typeof retrySyncJobInputSchema>;
export type RetrySyncJobResult =
  | {
      outcome: 'queued' | 'replayed';
      jobId: string;
      state: string;
      retriedItemCount: number;
      preservedCompletedItemCount: number;
      preservedSkippedItemCount: number;
    }
  | {
      outcome:
        | 'invalid_input'
        | 'forbidden'
        | 'not_found'
        | 'nothing_to_retry'
        | 'manual_attention_required'
        | 'conflict'
        | 'unavailable';
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
    return await dependencies.gateway.retry({ ...parsed.data, actorId: actor.userId });
  } catch {
    return { outcome: 'unavailable' };
  }
}
