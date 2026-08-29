import { z } from 'zod';

import { failure, success, type AppResult } from '../../../lib/result';
import type { AuthorizationContext } from '../../organizations/application/capabilities';
import { requireCapability } from '../../organizations/application/require-capability';
import { REVISE_ROSTER_CONFIRMATION, rosterScopeSchema } from '../domain/roster';
import type { ReviseRosterGateway } from './contracts';
import { defaultRosterGateway } from './roster-dependencies';

const inputSchema = rosterScopeSchema.extend({
  rosterVersionId: z.uuid(),
  reason: z.string().trim().min(10).max(500),
  confirmation: z.literal(REVISE_ROSTER_CONFIRMATION),
});

export async function reviseRoster(
  input: unknown,
  actor: AuthorizationContext,
  dependencies: { gateway?: ReviseRosterGateway } = {},
): Promise<
  AppResult<{ rosterVersionId: string; state: 'draft'; version: number }, { code: string }>
> {
  if (
    typeof input !== 'object' ||
    input === null ||
    !('confirmation' in input) ||
    input.confirmation !== REVISE_ROSTER_CONFIRMATION
  )
    return failure({ code: 'confirmation_required' });
  if (
    !('reason' in input) ||
    typeof input.reason !== 'string' ||
    input.reason.trim().length < 10 ||
    input.reason.trim().length > 500
  )
    return failure({ code: 'invalid_reason' });
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return failure({ code: 'invalid_roster' });
  const data = parsed.data;
  if (
    !requireCapability(actor, 'roster:write', {
      organizationId: data.organizationId as AuthorizationContext['organizationId'],
      tryoutId: data.tryoutId,
      divisionId: data.divisionId,
    }).ok
  )
    return failure({ code: 'forbidden' });
  try {
    const result = await (dependencies.gateway ?? (await defaultRosterGateway())).revise(data);
    return result.outcome === 'revised'
      ? success({
          rosterVersionId: result.rosterVersionId,
          state: 'draft',
          version: result.version,
        })
      : failure({ code: result.outcome });
  } catch {
    return failure({ code: 'unexpected' });
  }
}

export type { ReviseRosterGateway } from './contracts';
