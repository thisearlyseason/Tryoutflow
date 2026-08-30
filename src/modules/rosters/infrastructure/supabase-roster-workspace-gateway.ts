import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

import type { Database } from '../../../infrastructure/supabase/database.types';
import type {
  RosterWorkspaceGateway,
  RosterWorkspaceResult,
} from '../application/roster-workspace';

const id = z.uuid();
const safeVersion = z.number().int().safe().positive();
const namedId = z.strictObject({ id, name: z.string().trim().min(1).max(120) });
const team = z.strictObject({
  id,
  name: z.string().trim().min(1).max(120),
  targetSize: z.number().int().min(1).max(500).nullable(),
  positionTargets: z.record(id, z.number().int().min(0).max(500)),
});
const member = z.strictObject({
  registrationId: id,
  displayName: z.string().trim().min(1).max(241),
  tryoutNumber: z.number().int().min(1).max(9999).nullable(),
  positionId: id.nullable(),
  positionName: z.string().trim().min(1).max(120).nullable(),
  decision: z.enum(['undecided', 'callback', 'selected', 'waitlisted', 'released', 'withdrawn']),
  teamId: id.nullable(),
});
const snapshot = z
  .strictObject({
    rosterVersionId: id,
    state: z.enum(['draft', 'finalized']),
    version: safeVersion,
    revisionNumber: z.number().int().min(1).max(1_000_000_000),
    basedOnRosterVersionId: id.nullable(),
    revisionReason: z.string().trim().min(10).max(500).nullable(),
    finalizedAt: z.iso.datetime({ offset: true }).nullable(),
    teams: z.array(team).min(1).max(50),
    positions: z.array(namedId).max(100),
    members: z.array(member).max(10_000),
  })
  .superRefine((value, context) => {
    const teamIds = new Set(value.teams.map((candidate) => candidate.id));
    const positionIds = new Set(value.positions.map((candidate) => candidate.id));
    for (const candidate of value.members) {
      if (candidate.teamId !== null && !teamIds.has(candidate.teamId)) {
        context.addIssue({ code: 'custom', message: 'member team is outside the roster scope' });
      }
      if (candidate.positionId !== null && !positionIds.has(candidate.positionId)) {
        context.addIssue({
          code: 'custom',
          message: 'member position is outside the tryout scope',
        });
      }
      if ((candidate.positionId === null) !== (candidate.positionName === null)) {
        context.addIssue({ code: 'custom', message: 'member position identity is incomplete' });
      }
    }
  });
const response = z.strictObject({
  outcome: z.enum(['ok', 'forbidden', 'invalid_scope']),
  snapshot: snapshot.optional(),
});

export function parseRosterWorkspaceResponse(input: unknown): RosterWorkspaceResult {
  const parsed = response.safeParse(input);
  if (!parsed.success) throw new Error('Invalid roster workspace projection');
  if (parsed.data.outcome === 'ok') {
    if (!parsed.data.snapshot) throw new Error('Invalid roster workspace projection');
    return { outcome: 'ok', snapshot: parsed.data.snapshot };
  }
  if (parsed.data.snapshot !== undefined) throw new Error('Invalid roster workspace projection');
  return { outcome: parsed.data.outcome };
}

export class SupabaseRosterWorkspaceGateway implements RosterWorkspaceGateway {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async load(input: Parameters<RosterWorkspaceGateway['load']>[0]) {
    const { data, error } = await this.client.rpc('load_roster_workspace', {
      p_organization_id: input.organizationId,
      p_tryout_id: input.tryoutId,
      p_division_id: input.divisionId,
      p_roster_version_id: input.rosterVersionId,
    });
    if (error) throw error;
    if (!Array.isArray(data) || data.length !== 1) {
      throw new Error('Invalid roster workspace projection');
    }
    return parseRosterWorkspaceResponse(data[0]?.result);
  }
}
