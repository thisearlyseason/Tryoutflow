import { describe, expect, it, vi } from 'vitest';
import Papa from 'papaparse';

import type { AuthorizationContext } from '../../../src/modules/organizations/application/capabilities';
import { createReportExport } from '../../../src/modules/reports/application/create-report-export';
import {
  parseReportExportProjection,
  SupabaseReportGateway,
} from '../../../src/modules/reports/infrastructure/supabase-report-gateway';
import {
  exportAthletesCsv,
  type AthleteExportRow,
} from '../../../src/modules/reports/application/export-athletes-csv';
import {
  exportEvaluationsCsv,
  type EvaluationExportRow,
} from '../../../src/modules/reports/application/export-evaluations-csv';
import {
  exportRosterCsv,
  type RosterExportSnapshot,
} from '../../../src/modules/reports/application/export-roster-csv';

const ids = {
  organization: '29000000-0000-4000-8000-000000000001',
  actor: '29000000-0000-4000-8000-000000000002',
  tryout: '29000000-0000-4000-8000-000000000003',
  roster: '29000000-0000-4000-8000-000000000004',
};

const actor = (role: AuthorizationContext['organizationRole']): AuthorizationContext => ({
  userId: ids.actor as AuthorizationContext['userId'],
  organizationId: ids.organization as AuthorizationContext['organizationId'],
  organizationRole: role,
  membershipStatus: 'active',
  assignments: [],
});

describe('RFC 4180 report exports', () => {
  it('quotes commas, quotes, CRLF, Unicode and nulls without changing the data', () => {
    const row: AthleteExportRow = {
      athleteNumber: 42,
      preferredName: 'Zoë, "Z"\r\nLine',
      familyName: null,
      position: '守門員',
      registrationStatus: 'submitted',
    };

    expect(exportAthletesCsv([row])).toBe(
      'Athlete number,Preferred name,Family name,Position,Registration status\r\n' +
        '42,"Zoë, ""Z""\r\nLine",,守門員,submitted\r\n',
    );
  });

  it.each([
    '=SUM(1,1)',
    ' +cmd',
    '\t-2+3',
    '\r\n@IMPORTXML("x")',
    '\u0000=HYPERLINK("x")',
    '\ufeff=1+1',
  ])('neutralizes a dangerous spreadsheet cell after whitespace/control prefixes: %j', (name) => {
    const csv = exportRosterCsv({
      rosterVersionId: ids.roster,
      state: 'finalized',
      finalizedAt: '2026-08-28T12:00:00.000Z',
      rows: [
        { athleteNumber: 7, preferredName: name, decision: 'selected', team: 'Badlands Blue' },
      ],
    });
    expect(Papa.parse<string[]>(csv).data[1]?.[1]).toBe(`'${name}`);
  });

  it('exports only a finalized immutable roster snapshot in stable row order', () => {
    const snapshot: RosterExportSnapshot = {
      rosterVersionId: ids.roster,
      state: 'finalized',
      finalizedAt: '2026-08-28T12:00:00.000Z',
      rows: [
        { athleteNumber: null, preferredName: 'Second', decision: 'released', team: null },
        { athleteNumber: 2, preferredName: 'First', decision: 'selected', team: 'Blue' },
      ],
    };
    expect(exportRosterCsv(snapshot)).toBe(
      'Athlete number,Preferred name,Decision,Team\r\n' +
        '2,First,selected,Blue\r\n' +
        ',Second,released,\r\n',
    );
    expect(() => exportRosterCsv({ ...snapshot, state: 'draft' })).toThrow(/finalized/i);
    expect(() => exportRosterCsv({ ...snapshot, finalizedAt: null })).toThrow(/finalized/i);
  });

  it('omits private notes and evaluator identity from the general evaluation contract', () => {
    const maliciousProjection = {
      athleteNumber: 12,
      preferredName: 'Synthetic Athlete',
      session: 'Skills',
      completedCount: 1,
      lockedCount: 0,
      reopenedCount: 1,
      draftCount: 1,
      invalidCount: 1,
      scoredEvaluatorCount: 1,
      overallScore: '92.0000',
      evaluatorName: 'Must Not Export',
      privateNotes: 'Must Not Export',
    } as EvaluationExportRow & { evaluatorName: string; privateNotes: string };

    const csv = exportEvaluationsCsv([maliciousProjection]);
    expect(csv).toBe(
      'Athlete number,Preferred name,Session,Completed,Locked,Reopened,Draft,Invalid,Scored evaluators,Overall score\r\n' +
        '12,Synthetic Athlete,Skills,1,0,1,1,1,1,92.0000\r\n',
    );
    expect(csv).not.toMatch(/Must Not Export|private note|evaluator name|evaluator id/iu);
  });

  it('leaves an unregistered organization athlete registration state empty', () => {
    expect(
      exportAthletesCsv([
        {
          athleteNumber: null,
          preferredName: 'Unregistered',
          familyName: 'Synthetic',
          position: null,
          registrationStatus: null,
        },
      ]),
    ).toContain(',Unregistered,Synthetic,,\r\n');
  });
});

