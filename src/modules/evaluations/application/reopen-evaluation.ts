import { z } from 'zod';

import { failure, success, type AppResult } from '../../../lib/result';
import type { AuthorizationContext } from '../../organizations/application/capabilities';
import { requireCapability } from '../../organizations/application/require-capability';
import type { ReopenEvaluationGateway } from './contracts';
import { defaultEvaluationGateway } from './evaluation-dependencies';

const inputSchema = z.strictObject({
  organizationId: z.uuid(),
  tryoutId: z.uuid(),
  divisionId: z.uuid(),
  sessionId: z.uuid(),
  groupId: z.uuid().nullable(),
  evaluationId: z.uuid(),
  reason: z.string().trim().min(10).max(500),
});

export async function reopenEvaluation(
  input: unknown,
  actor: AuthorizationContext,
  expectedVersion: number,
  dependencies: { gateway?: ReopenEvaluationGateway } = {},
): Promise<AppResult<{ version: number }, { code: string }>> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return failure({ code: 'invalid_reason' });
  const data = parsed.data;
  if (
    !Number.isSafeInteger(expectedVersion) ||
    expectedVersion < 1 ||
    !requireCapability(actor, 'tryout:write', {
      organizationId: data.organizationId as AuthorizationContext['organizationId'],
      tryoutId: data.tryoutId,
      divisionId: data.divisionId,
      sessionId: data.sessionId,
      groupId: data.groupId ?? undefined,
    }).ok
  )
    return failure({ code: 'forbidden' });
  try {
    const result = await (dependencies.gateway ?? (await defaultEvaluationGateway())).reopen({
      ...data,
      expectedVersion,
    });
    return result.outcome === 'reopened'
      ? success({ version: result.version })
      : failure({ code: result.outcome });
  } catch {
    return failure({ code: 'unexpected' });
  }
}

export type { ReopenEvaluationGateway } from './contracts';
