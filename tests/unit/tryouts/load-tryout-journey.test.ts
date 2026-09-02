import { describe, expect, it } from 'vitest';

import type { OrganizationId, UserId } from '../../../src/lib/ids';
import type { AuthorizationContext } from '../../../src/modules/organizations/application/capabilities';
import { loadTryoutJourney } from '../../../src/modules/tryouts/application/load-tryout-journey';

const organizationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' as OrganizationId;
const userId = '11111111-1111-4111-8111-111111111111' as UserId;
const tryoutId = '22222222-2222-4222-8222-222222222222';
const divisionAId = '77777777-7777-4777-8777-777777777771';
const divisionBId = '77777777-7777-4777-8777-777777777772';
const finalizedRosterAId = '44444444-4444-4444-8444-444444444441';
const finalizedRosterBId = '44444444-4444-4444-8444-444444444442';

type QueryResponse = { data: unknown; error: unknown; count?: number | null };
type Fixture = {
  status: 'draft' | 'published' | 'finalized';
  completedSteps?: string[];
  participantCount?: number;
  sessionCount?: number;
  checkinCount?: number;
  completedEvaluationCount?: number;
  expectedEvaluationCount?: unknown;
  activeEvaluatorCount?: number;
  evaluatorAssignmentExists?: boolean;
  draftRoster?: boolean;
  finalizedRoster?: boolean;
  communicationStates?: string[];
  divisionIds?: string[];
  rosterVersions?: Array<{
    id: string;
    division_id: string;
    state: 'draft' | 'finalized';
    revision_number: number;
  }>;
  communicationMessages?: Array<{ source_roster_version_id: string; state: string }>;
};

type QueryLog = {
  table: string;
  columns: string;
  options?: { count?: string; head?: boolean };
  filters: Array<[string, string, unknown]>;
  orders: Array<{ column: string; ascending?: boolean }>;
  limit?: number;
};

function authorization(overrides: Partial<AuthorizationContext> = {}): AuthorizationContext {
  return {
    userId,
    organizationId,
    organizationRole: 'owner',
    membershipStatus: 'active',
    assignments: [],
    ...overrides,
  };
}

