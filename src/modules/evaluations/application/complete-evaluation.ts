import { failure, success, type AppResult } from '../../../lib/result';
import type { AuthorizationContext } from '../../organizations/application/capabilities';
import { requireCapability } from '../../organizations/application/require-capability';

export type CompleteEvaluationGateway = {
  complete(input: {
    organizationId: string;
    evaluationId: string;
    expectedVersion: number;
  }): Promise<
    | { outcome: 'completed'; version: number }
    | { outcome: 'required_scores_missing' | 'invalid_score' | 'locked' | 'conflict' | 'forbidden' }
  >;
};

export async function completeEvaluationRecord(
  input: {
    organizationId: AuthorizationContext['organizationId'];
    tryoutId: string;
    sessionId: string;
    evaluationId: string;
  },
  evaluator: AuthorizationContext,
  expectedVersion: number,
  gateway: CompleteEvaluationGateway,
): Promise<AppResult<{ version: number }, { code: string }>> {
  if (
    !Number.isSafeInteger(expectedVersion) ||
    expectedVersion < 1 ||
    !requireCapability(evaluator, 'evaluation:update-own', {
      organizationId: input.organizationId,
      tryoutId: input.tryoutId,
      sessionId: input.sessionId,
      evaluatorUserId: evaluator.userId,
    }).ok
  )
    return failure({ code: 'forbidden' });
  const result = await gateway.complete({
    organizationId: input.organizationId,
    evaluationId: input.evaluationId,
    expectedVersion,
  });
  return result.outcome === 'completed'
    ? success({ version: result.version })
    : failure({ code: result.outcome });
}
