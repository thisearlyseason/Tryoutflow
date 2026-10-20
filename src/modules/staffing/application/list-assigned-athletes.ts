import { z } from 'zod';

import type { OrganizationId } from '../../../lib/ids';
import { failure, success, type AppResult } from '../../../lib/result';
import type { AuthorizationContext } from '../../organizations/application/capabilities';
import type { AssignedAthleteSummary } from '../domain/assignment';

const schema = z.strictObject({ organizationId: z.uuid(), tryoutId: z.uuid() });

export type AssignedAthleteGateway = {
  list(input: {
    organizationId: string;
    tryoutId: string;
    evaluatorUserId: string;
  }): Promise<AssignedAthleteSummary[]>;
};

export async function listAssignedAthletes(
  input: unknown,
  actor: AuthorizationContext,
  gateway: AssignedAthleteGateway,
): Promise<
  AppResult<AssignedAthleteSummary[], { code: 'invalid_input' | 'forbidden' | 'unexpected' }>
> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return failure({ code: 'invalid_input' });
  if (
    actor.organizationId !== (parsed.data.organizationId as OrganizationId) ||
    !actor.assignments.some(
      (assignment) =>
        assignment.role === 'evaluator' && assignment.scope.tryoutId === parsed.data.tryoutId,
    )
  )
    return failure({ code: 'forbidden' });
  try {
    return success(
      await gateway.list({
        organizationId: parsed.data.organizationId,
        tryoutId: parsed.data.tryoutId,
        evaluatorUserId: actor.userId,
      }),
    );
  } catch {
    return failure({ code: 'unexpected' });
  }
}
