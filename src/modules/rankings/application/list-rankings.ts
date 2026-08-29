import { z } from 'zod';

import { failure, success, type AppResult } from '../../../lib/result';
import type { AuthorizationContext } from '../../organizations/application/capabilities';
import {
  summarizeAthleteScores,
  type CompletedEvaluationSnapshot,
} from '../../scoring/domain/athlete-aggregate';
import { canonicalizeScore, ScoreDecimal } from '../../scoring/domain/decimal';
import { exactNormalizedScore } from '../../scoring/domain/normalize-score';
import { rankAthletes } from '../../scoring/domain/rank-athletes';

export type RankingFilters = Readonly<{
  divisionId?: string;
  positionId?: string;
  sessionId?: string;
  groupId?: string;
  completion?: 'all' | 'complete' | 'incomplete' | 'unscored';
  minimumEvaluators?: number;
  search?: string;
}>;

export type RankingCategory = Readonly<{
  categoryId: string;
  name: string;
  scaleMax: 5 | 10;
  normalizedAverage: string;
}>;

export type RankingRow = Readonly<{
  athleteId: string;
  registrationId: string;
  displayName: string;
  tryoutNumber: number | null;
  divisionId: string;
  divisionName: string;
  positionId: string | null;
  positionName: string | null;
  rank: number | null;
  isTied: boolean;
  overall: string | null;
  priorityCategoryId: string | null;
  priorityCategoryOverall: string | null;
  completedEvaluators: number;
  expectedEvaluators: number;
  completionPercent: number;
  scoreRange: readonly [string, string] | null;
  categories: readonly RankingCategory[];
  sessions: readonly { id: string; name: string }[];
  groups: readonly { id: string; name: string }[];
  flags: readonly string[];
}>;

export type RankingEvaluation = Omit<CompletedEvaluationSnapshot, 'categories'> &
  Readonly<{
    groupId?: string | null;
    categories: readonly (CompletedEvaluationSnapshot['categories'][number] & {
      categoryName: string;
    })[];
  }>;

export type RankingRegistrationSnapshot = Readonly<{
  registrationId: string;
  athleteId: string;
  displayName: string;
  divisionId: string;
  divisionName: string;
  positionId: string | null;
  positionName: string | null;
  tryoutNumber: number | null;
  expectedEvaluators: number;
  evaluations: readonly RankingEvaluation[];
  categoryNames: readonly { id: string; name: string; scaleMax: 5 | 10 }[];
  sessions: readonly { id: string; name: string }[];
  groups: readonly { id: string; name: string }[];
  flags: readonly string[];
}>;

export type RankingSnapshot = Readonly<{
  registrations: readonly RankingRegistrationSnapshot[];
  generatedAt: string;
}>;

export type RankingGatewayResult =
  { outcome: 'ok'; snapshot: RankingSnapshot } | { outcome: 'forbidden' | 'invalid_scope' };

export type RankingGateway = {
  load(input: {
    organizationId: string;
    tryoutId: string;
    divisionId?: string;
    positionId?: string;
    sessionId?: string;
    groupId?: string;
    athleteIds?: readonly string[];
  }): Promise<RankingGatewayResult>;
};

