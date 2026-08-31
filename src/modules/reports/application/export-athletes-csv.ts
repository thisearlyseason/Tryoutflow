import { serializeCsv, serializeCsvChunks, type CsvEncoding } from './csv';

export type AthleteExportRow = Readonly<{
  athleteNumber: number | null;
  preferredName: string;
  familyName: string | null;
  position: string | null;
  registrationStatus: 'submitted' | 'withdrawn' | 'cancelled' | null;
}>;

function values(rows: readonly AthleteExportRow[]) {
  return [...rows]
    .sort(
      (left, right) =>
        (left.athleteNumber ?? Number.MAX_SAFE_INTEGER) -
          (right.athleteNumber ?? Number.MAX_SAFE_INTEGER) ||
        left.preferredName.localeCompare(right.preferredName, 'en-CA') ||
        (left.familyName ?? '').localeCompare(right.familyName ?? '', 'en-CA'),
    )
    .map(
      (row) =>
        [
          row.athleteNumber,
          row.preferredName,
          row.familyName,
          row.position,
          row.registrationStatus,
        ] as const,
    );
}

const headers = [
  'Athlete number',
  'Preferred name',
  'Family name',
  'Position',
  'Registration status',
];

export function encodeAthletesCsv(rows: readonly AthleteExportRow[]): CsvEncoding {
  return serializeCsvChunks(headers, values(rows));
}

export function exportAthletesCsv(rows: readonly AthleteExportRow[]): string {
  return serializeCsv(headers, values(rows));
}
