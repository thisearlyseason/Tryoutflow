import { z } from 'zod';

import { failure, success, type AppResult } from '../../../lib/result';
import type { AuthorizationContext } from '../../organizations/application/capabilities';
import { requireCapability } from '../../organizations/application/require-capability';

const inputSchema = z.strictObject({
  organizationId: z.uuid(),
  tryoutId: z.uuid(),
  evaluationId: z.uuid(),
  reason: z.string().trim().min(10).max(500),
});

export type ReopenEvaluationGateway = {
  reopen(input: {
    organizationId: string;
    evaluationId: string;
    expectedVersion: number;
    reason: string;
  }): Promise<
    | { outcome: 'reopened'; version: number }
    | { outcome: 'forbidden' | 'invalid_state' | 'conflict' }
  >;
};

export async function reopenEvaluation(
  input: unknown,
  actor: AuthorizationContext,
  expectedVersion: number,
  gateway: ReopenEvaluationGateway,
): Promise<AppResult<{ version: number }, { code: string }>> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return failure({ code: 'invalid_reason' });
  if (
    !Number.isSafeInteger(expectedVersion) ||
    expectedVersion < 1 ||
    !requireCapability(actor, 'tryout:write', {
      organizationId: parsed.data.organizationId as AuthorizationContext['organizationId'],
      tryoutId: parsed.data.tryoutId,
    }).ok
  )
    return failure({ code: 'forbidden' });
  const result = await gateway.reopen({ ...parsed.data, expectedVersion });
  return result.outcome === 'reopened'
    ? success({ version: result.version })
    : failure({ code: result.outcome });
}
