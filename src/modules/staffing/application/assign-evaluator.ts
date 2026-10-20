import { z } from 'zod';

import type { OrganizationId, UserId } from '../../../lib/ids';
import { failure, success, type AppResult } from '../../../lib/result';
import type {
  AuthorizationContext,
  AuthorizationResource,
} from '../../organizations/application/capabilities';
import { requireCapability } from '../../organizations/application/require-capability';
import type { EvaluationScope } from '../domain/assignment';

const scopeSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('tryout') }),
  z.strictObject({ kind: z.literal('division'), divisionId: z.uuid() }),
  z.strictObject({ kind: z.literal('session'), sessionId: z.uuid() }),
  z.strictObject({ kind: z.literal('group'), groupId: z.uuid() }),
]);
const inputSchema = z.strictObject({
  organizationId: z.uuid(),
  evaluatorUserId: z.uuid(),
  tryoutId: z.uuid(),
  scope: scopeSchema,
  expiresAt: z.iso.datetime().optional(),
});

export type AssignEvaluatorGateway = {
  assign(input: {
    organizationId: string;
    evaluatorUserId: string;
    tryoutId: string;
    scope: EvaluationScope;
    expiresAt?: string;
  }): Promise<
    | { outcome: 'assigned'; assignmentId?: string }
    | { outcome: 'duplicate' | 'invalid_scope' | 'not_member' | 'forbidden' }
  >;
};

type AssignmentError = {
  code: 'invalid_input' | 'forbidden' | 'invalid_scope' | 'not_member' | 'conflict' | 'unexpected';
};

function scopeResource(
  organizationId: OrganizationId,
  tryoutId: string,
  scope: EvaluationScope,
): AuthorizationResource {
  return {
    organizationId,
    tryoutId,
    divisionId: 'divisionId' in scope ? scope.divisionId : undefined,
    sessionId: 'sessionId' in scope ? scope.sessionId : undefined,
    groupId: 'groupId' in scope ? scope.groupId : undefined,
  };
}

export async function assignEvaluator(
  input: unknown,
  actor: AuthorizationContext,
  gateway: AssignEvaluatorGateway,
): Promise<AppResult<{ assignmentId?: string }, AssignmentError>> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return failure({ code: 'invalid_input' });
  const organizationId = parsed.data.organizationId as OrganizationId;
  if (
    !requireCapability(
      actor,
      'tryout:write',
      scopeResource(organizationId, parsed.data.tryoutId, parsed.data.scope),
    ).ok
  )
    return failure({ code: 'forbidden' });

  try {
    const result = await gateway.assign({
      organizationId,
      evaluatorUserId: parsed.data.evaluatorUserId as UserId,
      tryoutId: parsed.data.tryoutId,
      scope: parsed.data.scope,
      expiresAt: parsed.data.expiresAt,
    });
    if (result.outcome === 'assigned') return success({ assignmentId: result.assignmentId });
    if (result.outcome === 'duplicate') return failure({ code: 'conflict' });
    return failure({ code: result.outcome });
  } catch {
    return failure({ code: 'unexpected' });
  }
}
