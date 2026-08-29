import { z } from 'zod';

import { failure, success, type AppResult } from '../../../lib/result';
import type { AuthorizationContext } from '../../organizations/application/capabilities';
import { requireCapability } from '../../organizations/application/require-capability';
import type { SaveEvaluationGateway } from './contracts';
import { defaultEvaluationGateway } from './evaluation-dependencies';

const inputSchema = z.strictObject({
  organizationId: z.uuid(),
  tryoutId: z.uuid(),
  divisionId: z.uuid(),
  registrationId: z.uuid(),
  sessionId: z.uuid(),
  groupId: z.uuid().nullable(),
  evaluatorUserId: z.uuid(),
  rubricVersionId: z.uuid(),
  scores: z.array(z.strictObject({ categoryId: z.uuid(), value: z.number().int() })).max(100),
  note: z.string().trim().min(1).max(4000).optional(),
  noteTagIds: z.array(z.uuid()).max(50).optional(),
  flags: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
});

export type SaveError = {
  code:
    | 'invalid_input'
    | 'forbidden'
    | 'invalid_context'
    | 'invalid_score'
    | 'invalid_note_tag'
    | 'locked'
    | 'conflict'
    | 'unexpected';
};

export async function saveEvaluationDraft(
  input: unknown,
  evaluator: AuthorizationContext,
  expectedVersion: number,
  dependencies: { gateway?: SaveEvaluationGateway } = {},
): Promise<AppResult<{ evaluationId: string; version: number }, SaveError>> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success || !Number.isSafeInteger(expectedVersion) || expectedVersion < 0) {
    return failure({ code: 'invalid_input' });
  }
  const data = parsed.data;
  if (
    data.evaluatorUserId !== evaluator.userId ||
    !requireCapability(evaluator, 'evaluation:update-own', {
      organizationId: data.organizationId as AuthorizationContext['organizationId'],
      tryoutId: data.tryoutId,
      divisionId: data.divisionId,
      sessionId: data.sessionId,
      groupId: data.groupId ?? undefined,
      evaluatorUserId: data.evaluatorUserId as AuthorizationContext['userId'],
    }).ok
  ) {
    return failure({ code: 'forbidden' });
  }
  try {
    const result = await (dependencies.gateway ?? (await defaultEvaluationGateway())).save({
      ...data,
      expectedVersion,
    });
    if (result.outcome === 'saved') {
      return success({ evaluationId: result.evaluationId, version: result.version });
    }
    return failure({ code: result.outcome });
  } catch {
    return failure({ code: 'unexpected' });
  }
}

export type { SaveEvaluationGateway } from './contracts';