export type RankingPage = Readonly<{
  rows: readonly RankingRow[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  generatedAt: string;
}>;

const inputSchema = z.strictObject({
  organizationId: z.uuid(),
  tryoutId: z.uuid(),
  divisionId: z.uuid().optional(),
  positionId: z.uuid().optional(),
  sessionId: z.uuid().optional(),
  groupId: z.uuid().optional(),
  completion: z.enum(['all', 'complete', 'incomplete', 'unscored']).default('all'),
  minimumEvaluators: z.number().int().min(0).max(1000).default(0),
  search: z.string().trim().max(120).default(''),
  page: z.number().int().min(1).max(10000).default(1),
  pageSize: z.number().int().min(1).max(100).default(25),
});

function assignmentCovers(
  actor: AuthorizationContext,
  input: z.infer<typeof inputSchema>,
): boolean {
  if (actor.organizationId !== input.organizationId || actor.membershipStatus !== 'active')
    return false;
  if (actor.organizationRole === 'owner' || actor.organizationRole === 'administrator') return true;
  return actor.assignments.some((assignment) => {
    if (!['director', 'reviewer'].includes(assignment.role)) return false;
    if (assignment.scope.tryoutId !== input.tryoutId) return false;
    switch (assignment.scope.kind) {
      case 'tryout':
        return true;
      case 'division':
        return input.divisionId === undefined || input.divisionId === assignment.scope.divisionId;
      case 'session':
        return input.sessionId === undefined || input.sessionId === assignment.scope.sessionId;
      case 'group':
        return (
          (input.sessionId === undefined || input.sessionId === assignment.scope.sessionId) &&
          (input.groupId === undefined || input.groupId === assignment.scope.groupId)
        );
      case 'athlete':
        return false;
    }
  });
}

export function displayScore(score: string | null): string | null {
  return score === null ? null : new ScoreDecimal(score).toFixed(1);
}

function categorySummaries(evaluations: readonly RankingEvaluation[]): RankingCategory[] {
  const included = evaluations.filter(
    (evaluation) =>
      evaluation.assignmentState === 'active' &&
      (evaluation.state === 'completed' || evaluation.state === 'locked'),
  );
  const categories = new Map<
    string,
    { name: string; scaleMax: 5 | 10; scores: InstanceType<typeof ScoreDecimal>[] }
  >();
  for (const evaluation of included) {
    for (const category of evaluation.categories) {
      if (category.score === null) continue;
      const current = categories.get(category.categoryId) ?? {
        name: category.categoryName,
        scaleMax: category.scaleMax,
        scores: [],
      };
      if (current.name !== category.categoryName || current.scaleMax !== category.scaleMax)
        throw new RangeError('category metadata changed across immutable snapshots');
      current.scores.push(
        exactNormalizedScore({ score: category.score, scaleMax: category.scaleMax }),
      );
      categories.set(category.categoryId, current);
    }
  }
  return [...categories.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([categoryId, category]) => ({
      categoryId,
      name: category.name,
      scaleMax: category.scaleMax,
      normalizedAverage: displayScore(
        canonicalizeScore(
          category.scores
            .reduce((sum, value) => sum.plus(value), new ScoreDecimal(0))
            .dividedBy(category.scores.length),
        ),
      )!,
    }));
}

export function buildRankingRows(snapshot: RankingSnapshot): RankingRow[] {
  const includedEvaluations = snapshot.registrations.flatMap((registration) =>
    registration.evaluations.filter(
      (evaluation) =>
        evaluation.assignmentState === 'active' &&
        (evaluation.state === 'completed' || evaluation.state === 'locked'),
    ),
  );
  const priorityIds = includedEvaluations.map((evaluation) =>
    evaluation.categories
      .filter((category) => category.isPriority)
      .map((category) => category.categoryId),
  );
  const commonPriorityId =
    priorityIds.length > 0 &&
    priorityIds.every((ids) => ids.length === 1 && ids[0] === priorityIds[0]?.[0])
      ? priorityIds[0]![0]!
      : null;
  const derived = snapshot.registrations.map((registration) => {
    const scoringEvaluations = registration.evaluations.map((evaluation) => ({
      ...evaluation,
      categories: evaluation.categories.map((category) => ({
        ...category,
        isPriority: commonPriorityId !== null && category.categoryId === commonPriorityId,
      })),
    }));
    const summary = summarizeAthleteScores(scoringEvaluations);
    const expected = registration.expectedEvaluators;
    const completed = summary.completedEvaluatorCount;
    return {
      registration,
      summary,
      completed,
      expected,
      completionPercent:
        expected === 0 ? 0 : Math.min(100, Math.round((completed / expected) * 100)),
    };
  });
  const ranks = new Map(
    rankAthletes(
      derived.map(({ registration, summary }) => ({
        athleteId: registration.athleteId,
        stableOrder: registration.registrationId,
        summary,
      })),
    ).map((row) => [row.athleteId, row]),
  );
  return derived
    .map(({ registration, summary, completed, expected, completionPercent }) => {
      const ranked = ranks.get(registration.athleteId)!;
      return {
        athleteId: registration.athleteId,
        registrationId: registration.registrationId,
        displayName: registration.displayName,
        tryoutNumber: registration.tryoutNumber,
        divisionId: registration.divisionId,
        divisionName: registration.divisionName,
        positionId: registration.positionId,
        positionName: registration.positionName,
        rank: ranked.rank,
        isTied: ranked.isTied,
        overall: displayScore(summary.aggregate),
        priorityCategoryId: summary.priorityCategoryId,
        priorityCategoryOverall: displayScore(summary.priorityCategoryAggregate),
        completedEvaluators: completed,
        expectedEvaluators: expected,
        completionPercent,
        scoreRange:
          summary.scoreRange === null
            ? null
            : ([
                displayScore(summary.scoreRange[0])!,
                displayScore(summary.scoreRange[1])!,
              ] as const),
        categories: categorySummaries(registration.evaluations),
        sessions: registration.sessions,
        groups: registration.groups,
        flags: registration.flags,
      };
    })
    .sort((left, right) => {
      if (left.rank === null || right.rank === null) {
        if (left.rank === null && right.rank === null)
          return left.registrationId.localeCompare(right.registrationId);
        return left.rank === null ? 1 : -1;
      }
      return left.rank - right.rank || left.registrationId.localeCompare(right.registrationId);
    });
}

export async function listRankings(
  input: unknown,
  actor: AuthorizationContext,
  gateway: RankingGateway,
): Promise<AppResult<RankingPage, { code: 'invalid_input' | 'forbidden' | 'unexpected' }>> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return failure({ code: 'invalid_input' });
  if (!assignmentCovers(actor, parsed.data)) return failure({ code: 'forbidden' });
  try {
    const loaded = await gateway.load(parsed.data);
    if (loaded.outcome !== 'ok') return failure({ code: 'forbidden' });
    const search = parsed.data.search.toLocaleLowerCase('en-US');
    const rows = buildRankingRows(loaded.snapshot).filter((row) => {
      const completion = parsed.data.completion;
      if (completion === 'complete' && row.completionPercent !== 100) return false;
      if (
        completion === 'incomplete' &&
        (row.completedEvaluators === 0 || row.completionPercent === 100)
      )
        return false;
      if (completion === 'unscored' && row.completedEvaluators !== 0) return false;
      if (row.completedEvaluators < parsed.data.minimumEvaluators) return false;
      return (
        search === '' ||
        row.displayName.toLocaleLowerCase('en-US').includes(search) ||
        String(row.tryoutNumber ?? '').includes(search)
      );
    });
    const total = rows.length;
    const start = (parsed.data.page - 1) * parsed.data.pageSize;
    return success({
      rows: rows.slice(start, start + parsed.data.pageSize),
      page: parsed.data.page,
      pageSize: parsed.data.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / parsed.data.pageSize)),
      generatedAt: loaded.snapshot.generatedAt,
    });
  } catch {
    return failure({ code: 'unexpected' });
  }
}
