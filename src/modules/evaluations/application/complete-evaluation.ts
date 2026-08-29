import { z } from 'zod';

import { failure, success, type AppResult } from '../../../lib/result';
import type { AuthorizationContext } from '../../organizations/application/capabilities';
import { requireCapability } from '../../organizations/application/require-capability';
import type { CompleteEvaluationGateway } from './contracts';
import { defaultEvaluationGateway } from './evaluation-dependencies';

const schema = z.strictObject({
  organizationId: z.uuid(),
  tryoutId: z.uuid(),
  divisionId: z.uuid(),
  sessionId: z.uuid(),
  groupId: z.uuid().nullable(),
  evaluationId: z.uuid(),
});

type CompleteError = {
  code:
    | 'invalid_input'
    | 'forbidden'
    | 'required_scores_missing'
    | 'locked'
    | 'conflict'
    | 'unexpected';
};

export async function completeEvaluationRecord(
  input: unknown,
  evaluator: AuthorizationContext,
  expectedVersion: number,
  dependencies: { gateway?: CompleteEvaluationGateway } = {},
): Promise<AppResult<{ version: number }, CompleteError>> {
  const parsed = schema.safeParse(input);
  if (!parsed.success || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
    return failure({ code: 'invalid_input' });
  }
  const data = parsed.data;
  if (
    !requireCapability(evaluator, 'evaluation:update-own', {
      organizationId: data.organizationId as AuthorizationContext['organizationId'],
      tryoutId: data.tryoutId,
      divisionId: data.divisionId,
      sessionId: data.sessionId,
      groupId: data.groupId ?? undefined,
      evaluatorUserId: evaluator.userId,
    }).ok
  ) {
    return failure({ code: 'forbidden' });
  }
  try {
    const result = await (dependencies.gateway ?? (await defaultEvaluationGateway())).complete({
      ...data,
      expectedVersion,
    });
    if (result.outcome === 'completed') return success({ version: result.version });
    if (
      result.outcome === 'forbidden' ||
      result.outcome === 'required_scores_missing' ||
      result.outcome === 'locked' ||
      result.outcome === 'conflict' ||
      result.outcome === 'unexpected'
    )
      return failure({ code: result.outcome });
    return failure({ code: 'unexpected' });
  } catch {
    return failure({ code: 'unexpected' });
  }
}

export type { CompleteEvaluationGateway } from './contracts';
