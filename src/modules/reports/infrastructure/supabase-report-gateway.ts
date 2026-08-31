import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

import type { Database } from '../../../infrastructure/supabase/database.types';
import type {
  ReportExportGateway,
  ReportExportProjection,
} from '../application/create-report-export';

const rowLimit = 5_000;
const athleteRow = z.strictObject({
  athleteNumber: z.number().int().min(1).max(9999).nullable(),
  preferredName: z.string().min(1).max(120),
  familyName: z.string().min(1).max(120).nullable(),
  position: z.string().min(1).max(120).nullable(),
  registrationStatus: z.enum(['submitted', 'withdrawn', 'cancelled']),
});
const evaluationRow = z.strictObject({
  athleteNumber: z.number().int().min(1).max(9999).nullable(),
  preferredName: z.string().min(1).max(120),
  session: z.string().min(1).max(160),
  completionState: z.enum(['draft', 'completed', 'locked', 'reopened', 'not_started']),
  overallScore: z
    .string()
    .regex(/^(?:100(?:\.0)?|[0-9]{1,2}(?:\.[0-9])?)$/u)
    .nullable(),
});
const rosterRow = z.strictObject({
  athleteNumber: z.number().int().min(1).max(9999).nullable(),
  preferredName: z.string().min(1).max(120),
  decision: z.enum(['undecided', 'callback', 'selected', 'waitlisted', 'released', 'withdrawn']),
  team: z.string().min(1).max(120).nullable(),
});
const denied = z.strictObject({ outcome: z.enum(['forbidden', 'invalid_scope', 'not_finalized']) });
const common = {
  outcome: z.literal('ok'),
  scopeLabel: z.string().trim().min(1).max(321),
  truncated: z.boolean(),
};
const projectionSchema = z.union([
  denied,
  z.strictObject({
    ...common,
    exportType: z.literal('athletes'),
    rows: z.array(athleteRow).max(rowLimit),
  }),
  z.strictObject({
    ...common,
    exportType: z.literal('evaluations'),
    rows: z.array(evaluationRow).max(rowLimit),
  }),
  z.strictObject({
    ...common,
    exportType: z.literal('roster'),
    snapshot: z.strictObject({
      rosterVersionId: z.uuid(),
      state: z.literal('finalized'),
      finalizedAt: z.iso.datetime({ offset: true }),
      rows: z.array(rosterRow).max(rowLimit),
    }),
  }),
]);

export function parseReportExportProjection(input: unknown): ReportExportProjection {
  const parsed = projectionSchema.safeParse(input);
  if (!parsed.success) throw new Error('Invalid report projection');
  return parsed.data as ReportExportProjection;
}

export type ReportSummary = Readonly<{
  athleteCount: number;
  completedEvaluationCount: number;
  incompleteEvaluationCount: number;
  finalizedRosterCount: number;
  latestFinalizedRosterId: string | null;
}>;
const summaryResponse = z.strictObject({
  outcome: z.enum(['ok', 'forbidden']),
  summary: z
    .strictObject({
      athleteCount: z.number().int().min(0).max(1_000_000),
      completedEvaluationCount: z.number().int().min(0).max(10_000_000),
      incompleteEvaluationCount: z.number().int().min(0).max(10_000_000),
      finalizedRosterCount: z.number().int().min(0).max(1_000_000),
      latestFinalizedRosterId: z.uuid().nullable(),
    })
    .optional(),
});

export class SupabaseReportGateway implements ReportExportGateway {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async load(input: Parameters<ReportExportGateway['load']>[0]): Promise<ReportExportProjection> {
    const { data, error } = await this.client.rpc('load_report_export', {
      p_organization_id: input.organizationId,
      p_export_type: input.exportType,
      p_tryout_id: input.tryoutId,
      p_roster_version_id: input.rosterVersionId,
      p_max_rows: input.maxRows,
    });
    if (error || !Array.isArray(data) || data.length !== 1)
      throw error ?? new Error('Invalid report projection');
    return parseReportExportProjection(data[0]?.result);
  }

  async summary(organizationId: string, tryoutId?: string): Promise<ReportSummary | null> {
    const { data, error } = await this.client.rpc('load_report_summary', {
      p_organization_id: organizationId,
      p_tryout_id: tryoutId,
    });
    if (error || !Array.isArray(data) || data.length !== 1)
      throw error ?? new Error('Invalid report summary');
    const parsed = summaryResponse.safeParse(data[0]?.result);
    if (!parsed.success) throw new Error('Invalid report summary');
    return parsed.data.outcome === 'ok' && parsed.data.summary ? parsed.data.summary : null;
  }
}
