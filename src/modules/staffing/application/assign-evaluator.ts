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
  z.strictObject({ kind: z.literal('tryout'), tryoutId: z.uuid() }),
  z.strictObject({ kind: z.literal('division'), tryoutId: z.uuid(), divisionId: z.uuid() }),
  z.strictObject({
    kind: z.literal('session'),
    tryoutId: z.uuid(),
    sessionId: z.uuid(),
    divisionId: z.uuid().optional(),
  }),
  z.strictObject({
    kind: z.literal('group'),
    tryoutId: z.uuid(),
    sessionId: z.uuid(),
    groupId: z.uuid(),
    divisionId: z.uuid().optional(),
  }),
]);
const inputSchema = z.strictObject({
  organizationId: z.uuid(),
  evaluatorUserId: z.uuid(),
  scope: scopeSchema,
  expiresAt: z.iso.datetime().optional(),
});

export type AssignEvaluatorGateway = {
  assign(input: {
    organizationId: string;
    evaluatorUserId: string;
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
  scope: EvaluationScope,
): AuthorizationResource {
  return {
    organizationId,
    tryoutId: scope.tryoutId,
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
    !requireCapability(actor, 'tryout:write', scopeResource(organizationId, parsed.data.scope)).ok
  )
    return failure({ code: 'forbidden' });

  try {
    const result = await gateway.assign({
      organizationId,
      evaluatorUserId: parsed.data.evaluatorUserId as UserId,
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
