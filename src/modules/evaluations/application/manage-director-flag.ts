import { z } from 'zod';

import { failure, success, type AppResult } from '../../../lib/result';
import type { AuthorizationContext } from '../../organizations/application/capabilities';
import { requireCapability } from '../../organizations/application/require-capability';
import type { DirectorFlagGateway } from './contracts';
import { defaultEvaluationGateway } from './evaluation-dependencies';

const schema = z.strictObject({
  organizationId: z.uuid(),
  tryoutId: z.uuid(),
  divisionId: z.uuid(),
  registrationId: z.uuid(),
  sessionId: z.uuid(),
  groupId: z.uuid().nullable(),
  flagId: z.uuid().nullable(),
  action: z.enum(['upsert', 'revoke']),
  flagType: z.enum(['needs_another_look', 'injury_concern', 'eligibility_review']),
});

export async function manageDirectorFlag(
  input: unknown,
  actor: AuthorizationContext,
  dependencies: { gateway?: DirectorFlagGateway } = {},
): Promise<AppResult<{ athleteFlagId: string; action: 'saved' | 'revoked' }, { code: string }>> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return failure({ code: 'invalid_input' });
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
    const result = await (dependencies.gateway ?? (await defaultEvaluationGateway())).manage(data);
    return result.outcome === 'saved' || result.outcome === 'revoked'
      ? success({ athleteFlagId: result.athleteFlagId, action: result.outcome })
      : failure({ code: result.outcome });
  } catch {
    return failure({ code: 'unexpected' });
  }
}

export type { DirectorFlagGateway } from './contracts';