function fakeClient(fixture: Fixture, failures: Partial<Record<string, Error>> = {}) {
  const logs: QueryLog[] = [];
  const rpcLogs: Array<{ name: string; args: Record<string, unknown>; limit?: number }> = [];
  const calls = new Map<string, number>();
  const responseFor = (table: string, log: QueryLog): QueryResponse => {
    const occurrence = calls.get(table) ?? 0;
    calls.set(table, occurrence + 1);
    const failureKey = `${table}:${occurrence}`;
    const failure = failures[failureKey] ?? failures[table];
    if (failure) return { data: null, error: failure, count: null };
    switch (table) {
      case 'tryouts':
        return {
          data: [
            {
              id: tryoutId,
              name: 'Fall Evaluations',
              slug: 'fall-evaluations',
              status: fixture.status,
            },
          ],
          error: null,
        };
      case 'tryout_setup_progress':
        return {
          data: [
            {
              completed_steps: fixture.completedSteps ?? ['basics'],
              last_step: 'basics',
            },
          ],
          error: null,
        };
      case 'tryout_registrations':
        return { data: null, error: null, count: fixture.participantCount ?? 0 };
      case 'tryout_sessions':
        return { data: null, error: null, count: fixture.sessionCount ?? 0 };
      case 'tryout_divisions': {
        const rows = (fixture.divisionIds ?? [divisionAId]).map((id) => ({ id }));
        return { data: rows, error: null, count: rows.length };
      }
      case 'checkins':
        return { data: null, error: null, count: fixture.checkinCount ?? 0 };
      case 'evaluations':
        return {
          data: null,
          error: null,
          count: fixture.completedEvaluationCount ?? 0,
        };
      case 'roster_versions': {
        const rosterVersions = fixture.rosterVersions ?? [
          ...(fixture.draftRoster
            ? [
                {
                  id: '33333333-3333-4333-8333-333333333333',
                  division_id: divisionAId,
                  state: 'draft' as const,
                  revision_number: 1,
                },
              ]
            : []),
          ...(fixture.finalizedRoster
            ? [
                {
                  id: finalizedRosterAId,
                  division_id: divisionAId,
                  state: 'finalized' as const,
                  revision_number: 1,
                },
              ]
            : []),
        ];
        const state = log.filters.find(
          (filter) => filter[0] === 'eq' && filter[1] === 'state',
        )?.[2];
        const rows = rosterVersions.filter((row) => state === undefined || row.state === state);
        return {
          data: log.limit === undefined ? rows : rows.slice(0, log.limit),
          error: null,
          count: rows.length,
        };
      }
      case 'communication_messages': {
        const messages =
          fixture.communicationMessages ??
          (fixture.communicationStates ?? []).map((state) => ({
            source_roster_version_id: finalizedRosterAId,
            state,
          }));
        const sourceFilter = log.filters.find((filter) => filter[1] === 'source_roster_version_id');
        const rows = sourceFilter
          ? messages.filter((message) =>
              sourceFilter[0] === 'in'
                ? (sourceFilter[2] as string[]).includes(message.source_roster_version_id)
                : message.source_roster_version_id === sourceFilter[2],
            )
          : messages;
        return {
          data: rows,
          error: null,
          count: rows.length,
        };
      }
      default:
        throw new Error(`Unexpected journey table: ${table}`);
    }
  };
  const client = {
    rpc(name: string, args: Record<string, unknown>) {
      const occurrence = calls.get(name) ?? 0;
      calls.set(name, occurrence + 1);
      const log = { name, args } as { name: string; args: Record<string, unknown>; limit?: number };
      rpcLogs.push(log);
      const failure = failures[`${name}:${occurrence}`] ?? failures[name];
      const response = failure
        ? { data: null, error: failure }
        : name === 'load_live_dashboard'
          ? {
              data: [
                {
                  result: {
                    outcome: 'ok',
                    dashboard: {
                      registrations: fixture.participantCount ?? 0,
                      checkedIn: fixture.checkinCount ?? 0,
                      activeEvaluators:
                        fixture.activeEvaluatorCount ??
                        (fixture.evaluatorAssignmentExists === false ? 0 : 1),
                      completedEvaluations: fixture.completedEvaluationCount ?? 0,
                      expectedEvaluations:
                        fixture.expectedEvaluationCount ?? fixture.completedEvaluationCount ?? 0,
                      recordedSyncExceptions: 0,
                      generatedAt: '2026-09-01T12:00:00.000Z',
                    },
                  },
                },
              ],
              error: null,
            }
          : name === 'list_manageable_evaluator_assignments'
            ? {
                data:
                  fixture.evaluatorAssignmentExists === false
                    ? []
                    : [
                        {
                          assignment_id: '55555555-5555-4555-8555-555555555555',
                          evaluator_user_id: '66666666-6666-4666-8666-666666666666',
                          evaluator_name: 'Alex Morgan',
                          scope_kind: 'tryout',
                          division_id: null,
                          session_id: null,
                          group_id: null,
                          scope_label: 'Fall Evaluations — all divisions',
                          expires_at: null,
                        },
                      ],
                error: null,
              }
            : (() => {
                throw new Error(`Unexpected journey RPC: ${name}`);
              })();
      const builder = {
        limit(value: number) {
          log.limit = value;
          return builder;
        },
        then<TResult1 = QueryResponse, TResult2 = never>(
          onfulfilled?: ((value: QueryResponse) => TResult1 | PromiseLike<TResult1>) | null,
          onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
        ) {
          return Promise.resolve(response).then(onfulfilled, onrejected);
        },
      };
      return builder;
    },
    from(table: string) {
      return {
        select(columns: string, options?: { count?: string; head?: boolean }) {
          const log: QueryLog = { table, columns, options, filters: [], orders: [] };
          logs.push(log);
          const builder = {
            eq(column: string, value: unknown) {
              log.filters.push(['eq', column, value]);
              return builder;
            },
            is(column: string, value: unknown) {
              log.filters.push(['is', column, value]);
              return builder;
            },
            in(column: string, value: unknown[]) {
              log.filters.push(['in', column, value]);
              return builder;
            },
            order(column: string, options?: { ascending?: boolean }) {
              log.orders.push({ column, ascending: options?.ascending });
              return builder;
            },
            limit(value: number) {
              log.limit = value;
              return builder;
            },
            then<TResult1 = QueryResponse, TResult2 = never>(
              onfulfilled?: ((value: QueryResponse) => TResult1 | PromiseLike<TResult1>) | null,
              onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
            ) {
              return Promise.resolve(responseFor(table, log)).then(onfulfilled, onrejected);
            },
          };
          return builder;
        },
      };
    },
  };
  return { client, logs, rpcLogs };
}

