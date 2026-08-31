import { serializeCsv } from './csv';

export type AthleteExportRow = Readonly<{
  athleteNumber: number | null;
  preferredName: string;
  familyName: string | null;
  position: string | null;
  registrationStatus: 'submitted' | 'withdrawn' | 'cancelled';
}>;

export function exportAthletesCsv(rows: readonly AthleteExportRow[]): string {
  const ordered = [...rows].sort(
    (left, right) =>
      (left.athleteNumber ?? Number.MAX_SAFE_INTEGER) -
        (right.athleteNumber ?? Number.MAX_SAFE_INTEGER) ||
      left.preferredName.localeCompare(right.preferredName, 'en-CA') ||
      (left.familyName ?? '').localeCompare(right.familyName ?? '', 'en-CA'),
  );
  return serializeCsv(
    ['Athlete number', 'Preferred name', 'Family name', 'Position', 'Registration status'],
    ordered.map((row) => [
      row.athleteNumber,
      row.preferredName,
      row.familyName,
      row.position,
      row.registrationStatus,
    ]),
  );
}
