import { z } from 'zod';

import { failure, success, type AppResult } from '../../../lib/result';
import type { AuthorizationContext } from '../../organizations/application/capabilities';
import { requireCapability } from '../../organizations/application/require-capability';
import { rosterScopeSchema } from '../domain/roster';
import type { CreateRosterDraftGateway } from './contracts';
import { defaultRosterGateway } from './roster-dependencies';

const teamSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  targetSize: z.number().int().min(1).max(500).nullable().optional(),
  positionTargets: z.record(z.uuid(), z.number().int().min(0).max(500)).optional(),
});
const inputSchema = rosterScopeSchema.extend({ teams: z.array(teamSchema).min(1).max(50) });

export async function createRosterDraft(
  input: unknown,
  actor: AuthorizationContext,
  dependencies: { gateway?: CreateRosterDraftGateway } = {},
): Promise<AppResult<{ rosterVersionId: string; version: number }, { code: string }>> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return failure({ code: 'invalid_teams' });
  const data = parsed.data;
  if (new Set(data.teams.map((team) => team.name.toLocaleLowerCase())).size !== data.teams.length)
    return failure({ code: 'invalid_teams' });
  if (
    !requireCapability(actor, 'roster:write', {
      organizationId: data.organizationId as AuthorizationContext['organizationId'],
      tryoutId: data.tryoutId,
      divisionId: data.divisionId,
    }).ok
  )
    return failure({ code: 'forbidden' });
  try {
    const result = await (dependencies.gateway ?? (await defaultRosterGateway())).create(data);
    return result.outcome === 'created'
      ? success({ rosterVersionId: result.rosterVersionId, version: result.version })
      : failure({ code: result.outcome });
  } catch {
    return failure({ code: 'unexpected' });
  }
}

export type { CreateRosterDraftGateway } from './contracts';