async function loadFixtureJourney(fixture: Fixture) {
  const { client } = fakeClient(fixture);
  return loadTryoutJourney(client as never, {
    organizationId,
    tryoutId,
    authorization: authorization(),
    organizationSlug: 'badlands',
  });
}

describe('authoritative tryout journey projection', () => {
  it.each([
    [{ status: 'draft' }, 'prepare', 'Continue setup'],
    [{ status: 'published' }, 'participants', 'Add first participant'],
    [{ status: 'published', participantCount: 3, sessionCount: 1 }, 'run', 'Open check-in'],
    [
      {
        status: 'published',
        participantCount: 3,
        sessionCount: 1,
        completedEvaluationCount: 2,
      },
      'decide',
      'Review rankings',
    ],
    [
      {
        status: 'published',
        participantCount: 3,
        sessionCount: 1,
        completedEvaluationCount: 2,
        finalizedRoster: true,
      },
      'complete',
      'Review communication',
    ],
  ] as const)('recommends the exact next action for %o', async (fixture, stage, label) => {
    await expect(loadFixtureJourney(fixture)).resolves.toMatchObject({
      nextStage: stage,
      primaryAction: { label },
    });
  });

  it('isolates a failed run dependency without changing known stages or fabricating counts', async () => {
    const { client } = fakeClient(
      { status: 'published', participantCount: 4, completedEvaluationCount: 0 },
      { tryout_sessions: new Error('session storage unavailable') },
    );

    const journey = await loadTryoutJourney(client as never, {
      organizationId,
      tryoutId,
      authorization: authorization(),
      organizationSlug: 'badlands',
    });

    expect(journey.stages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'prepare', status: 'complete' }),
        expect.objectContaining({
          id: 'participants',
          status: 'ready',
          supportingText: '4 participants registered',
        }),
        expect.objectContaining({
          id: 'run',
          status: 'unavailable',
          supportingText: 'Operational counts unavailable',
        }),
        expect.objectContaining({ id: 'decide', status: 'not-started' }),
      ]),
    );
    expect(journey.stages.find((stage) => stage.id === 'run')?.supportingText).not.toContain('0');
  });

  it('uses a neutral participant action when the count is unavailable', async () => {
    const { client } = fakeClient(
      { status: 'published', sessionCount: 1 },
      { 'tryout_registrations:0': new Error('participant storage unavailable') },
    );

    const journey = await loadTryoutJourney(client as never, {
      organizationId,
      tryoutId,
      authorization: authorization(),
      organizationSlug: 'badlands',
    });

    expect(journey.stages.find((stage) => stage.id === 'participants')).toMatchObject({
      status: 'unavailable',
      primaryAction: {
        label: 'Manage participants',
        href: `/app/badlands/tryouts/${tryoutId}/registration`,
      },
    });
    expect(journey).toMatchObject({
      nextStage: 'participants',
      primaryAction: { label: 'Manage participants' },
    });
  });

  it('preserves a known finalized roster when only communication status is unavailable', async () => {
    const { client } = fakeClient(
      {
        status: 'published',
        participantCount: 4,
        sessionCount: 1,
        completedEvaluationCount: 2,
        finalizedRoster: true,
      },
      { communication_messages: new Error('communication storage unavailable') },
    );

    const journey = await loadTryoutJourney(client as never, {
      organizationId,
      tryoutId,
      authorization: authorization(),
      organizationSlug: 'badlands',
    });
    const complete = journey.stages.find((stage) => stage.id === 'complete');

    expect(complete).toMatchObject({
      status: 'unavailable',
      supportingText: 'Finalized roster ready · Communication status unavailable',
      primaryAction: {
        label: 'Review communication',
        href: `/app/badlands/tryouts/${tryoutId}/messages`,
      },
    });
    expect(complete?.supportingText).not.toMatch(/0 decision messages/iu);
  });

  it('projects mixed durable communication states without declaring completion', async () => {
    const journey = await loadFixtureJourney({
      status: 'published',
      participantCount: 4,
      sessionCount: 1,
      completedEvaluationCount: 2,
      finalizedRoster: true,
      communicationStates: ['queued', 'submitted', 'delivered', 'failed', 'bounced'],
    });
    const complete = journey.stages.find((stage) => stage.id === 'complete');

    expect(complete).toMatchObject({
      status: 'in-progress',
      supportingText:
        'Finalized roster ready · 1 queued · 1 submitted · 1 delivered · 1 failed · 1 bounced',
      primaryAction: {
        label: 'Review communication',
        href: `/app/badlands/tryouts/${tryoutId}/messages`,
      },
    });
    expect(journey).toMatchObject({
      nextStage: 'complete',
      primaryAction: { label: 'Review communication' },
    });
  });

  it.each([
    [['failed'], '1 failed'],
    [['bounced', 'bounced'], '2 bounced'],
    [['failed', 'bounced'], '1 failed · 1 bounced'],
  ] as const)(
    'keeps terminal unsuccessful communication %o actionable',
    async (communicationStates, supportingText) => {
      const journey = await loadFixtureJourney({
        status: 'published',
        participantCount: 4,
        sessionCount: 1,
        completedEvaluationCount: 2,
        finalizedRoster: true,
        communicationStates: [...communicationStates],
      });
      const complete = journey.stages.find((stage) => stage.id === 'complete');

      expect(complete).toMatchObject({
        status: 'in-progress',
        supportingText: `Finalized roster ready · ${supportingText}`,
        primaryAction: { label: 'Review communication' },
      });
      expect(complete?.status).not.toBe('complete');
    },
  );

  it('marks communication complete only when every durable message is delivered', async () => {
    const journey = await loadFixtureJourney({
      status: 'published',
      participantCount: 4,
      sessionCount: 1,
      completedEvaluationCount: 2,
      finalizedRoster: true,
      communicationStates: ['delivered', 'delivered'],
    });

    expect(journey.stages.find((stage) => stage.id === 'complete')).toMatchObject({
      status: 'complete',
      supportingText: 'Finalized roster ready · 2 delivered',
      primaryAction: {
        label: 'Review reports',
        href: `/app/badlands/tryouts/${tryoutId}/reports`,
      },
    });
  });

  it('fails the communication stage closed for an unknown durable state', async () => {
    const journey = await loadFixtureJourney({
      status: 'published',
      participantCount: 4,
      sessionCount: 1,
      completedEvaluationCount: 2,
      finalizedRoster: true,
      communicationStates: ['invented-state'],
    });

    expect(journey.stages.find((stage) => stage.id === 'complete')).toMatchObject({
      status: 'unavailable',
      supportingText: 'Finalized roster ready · Communication status unavailable',
      primaryAction: { label: 'Review communication' },
    });
  });

  it('omits audit actions when the exact scope lacks audit read capability', async () => {
    const { client } = fakeClient({ status: 'published' });
    const journey = await loadTryoutJourney(client as never, {
      organizationId,
      tryoutId,
      organizationSlug: 'badlands',
      authorization: authorization({
        organizationRole: 'member',
        assignments: [
          {
            role: 'director',
            scope: { kind: 'tryout', tryoutId },
          },
        ],
      }),
    });

    expect(
      journey.stages
        .find((stage) => stage.id === 'complete')
        ?.secondaryActions.map((action) => action.label),
    ).not.toContain('Review audit history');
  });

  it('blocks run readiness on the exact missing evaluator prerequisite', async () => {
    const journey = await loadFixtureJourney({
      status: 'published',
      participantCount: 4,
      sessionCount: 1,
      evaluatorAssignmentExists: false,
    });

    expect(journey.stages.find((stage) => stage.id === 'run')).toMatchObject({
      status: 'in-progress',
      supportingText: expect.stringContaining('No evaluator assigned'),
      primaryAction: {
        label: 'Review staff',
        href: `/app/badlands/tryouts/${tryoutId}/staff`,
      },
      blocker: 'Assign at least one evaluator before running sessions.',
    });
  });

  it('does not confuse pre-enrollment dashboard coverage with missing staffing', async () => {
    const journey = await loadFixtureJourney({
      status: 'published',
      participantCount: 4,
      sessionCount: 1,
      activeEvaluatorCount: 0,
      evaluatorAssignmentExists: true,
    });

    expect(journey.stages.find((stage) => stage.id === 'run')).toMatchObject({
      status: 'ready',
      primaryAction: { label: 'Open check-in' },
    });
  });

  it('keeps partial evaluation coverage actionable with truthful expected counts', async () => {
    const journey = await loadFixtureJourney({
      status: 'published',
      participantCount: 4,
      sessionCount: 1,
      completedEvaluationCount: 1,
      expectedEvaluationCount: 2,
      evaluatorAssignmentExists: true,
    });

    expect(journey.stages.find((stage) => stage.id === 'run')).toMatchObject({
      status: 'in-progress',
      supportingText: expect.stringContaining('1 of 2 evaluations complete'),
      primaryAction: {
        label: 'Open live dashboard',
        href: `/app/badlands/tryouts/${tryoutId}/live`,
      },
    });
    expect(journey).toMatchObject({
      nextStage: 'run',
      primaryAction: { label: 'Open live dashboard' },
    });
  });

  it.each([
    ['missing', [], 'ready'],
    [
      'queued',
      [
        { source_roster_version_id: finalizedRosterAId, state: 'queued' },
        { source_roster_version_id: finalizedRosterBId, state: 'queued' },
      ],
      'in-progress',
    ],
    [
      'delivered',
      [
        { source_roster_version_id: finalizedRosterAId, state: 'delivered' },
        { source_roster_version_id: finalizedRosterBId, state: 'delivered' },
      ],
      'complete',
    ],
  ] as const)(
    'keeps a partial Run ahead of %s multi-division communication evidence',
    async (_evidence, communicationMessages, completeStatus) => {
      const journey = await loadFixtureJourney({
        status: 'published',
        participantCount: 4,
        sessionCount: 1,
        completedEvaluationCount: 1,
        expectedEvaluationCount: 2,
        evaluatorAssignmentExists: true,
        divisionIds: [divisionAId, divisionBId],
        rosterVersions: [
          {
            id: finalizedRosterAId,
            division_id: divisionAId,
            state: 'finalized',
            revision_number: 2,
          },
          {
            id: finalizedRosterBId,
            division_id: divisionBId,
            state: 'finalized',
            revision_number: 4,
          },
        ],
        communicationMessages: [...communicationMessages],
      });

      expect(journey.stages.find((stage) => stage.id === 'run')).toMatchObject({
        status: 'in-progress',
        supportingText: expect.stringContaining('1 of 2 evaluations complete'),
      });
      expect(journey.stages.find((stage) => stage.id === 'decide')).toMatchObject({
        status: 'complete',
        supportingText: expect.stringContaining('2 of 2 divisions finalized'),
      });
      expect(journey.stages.find((stage) => stage.id === 'complete')).toMatchObject({
        status: completeStatus,
      });
      expect(journey).toMatchObject({
        nextStage: 'run',
        primaryAction: {
          label: 'Open live dashboard',
          href: `/app/badlands/tryouts/${tryoutId}/live`,
        },
      });
    },
  );

  it('fails the run stage closed when expected evaluation coverage is malformed', async () => {
    const journey = await loadFixtureJourney({
      status: 'published',
      participantCount: 4,
      sessionCount: 1,
      completedEvaluationCount: 1,
      expectedEvaluationCount: '2',
      evaluatorAssignmentExists: true,
    });

    expect(journey.stages.find((stage) => stage.id === 'run')).toMatchObject({
      status: 'unavailable',
      supportingText: 'Operational counts unavailable',
    });
  });

  it('requires the latest roster for every configured division before decisions complete', async () => {
    const journey = await loadFixtureJourney({
      status: 'published',
      participantCount: 4,
      sessionCount: 1,
      completedEvaluationCount: 2,
      divisionIds: [divisionAId, divisionBId],
      rosterVersions: [
        {
          id: finalizedRosterAId,
          division_id: divisionAId,
          state: 'finalized',
          revision_number: 2,
        },
        {
          id: finalizedRosterBId,
          division_id: divisionBId,
          state: 'finalized',
          revision_number: 2,
        },
        {
          id: '33333333-3333-4333-8333-333333333332',
          division_id: divisionBId,
          state: 'draft',
          revision_number: 3,
        },
      ],
    });

    expect(journey.stages.find((stage) => stage.id === 'decide')).toMatchObject({
      status: 'in-progress',
      supportingText: expect.stringContaining('1 of 2 divisions finalized'),
      primaryAction: { label: 'Continue roster' },
    });
    expect(journey.stages.find((stage) => stage.id === 'complete')).toMatchObject({
      status: 'in-progress',
      supportingText: expect.stringContaining('1 of 2 divisions finalized'),
      primaryAction: { label: 'Build rosters' },
    });
  });

  it('keeps mixed multi-division communication evidence actionable', async () => {
    const journey = await loadFixtureJourney({
      status: 'published',
      participantCount: 4,
      sessionCount: 1,
      completedEvaluationCount: 2,
      divisionIds: [divisionAId, divisionBId],
      rosterVersions: [
        {
          id: finalizedRosterAId,
          division_id: divisionAId,
          state: 'finalized',
          revision_number: 2,
        },
        {
          id: finalizedRosterBId,
          division_id: divisionBId,
          state: 'finalized',
          revision_number: 4,
        },
      ],
      communicationMessages: [
        { source_roster_version_id: finalizedRosterAId, state: 'delivered' },
        { source_roster_version_id: finalizedRosterBId, state: 'queued' },
      ],
    });
    const complete = journey.stages.find((stage) => stage.id === 'complete');

    expect(complete).toMatchObject({
      status: 'in-progress',
      supportingText: expect.stringContaining('2 finalized rosters ready'),
      primaryAction: { label: 'Review communication' },
    });
    expect(complete?.supportingText).toContain('1 queued');
    expect(complete?.supportingText).toContain('1 delivered');
  });

  it('completes multi-division communication only with delivered evidence for every roster', async () => {
    const baseFixture: Fixture = {
      status: 'published',
      participantCount: 4,
      sessionCount: 1,
      completedEvaluationCount: 2,
      divisionIds: [divisionAId, divisionBId],
      rosterVersions: [
        {
          id: finalizedRosterAId,
          division_id: divisionAId,
          state: 'finalized',
          revision_number: 2,
        },
        {
          id: finalizedRosterBId,
          division_id: divisionBId,
          state: 'finalized',
          revision_number: 4,
        },
      ],
    };
    const missingEvidence = await loadFixtureJourney({
      ...baseFixture,
      communicationMessages: [{ source_roster_version_id: finalizedRosterAId, state: 'delivered' }],
    });
    const delivered = await loadFixtureJourney({
      ...baseFixture,
      communicationMessages: [
        { source_roster_version_id: finalizedRosterAId, state: 'delivered' },
        { source_roster_version_id: finalizedRosterBId, state: 'delivered' },
      ],
    });

    expect(missingEvidence.stages.find((stage) => stage.id === 'complete')).toMatchObject({
      status: 'in-progress',
      primaryAction: { label: 'Review communication' },
    });
    expect(delivered.stages.find((stage) => stage.id === 'complete')).toMatchObject({
      status: 'complete',
      supportingText: expect.stringContaining('2 finalized rosters ready'),
      primaryAction: { label: 'Review reports' },
    });
  });

  it('keeps check-in reachable without duplicating the primary live action after evaluations complete', async () => {
    const journey = await loadFixtureJourney({
      status: 'published',
      participantCount: 4,
      sessionCount: 1,
      checkinCount: 0,
      completedEvaluationCount: 2,
      evaluatorAssignmentExists: true,
    });
    const run = journey.stages.find((stage) => stage.id === 'run');

    expect(run).toMatchObject({
      status: 'complete',
      primaryAction: {
        label: 'Open live dashboard',
        href: `/app/badlands/tryouts/${tryoutId}/live`,
      },
    });
    expect(run?.secondaryActions).toEqual([
      {
        label: 'Open check-in',
        href: `/app/badlands/tryouts/${tryoutId}/check-in`,
      },
      {
        label: 'Review sessions',
        href: `/app/badlands/tryouts/${tryoutId}/sessions`,
      },
    ]);
  });

  it('uses exact counts plus deterministic bounded division and roster reads within both tenant keys', async () => {
    const { client, logs, rpcLogs } = fakeClient({
      status: 'published',
      participantCount: 2,
      sessionCount: 1,
      completedEvaluationCount: 1,
      finalizedRoster: true,
    });

    await loadTryoutJourney(client as never, {
      organizationId,
      tryoutId,
      authorization: authorization(),
      organizationSlug: 'badlands',
    });

    const countReads = logs.filter((log) => log.options?.head);
    expect(countReads.length).toBeGreaterThan(0);
    expect(countReads.every((log) => log.options?.count === 'exact')).toBe(true);
    expect(logs.some((log) => log.table === 'evaluations')).toBe(false);
    expect(rpcLogs).toEqual(
      expect.arrayContaining([
        {
          name: 'load_live_dashboard',
          args: expect.objectContaining({
            p_organization_id: organizationId,
            p_tryout_id: tryoutId,
          }),
        },
        {
          name: 'load_live_dashboard',
          args: expect.objectContaining({
            p_organization_id: organizationId,
            p_tryout_id: tryoutId,
          }),
        },
        {
          name: 'list_manageable_evaluator_assignments',
          args: expect.objectContaining({
            p_organization_id: organizationId,
            p_tryout_id: tryoutId,
          }),
          limit: 1,
        },
      ]),
    );
    expect(rpcLogs).toHaveLength(3);
    expect(
      logs.every(
        (log) =>
          log.filters.some(
            (filter) =>
              filter[0] === 'eq' && filter[1] === 'organization_id' && filter[2] === organizationId,
          ) &&
          (log.table === 'communication_messages' ||
            (log.table === 'tryouts' &&
              log.filters.some(
                (filter) => filter[0] === 'eq' && filter[1] === 'id' && filter[2] === tryoutId,
              )) ||
            log.filters.some(
              (filter) => filter[0] === 'eq' && filter[1] === 'tryout_id' && filter[2] === tryoutId,
            )),
      ),
    ).toBe(true);
    expect(
      logs
        .filter(
          (log) =>
            !log.options?.head &&
            !['tryout_divisions', 'roster_versions', 'communication_messages'].includes(log.table),
        )
        .every((log) => log.limit === 1),
    ).toBe(true);
    expect(logs.find((log) => log.table === 'tryout_divisions')).toMatchObject({
      columns: 'id',
      options: { count: 'exact' },
      limit: 100,
      orders: [
        { column: 'sort_order', ascending: true },
        { column: 'id', ascending: true },
      ],
    });
    expect(logs.find((log) => log.table === 'roster_versions')).toMatchObject({
      columns: 'id,division_id,state,revision_number',
      options: { count: 'exact' },
      limit: 500,
      orders: [
        { column: 'division_id', ascending: true },
        { column: 'revision_number', ascending: false },
        { column: 'id', ascending: true },
      ],
    });
    expect(logs.find((log) => log.table === 'communication_messages')).toMatchObject({
      columns: 'source_roster_version_id,state',
      options: { count: 'exact' },
      limit: 500,
      filters: expect.arrayContaining([['in', 'source_roster_version_id', [finalizedRosterAId]]]),
      orders: [
        { column: 'source_roster_version_id', ascending: true },
        { column: 'id', ascending: true },
      ],
    });
  });

  it('rejects malformed scope before any data access', async () => {
    const { client, logs } = fakeClient({ status: 'draft' });

    await expect(
      loadTryoutJourney(client as never, {
        organizationId: 'not-a-uuid' as OrganizationId,
        tryoutId,
        authorization: authorization(),
        organizationSlug: 'badlands',
      }),
    ).rejects.toMatchObject({ code: 'invalid_scope' });
    expect(logs).toHaveLength(0);
  });

  it('rejects cross-tenant authorization before any data access', async () => {
    const { client, logs } = fakeClient({ status: 'draft' });

    await expect(
      loadTryoutJourney(client as never, {
        organizationId,
        tryoutId,
        authorization: authorization({
          organizationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' as OrganizationId,
        }),
        organizationSlug: 'badlands',
      }),
    ).rejects.toEqual(expect.objectContaining({ code: 'forbidden' }));
    expect(logs).toHaveLength(0);
  });
});
