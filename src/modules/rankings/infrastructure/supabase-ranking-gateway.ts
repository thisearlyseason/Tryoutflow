import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

import type { Database } from '../../../infrastructure/supabase/database.types';
import type {
  RankingGateway,
  RankingGatewayResult,
  RankingSnapshot,
} from '../application/list-rankings';

const id = z.uuid();
const namedId = z.strictObject({ id, name: z.string().trim().min(1).max(120) });
const sessionOption = namedId.extend({ expectedEvaluators: z.number().int().min(0).max(1000) });
const category = z.strictObject({
  categoryId: id,
  categoryName: z.string().trim().min(1).max(120),
  score: z.number().int().min(1).max(10).nullable(),
  scaleMax: z.union([z.literal(5), z.literal(10)]),
  weight: z.string().regex(/^(?:0|[1-9]\d{0,2})(?:\.\d{1,2})?$/),
  isPriority: z.boolean(),
});
const evaluation = z.strictObject({
  evaluationId: id,
  evaluatorId: id,
  divisionId: id,
  sessionId: id,
  groupId: id.nullable().optional(),
  state: z.enum(['draft', 'completed', 'locked', 'reopened']),
  assignmentState: z.enum(['active', 'removed', 'revoked', 'invalidated']),
  categories: z.array(category).max(100),
});
const registration = z.strictObject({
  registrationId: id,
  athleteId: id,
  displayName: z.string().trim().min(1).max(241),
  divisionId: id,
  divisionName: z.string().trim().min(1).max(120),
  positionId: id.nullable(),
  positionName: z.string().trim().min(1).max(120).nullable(),
  tryoutNumber: z.number().int().min(1).max(9999).nullable(),
  expectedEvaluators: z.number().int().min(0).max(1000),
  evaluations: z.array(evaluation).max(1000),
  categoryNames: z
    .array(
      z.strictObject({
        id,
        name: z.string().trim().min(1).max(120),
        scaleMax: z.union([z.literal(5), z.literal(10)]),
      }),
    )
    .max(100),
  sessions: z.array(sessionOption).max(100),
  groups: z.array(namedId).max(500),
  flags: z.array(z.enum(['needs_another_look', 'injury_concern', 'eligibility_review'])).max(3),
});
const snapshotSchema = z.strictObject({
  filterOptions: z.strictObject({
    divisions: z.array(namedId).max(100),
    positions: z.array(namedId).max(100),
    sessions: z.array(namedId).max(100),
    groups: z.array(namedId).max(500),
  }),
  registrations: z.array(registration).max(10_000),
  generatedAt: z.iso.datetime({ offset: true }),
});
const responseSchema = z.strictObject({
  outcome: z.enum(['ok', 'forbidden', 'invalid_scope']),
  snapshot: snapshotSchema.optional(),
});

export function parseRankingSnapshot(input: unknown): RankingGatewayResult {
  const parsed = responseSchema.safeParse(input);
  if (!parsed.success) throw new Error('Invalid ranking projection');
  if (parsed.data.outcome === 'ok') {
    if (!parsed.data.snapshot) throw new Error('Invalid ranking projection');
    return { outcome: 'ok', snapshot: parsed.data.snapshot as RankingSnapshot };
  }
  if (parsed.data.snapshot !== undefined) throw new Error('Invalid ranking projection');
  return { outcome: parsed.data.outcome };
}

export class SupabaseRankingGateway implements RankingGateway {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async load(input: Parameters<RankingGateway['load']>[0]): Promise<RankingGatewayResult> {
    const { data, error } = await this.client.rpc('load_ranking_snapshot', {
      p_organization_id: input.organizationId,
      p_tryout_id: input.tryoutId,
      p_division_id: input.divisionId,
      p_position_id: input.positionId,
      p_session_id: input.sessionId,
      p_group_id: input.groupId,
      p_athlete_ids: input.athleteIds ? [...input.athleteIds] : undefined,
    });
    if (error) throw error;
    if (!Array.isArray(data) || data.length !== 1) throw new Error('Invalid ranking projection');
    return parseRankingSnapshot(data[0]?.result);
  }
}
