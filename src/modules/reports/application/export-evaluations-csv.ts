import { serializeCsv } from './csv';

export type EvaluationExportRow = Readonly<{
  athleteNumber: number | null;
  preferredName: string;
  session: string;
  completionState: 'draft' | 'completed' | 'locked' | 'reopened' | 'not_started';
  overallScore: string | null;
}>;

export function exportEvaluationsCsv(rows: readonly EvaluationExportRow[]): string {
  const ordered = [...rows].sort(
    (left, right) =>
      (left.athleteNumber ?? Number.MAX_SAFE_INTEGER) -
        (right.athleteNumber ?? Number.MAX_SAFE_INTEGER) ||
      left.preferredName.localeCompare(right.preferredName, 'en-CA') ||
      left.session.localeCompare(right.session, 'en-CA'),
  );
  return serializeCsv(
    ['Athlete number', 'Preferred name', 'Session', 'Completion state', 'Overall score'],
    ordered.map((row) => [
      row.athleteNumber,
      row.preferredName,
      row.session,
      row.completionState,
      row.overallScore,
    ]),
  );
}
