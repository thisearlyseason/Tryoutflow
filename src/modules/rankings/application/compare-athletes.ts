import { z } from 'zod';

import { failure, success, type AppResult } from '../../../lib/result';
import type { AuthorizationContext } from '../../organizations/application/capabilities';
import { buildRankingRows, type RankingCategory, type RankingGateway } from './list-rankings';

export type AthleteComparison = Readonly<{
  athletes: readonly {
    athleteId: string;
    displayName: string;
    tryoutNumber: number | null;
    divisionName: string;
    positionName: string | null;
    overall: string | null;
    completedEvaluators: number;
    expectedEvaluators: number;
    completionPercent: number;
    scoreRange: readonly [string, string] | null;
    categories: readonly RankingCategory[];
    flags: readonly string[];
    sessions: readonly {
      sessionId: string;
      sessionName: string;
      overall: string | null;
      completedEvaluators: number;
      expectedEvaluators: number;
      completionPercent: number;
      scoreRange: readonly [string, string] | null;
      categories: readonly RankingCategory[];
    }[];
  }[];
  generatedAt: string;
}>;

const schema = z.strictObject({
  organizationId: z.uuid(),
  tryoutId: z.uuid(),
  athleteIds: z
    .array(z.uuid())
    .min(2)
    .max(4)
    .refine((ids) => new Set(ids).size === ids.length),
});

export async function compareAthletes(
  input: unknown,
  actor: AuthorizationContext,
  gateway: RankingGateway,
): Promise<
  AppResult<AthleteComparison, { code: 'invalid_input' | 'forbidden' | 'not_found' | 'unexpected' }>
> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return failure({ code: 'invalid_input' });
  if (
    actor.organizationId !== parsed.data.organizationId ||
    actor.membershipStatus !== 'active' ||
    !(
      ['owner', 'administrator'].includes(actor.organizationRole) ||
      actor.assignments.some(
        (assignment) =>
          ['director', 'reviewer'].includes(assignment.role) &&
          assignment.scope.tryoutId === parsed.data.tryoutId,
      )
    )
  )
    return failure({ code: 'forbidden' });
  try {
    const loaded = await gateway.load({
      organizationId: parsed.data.organizationId,
      tryoutId: parsed.data.tryoutId,
      athleteIds: parsed.data.athleteIds,
    });
    if (loaded.outcome !== 'ok') return failure({ code: 'forbidden' });
    const byId = new Map(buildRankingRows(loaded.snapshot).map((row) => [row.athleteId, row]));
    const rows = parsed.data.athleteIds.map((id) => byId.get(id));
    if (rows.some((row) => row === undefined)) return failure({ code: 'not_found' });
    return success({
      athletes: rows.map((row) => {
        const registration = loaded.snapshot.registrations.find(
          (candidate) => candidate.athleteId === row!.athleteId,
        )!;
        return {
          athleteId: row!.athleteId,
          displayName: row!.displayName,
          tryoutNumber: row!.tryoutNumber,
          divisionName: row!.divisionName,
          positionName: row!.positionName,
          overall: row!.overall,
          completedEvaluators: row!.completedEvaluators,
          expectedEvaluators: row!.expectedEvaluators,
          completionPercent: row!.completionPercent,
          scoreRange: row!.scoreRange,
          categories: row!.categories,
          flags: row!.flags,
          sessions: registration.sessions.map((session) => {
            const sessionRegistration = {
              ...registration,
              expectedEvaluators: session.expectedEvaluators,
              sessions: [session],
              evaluations: registration.evaluations.filter(
                (evaluation) => evaluation.sessionId === session.id,
              ),
            };
            const summary = buildRankingRows({
              ...loaded.snapshot,
              registrations: [sessionRegistration],
            })[0]!;
            return {
              sessionId: session.id,
              sessionName: session.name,
              overall: summary.overall,
              completedEvaluators: summary.completedEvaluators,
              expectedEvaluators: summary.expectedEvaluators,
              completionPercent: summary.completionPercent,
              scoreRange: summary.scoreRange,
              categories: summary.categories,
            };
          }),
        };
      }),
      generatedAt: loaded.snapshot.generatedAt,
    });
  } catch {
    return failure({ code: 'unexpected' });
  }
}
