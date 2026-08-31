import { z } from 'zod';

import { failure, success, type AppResult } from '../../../lib/result';
import type { AuthorizationContext } from '../../organizations/application/capabilities';
import { can } from '../../organizations/application/capabilities';
import { exportAthletesCsv, type AthleteExportRow } from './export-athletes-csv';
import { exportEvaluationsCsv, type EvaluationExportRow } from './export-evaluations-csv';
import { exportRosterCsv, type RosterExportSnapshot } from './export-roster-csv';
import { CsvExportLimitError, MAX_EXPORT_ROWS } from './csv';

export type ReportExportType = 'athletes' | 'evaluations' | 'roster';
export type ReportExportProjection =
  | Readonly<{ outcome: 'forbidden' | 'invalid_scope' | 'not_finalized' }>
  | Readonly<{
      outcome: 'ok';
      exportType: 'athletes';
      scopeLabel: string;
      rows: readonly AthleteExportRow[];
      truncated: boolean;
    }>
  | Readonly<{
      outcome: 'ok';
      exportType: 'evaluations';
      scopeLabel: string;
      rows: readonly EvaluationExportRow[];
      truncated: boolean;
    }>
  | Readonly<{
      outcome: 'ok';
      exportType: 'roster';
      scopeLabel: string;
      snapshot: RosterExportSnapshot;
      truncated: boolean;
    }>;

export interface ReportExportGateway {
  load(input: {
    organizationId: string;
    tryoutId?: string;
    rosterVersionId?: string;
    exportType: ReportExportType;
    maxRows: number;
  }): Promise<ReportExportProjection>;
}

const inputSchema = z.strictObject({
  organizationId: z.uuid(),
  tryoutId: z.uuid().optional(),
  rosterVersionId: z.uuid().optional(),
  exportType: z.enum(['athletes', 'evaluations', 'roster']),
});

function preauthorized(input: z.infer<typeof inputSchema>, actor: AuthorizationContext): boolean {
  if (input.exportType !== 'athletes' && !input.tryoutId) return false;
  if (input.exportType === 'roster' && !input.rosterVersionId) return false;
  if (input.exportType === 'athletes' && !input.tryoutId) {
    return (
      actor.organizationId === input.organizationId &&
      (actor.organizationRole === 'owner' || actor.organizationRole === 'administrator')
    );
  }
  if (
    input.exportType === 'roster' &&
    actor.organizationId === input.organizationId &&
    actor.assignments.some(
      (assignment) =>
        assignment.role === 'reviewer' && assignment.scope.tryoutId === input.tryoutId,
    )
  ) {
    return true;
  }
  return can(actor, 'report:read', {
    organizationId: input.organizationId as AuthorizationContext['organizationId'],
    tryoutId: input.tryoutId,
    finalized: input.exportType === 'roster',
  });
}

function slug(value: string): string {
  const safe = value
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9._-]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
  return safe.slice(0, 80) || 'report';
}

export async function createReportExport(
  input: unknown,
  actor: AuthorizationContext,
  gateway: ReportExportGateway,
): Promise<
  AppResult<
    Readonly<{ csv: string; filename: string; rowCount: number; truncated: boolean }>,
    Readonly<{ code: 'not_found' | 'forbidden' | 'not_finalized' | 'too_large' | 'unexpected' }>
  >
> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return failure({ code: 'not_found' });
  if (!preauthorized(parsed.data, actor)) return failure({ code: 'forbidden' });
  try {
    const projection = await gateway.load({ ...parsed.data, maxRows: MAX_EXPORT_ROWS });
    if (projection.outcome !== 'ok') {
      return failure({
        code: projection.outcome === 'not_finalized' ? 'not_finalized' : 'forbidden',
      });
    }
    if (projection.exportType !== parsed.data.exportType) return failure({ code: 'unexpected' });
    if (projection.truncated) return failure({ code: 'too_large' });
    const csv =
      projection.exportType === 'athletes'
        ? exportAthletesCsv(projection.rows)
        : projection.exportType === 'evaluations'
          ? exportEvaluationsCsv(projection.rows)
          : exportRosterCsv(projection.snapshot);
    const rowCount =
      projection.exportType === 'roster' ? projection.snapshot.rows.length : projection.rows.length;
    return success({
      csv,
      filename: `${slug(projection.scopeLabel)}-${projection.exportType}.csv`,
      rowCount,
      truncated: projection.truncated,
    });
  } catch (error) {
    return failure({ code: error instanceof CsvExportLimitError ? 'too_large' : 'unexpected' });
  }
}
