import { z } from 'zod';

import { failure, success, type AppResult } from '../../../lib/result';
import type { AuthorizationContext } from '../../organizations/application/capabilities';
import { requireCapability } from '../../organizations/application/require-capability';
import type { LockEvaluationGateway } from './contracts';
import { defaultEvaluationGateway } from './evaluation-dependencies';

const schema = z.strictObject({
  organizationId: z.uuid(),
  tryoutId: z.uuid(),
  divisionId: z.uuid(),
  sessionId: z.uuid(),
  groupId: z.uuid().nullable(),
  evaluationId: z.uuid(),
});

export async function lockEvaluation(
  input: unknown,
  actor: AuthorizationContext,
  expectedVersion: number,
  dependencies: { gateway?: LockEvaluationGateway } = {},
): Promise<AppResult<{ version: number }, { code: string }>> {
  const parsed = schema.safeParse(input);
  if (!parsed.success || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1)
    return failure({ code: 'invalid_input' });
  const data = parsed.data;
  if (
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
    const result = await (dependencies.gateway ?? (await defaultEvaluationGateway())).lock({
      ...data,
      expectedVersion,
    });
    return result.outcome === 'locked'
      ? success({ version: result.version })
      : failure({ code: result.outcome });
  } catch {
    return failure({ code: 'unexpected' });
  }
}

export type { LockEvaluationGateway } from './contracts';
