import { serializeCsv, serializeCsvChunks, type CsvEncoding } from './csv';

export type EvaluationExportRow = Readonly<{
  athleteNumber: number | null;
  preferredName: string;
  session: string;
  completedCount: number;
  lockedCount: number;
  reopenedCount: number;
  draftCount: number;
  invalidCount: number;
  scoredEvaluatorCount: number;
  overallScore: string | null;
}>;

const headers = [
  'Athlete number',
  'Preferred name',
  'Session',
  'Completed',
  'Locked',
  'Reopened',
  'Draft',
  'Invalid',
  'Scored evaluators',
  'Overall score',
];

function values(rows: readonly EvaluationExportRow[]) {
  return [...rows]
    .sort(
      (left, right) =>
        (left.athleteNumber ?? Number.MAX_SAFE_INTEGER) -
          (right.athleteNumber ?? Number.MAX_SAFE_INTEGER) ||
        left.preferredName.localeCompare(right.preferredName, 'en-CA') ||
        left.session.localeCompare(right.session, 'en-CA'),
    )
    .map(
      (row) =>
        [
          row.athleteNumber,
          row.preferredName,
          row.session,
          row.completedCount,
          row.lockedCount,
          row.reopenedCount,
          row.draftCount,
          row.invalidCount,
          row.scoredEvaluatorCount,
          row.overallScore,
        ] as const,
    );
}

export function encodeEvaluationsCsv(rows: readonly EvaluationExportRow[]): CsvEncoding {
  return serializeCsvChunks(headers, values(rows));
}

export function exportEvaluationsCsv(rows: readonly EvaluationExportRow[]): string {
  return serializeCsv(headers, values(rows));
}
