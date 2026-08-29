import { z } from 'zod';

import { failure, success, type AppResult } from '../../../lib/result';
import type { AuthorizationContext } from '../../organizations/application/capabilities';
import { requireCapability } from '../../organizations/application/require-capability';
import { FINALIZE_ROSTER_CONFIRMATION, rosterVersionCommandSchema } from '../domain/roster';
import type { FinalizeRosterGateway } from './contracts';
import { defaultRosterGateway } from './roster-dependencies';

const inputSchema = rosterVersionCommandSchema.extend({
  confirmation: z.literal(FINALIZE_ROSTER_CONFIRMATION),
});

export async function finalizeRoster(
  input: unknown,
  actor: AuthorizationContext,
  dependencies: { gateway?: FinalizeRosterGateway } = {},
): Promise<AppResult<{ state: 'finalized'; version: number }, { code: string }>> {
  if (
    typeof input !== 'object' ||
    input === null ||
    !('confirmation' in input) ||
    input.confirmation !== FINALIZE_ROSTER_CONFIRMATION
  )
    return failure({ code: 'confirmation_required' });
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
    const result = await (dependencies.gateway ?? (await defaultRosterGateway())).finalize(data);
    return result.outcome === 'finalized'
      ? success({ state: 'finalized', version: result.version })
      : failure({ code: result.outcome });
  } catch {
    return failure({ code: 'unexpected' });
  }
}

export type { FinalizeRosterGateway } from './contracts';