describe('authorized server export snapshots', () => {
  const evaluationProjection = (
    overrides: Partial<{
      completedCount: number;
      lockedCount: number;
      reopenedCount: number;
      draftCount: number;
      invalidCount: number;
      scoredEvaluatorCount: number;
      truncated: boolean;
    }> = {},
  ) => {
    const { truncated = false, ...counts } = overrides;
    return {
      outcome: 'ok',
      exportType: 'evaluations',
      scopeLabel: 'Badlands / U15',
      rows: [
        {
          athleteNumber: 12,
          preferredName: 'Synthetic Athlete',
          session: 'Skills',
          completedCount: 0,
          lockedCount: 0,
          reopenedCount: 0,
          draftCount: 0,
          invalidCount: 0,
          scoredEvaluatorCount: 0,
          overallScore: null,
          ...counts,
        },
      ],
      truncated,
    };
  };

  it.each([1_000, 1_001, 10_000])(
    'accepts truthful evaluation lifecycle counts through the report cap: %i',
    (count) => {
      const projection = parseReportExportProjection({
        outcome: 'ok',
        exportType: 'evaluations',
        scopeLabel: 'Badlands / U15',
        rows: [
          {
            athleteNumber: 12,
            preferredName: 'Synthetic Athlete',
            session: 'Skills',
            completedCount: count,
            lockedCount: 0,
            reopenedCount: 0,
            draftCount: 0,
            invalidCount: 0,
            scoredEvaluatorCount: count,
            overallScore: '92.0000',
          },
        ],
        truncated: false,
      });
      expect(projection.outcome).toBe('ok');
    },
  );

  it('accepts the SQL overflow sentinel so application code can return 413 rather than parser 503', async () => {
    const overflow = parseReportExportProjection({
      outcome: 'ok',
      exportType: 'evaluations',
      scopeLabel: 'Badlands / U15',
      rows: [
        {
          athleteNumber: 12,
          preferredName: 'Synthetic Athlete',
          session: 'Skills',
          completedCount: 10_001,
          lockedCount: 0,
          reopenedCount: 0,
          draftCount: 0,
          invalidCount: 0,
          scoredEvaluatorCount: 10_001,
          overallScore: '92.0000',
        },
      ],
      truncated: true,
    });
    expect(overflow.outcome).toBe('ok');
    const result = await createReportExport(
      { organizationId: ids.organization, tryoutId: ids.tryout, exportType: 'evaluations' },
      {
        ...actor('member'),
        assignments: [{ role: 'director', scope: { kind: 'tryout', tryoutId: ids.tryout } }],
      },
      { load: vi.fn().mockResolvedValue(overflow) },
    );
    expect(result).toEqual({ ok: false, error: { code: 'too_large' } });
  });

  it.each([
    'completedCount',
    'lockedCount',
    'reopenedCount',
    'draftCount',
    'invalidCount',
    'scoredEvaluatorCount',
  ] as const)('rejects an untruncated overflow sentinel in %s', async (field) => {
    const malformed = evaluationProjection({ [field]: 10_001, truncated: false });
    expect(() => parseReportExportProjection(malformed)).toThrow(/truncated/i);
    const result = await createReportExport(
      { organizationId: ids.organization, tryoutId: ids.tryout, exportType: 'evaluations' },
      {
        ...actor('member'),
        assignments: [{ role: 'director', scope: { kind: 'tryout', tryoutId: ids.tryout } }],
      },
      { load: vi.fn().mockResolvedValue(malformed) },
    );
    expect(result).toEqual({ ok: false, error: { code: 'too_large' } });
  });

  it('treats a truncated projection as too large even when every lifecycle count is in range', async () => {
    const result = await createReportExport(
      { organizationId: ids.organization, tryoutId: ids.tryout, exportType: 'evaluations' },
      {
        ...actor('member'),
        assignments: [{ role: 'director', scope: { kind: 'tryout', tryoutId: ids.tryout } }],
      },
      { load: vi.fn().mockResolvedValue(evaluationProjection({ truncated: true })) },
    );
    expect(result).toEqual({ ok: false, error: { code: 'too_large' } });
  });

  it('passes abort signals to the Supabase query builder', async () => {
    const controller = new AbortController();
    let receivedSignal: AbortSignal | undefined;
    const builder = {
      abortSignal(signal: AbortSignal) {
        receivedSignal = signal;
        return this;
      },
      then(resolve: (value: unknown) => unknown) {
        return Promise.resolve({ data: [{ result: { outcome: 'forbidden' } }], error: null }).then(
          resolve,
        );
      },
    };
    const client = { rpc: vi.fn(() => builder) };
    const gateway = new SupabaseReportGateway(client as never);
    await gateway.load(
      {
        organizationId: ids.organization,
        exportType: 'athletes',
        maxRows: 5_000,
      },
      controller.signal,
    );
    expect(receivedSignal).toBe(controller.signal);
  });

  it('does not initiate an RPC for a pre-aborted export request', async () => {
    const controller = new AbortController();
    controller.abort('client disconnected');
    const client = { rpc: vi.fn() };
    const gateway = new SupabaseReportGateway(client as never);
    await expect(
      gateway.load(
        {
          organizationId: ids.organization,
          exportType: 'athletes',
          maxRows: 5_000,
        },
        controller.signal,
      ),
    ).rejects.toBe('client disconnected');
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('denies general members and evaluators before loading any export rows', async () => {
    const load = vi.fn();
    for (const denied of [
      actor('member'),
      {
        ...actor('member'),
        assignments: [
          { role: 'evaluator' as const, scope: { kind: 'tryout' as const, tryoutId: ids.tryout } },
        ],
      },
    ]) {
      await expect(
        createReportExport(
          { organizationId: ids.organization, tryoutId: ids.tryout, exportType: 'evaluations' },
          denied,
          { load },
        ),
      ).resolves.toEqual({ ok: false, error: { code: 'forbidden' } });
    }
    expect(load).not.toHaveBeenCalled();
  });

  it('allows an assigned director, but still trusts only an execution-time authorized projection', async () => {
    const director: AuthorizationContext = {
      ...actor('member'),
      assignments: [{ role: 'director', scope: { kind: 'tryout', tryoutId: ids.tryout } }],
    };
    const load = vi.fn().mockResolvedValue({
      outcome: 'ok',
      exportType: 'evaluations',
      scopeLabel: 'Badlands / U15',
      rows: [
        {
          athleteNumber: 12,
          preferredName: 'Synthetic Athlete',
          session: 'Skills',
          completedCount: 1,
          lockedCount: 0,
          reopenedCount: 0,
          draftCount: 0,
          invalidCount: 0,
          scoredEvaluatorCount: 1,
          overallScore: '80.0000',
        },
      ],
      truncated: false,
    });

    const result = await createReportExport(
      { organizationId: ids.organization, tryoutId: ids.tryout, exportType: 'evaluations' },
      director,
      { load },
    );
    expect(
      result.ok && result.value.chunks.map((chunk) => new TextDecoder().decode(chunk)).join(''),
    ).toContain('Synthetic Athlete');
    expect(load).toHaveBeenCalledWith(
      {
        organizationId: ids.organization,
        tryoutId: ids.tryout,
        exportType: 'evaluations',
        maxRows: 5000,
      },
      undefined,
    );

    load.mockResolvedValueOnce({ outcome: 'forbidden' });
    await expect(
      createReportExport(
        { organizationId: ids.organization, tryoutId: ids.tryout, exportType: 'evaluations' },
        director,
        { load },
      ),
    ).resolves.toEqual({ ok: false, error: { code: 'forbidden' } });
  });

  it('lets an explicitly granted division reviewer request only a finalized roster projection', async () => {
    const reviewer: AuthorizationContext = {
      ...actor('member'),
      assignments: [
        {
          role: 'reviewer',
          scope: {
            kind: 'division',
            tryoutId: ids.tryout,
            divisionId: '29000000-0000-4000-8000-000000000099',
          },
        },
      ],
    };
    const load = vi.fn().mockResolvedValue({ outcome: 'forbidden' });
    await expect(
      createReportExport(
        {
          organizationId: ids.organization,
          tryoutId: ids.tryout,
          rosterVersionId: ids.roster,
          exportType: 'roster',
        },
        reviewer,
        { load },
      ),
    ).resolves.toEqual({ ok: false, error: { code: 'forbidden' } });
    expect(load).toHaveBeenCalledOnce();

    load.mockClear();
    await createReportExport(
      { organizationId: ids.organization, tryoutId: ids.tryout, exportType: 'evaluations' },
      reviewer,
      { load },
    );
    expect(load).not.toHaveBeenCalled();
  });

  it('rejects invalid identifiers without calling the projection and bounds rows and bytes', async () => {
    const load = vi.fn();
    await expect(
      createReportExport({ organizationId: 'not-an-id', exportType: 'athletes' }, actor('owner'), {
        load,
      }),
    ).resolves.toEqual({ ok: false, error: { code: 'not_found' } });
    expect(load).not.toHaveBeenCalled();

    expect(() =>
      exportAthletesCsv(
        Array.from({ length: 5001 }, (_, index) => ({
          athleteNumber: index + 1,
          preferredName: 'Synthetic',
          familyName: 'Athlete',
          position: null,
          registrationStatus: 'submitted',
        })),
      ),
    ).toThrow(/5,000/iu);
    expect(() =>
      exportAthletesCsv([
        {
          athleteNumber: 1,
          preferredName: 'x'.repeat(4 * 1024 * 1024),
          familyName: 'Athlete',
          position: null,
          registrationStatus: 'submitted',
        },
      ]),
    ).toThrow(/4 MiB/iu);
  });

  it('does not silently download a server-truncated snapshot', async () => {
    const load = vi.fn().mockResolvedValue({
      outcome: 'ok',
      exportType: 'athletes',
      scopeLabel: 'Badlands',
      rows: [],
      truncated: true,
    });
    await expect(
      createReportExport(
        { organizationId: ids.organization, exportType: 'athletes' },
        actor('owner'),
        { load },
      ),
    ).resolves.toEqual({ ok: false, error: { code: 'too_large' } });
  });
});
