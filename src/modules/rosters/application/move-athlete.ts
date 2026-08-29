import { z } from 'zod';

import { failure, success, type AppResult } from '../../../lib/result';
import type { AuthorizationContext } from '../../organizations/application/capabilities';
import { requireCapability } from '../../organizations/application/require-capability';
import { rosterVersionCommandSchema } from '../domain/roster';
import type { MoveAthleteGateway } from './contracts';
import { defaultRosterGateway } from './roster-dependencies';

const inputSchema = rosterVersionCommandSchema.extend({
  registrationId: z.uuid(),
  teamId: z.uuid().nullable(),
});

export async function moveAthlete(
  input: unknown,
  actor: AuthorizationContext,
  dependencies: { gateway?: MoveAthleteGateway } = {},
): Promise<AppResult<{ version: number; changed: boolean }, { code: string }>> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return failure({ code: 'invalid_move' });
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
    const result = await (dependencies.gateway ?? (await defaultRosterGateway())).move(data);
    if (result.outcome === 'moved') return success({ version: result.version, changed: true });
    if (result.outcome === 'unchanged' && result.version)
      return success({ version: result.version, changed: false });
    return failure({ code: result.outcome });
  } catch {
    return failure({ code: 'unexpected' });
  }
}

export type { MoveAthleteGateway } from './contracts';
