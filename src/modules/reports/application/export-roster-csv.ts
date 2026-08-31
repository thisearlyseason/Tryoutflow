import { serializeCsv, serializeCsvChunks, type CsvEncoding } from './csv';

export type RosterExportRow = Readonly<{
  athleteNumber: number | null;
  preferredName: string;
  decision: 'undecided' | 'callback' | 'selected' | 'waitlisted' | 'released' | 'withdrawn';
  team: string | null;
}>;

export type RosterExportSnapshot = Readonly<{
  rosterVersionId: string;
  state: 'draft' | 'finalized';
  finalizedAt: string | null;
  rows: readonly RosterExportRow[];
}>;

export function exportRosterCsv(snapshot: RosterExportSnapshot): string {
  if (snapshot.state !== 'finalized' || snapshot.finalizedAt === null) {
    throw new Error('Only a finalized roster snapshot can be exported.');
  }
  return serializeCsv(['Athlete number', 'Preferred name', 'Decision', 'Team'], values(snapshot));
}

function values(snapshot: RosterExportSnapshot) {
  if (snapshot.state !== 'finalized' || snapshot.finalizedAt === null) {
    throw new Error('Only a finalized roster snapshot can be exported.');
  }
  return [...snapshot.rows]
    .sort(
      (left, right) =>
        (left.athleteNumber ?? Number.MAX_SAFE_INTEGER) -
          (right.athleteNumber ?? Number.MAX_SAFE_INTEGER) ||
        left.preferredName.localeCompare(right.preferredName, 'en-CA'),
    )
    .map((row) => [row.athleteNumber, row.preferredName, row.decision, row.team] as const);
}

export function encodeRosterCsv(snapshot: RosterExportSnapshot): CsvEncoding {
  return serializeCsvChunks(
    ['Athlete number', 'Preferred name', 'Decision', 'Team'],
    values(snapshot),
  );
}
