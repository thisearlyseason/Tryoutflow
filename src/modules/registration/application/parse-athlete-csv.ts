import Papa from 'papaparse';

import {
  canonicalRegistrationText,
  registrationCodePointLength,
} from '../domain/registration-validation';

export const MAX_CSV_BYTES = 1_048_576;
export const MAX_CSV_ROWS = 1_000;
export const MAX_CSV_COLUMNS = 30;
export const MAX_CSV_CELL_CODE_POINTS = 500;

export type CsvColumnMapping = {
  givenName: string;
  familyName: string;
  birthDate: string;
  guardianName?: string;
  guardianEmail?: string;
  guardianPhone?: string;
};

export type ParsedAthleteCsvRow = {
  row: number;
  values: Record<string, string>;
};

export type ParsedAthleteCsv = {
  headers: string[];
  rows: ParsedAthleteCsvRow[];
};

export class CsvImportError extends Error {
  constructor(
    readonly code:
      | 'file_too_large'
      | 'too_many_rows'
      | 'too_many_columns'
      | 'cell_too_large'
      | 'invalid_csv'
      | 'duplicate_header'
      | 'mapping_invalid',
    message: string,
  ) {
    super(message);
    this.name = 'CsvImportError';
  }
}

function normalizedHeader(value: string) {
  return canonicalRegistrationText(value).toLocaleLowerCase('en-CA');
}

/** Safe when a value is later included in a downloadable CSV/spreadsheet. */
export function escapeSpreadsheetFormula(value: string): string {
  return /^[\u0009\u000d ]*[=+\-@]/u.test(value) || /^[\u0009\u000d]/u.test(value)
    ? `'${value}`
    : value;
}

function validateMapping(headers: string[], mapping: CsvColumnMapping) {
  if (!mapping.givenName || !mapping.familyName || !mapping.birthDate) {
    throw new CsvImportError(
      'mapping_invalid',
      'Given name, family name, and birth date mapping are required.',
    );
  }
  const known = new Map(headers.map((header) => [normalizedHeader(header), header]));
  const selected = Object.values(mapping).filter((value): value is string => Boolean(value));
  for (const header of selected) {
    if (!known.has(normalizedHeader(header))) {
      throw new CsvImportError('mapping_invalid', `Mapping refers to unknown column: ${header}`);
    }
  }
  const normalized = selected.map(normalizedHeader);
  if (new Set(normalized).size !== normalized.length) {
    throw new CsvImportError('mapping_invalid', 'A source column cannot be mapped more than once.');
  }
}

export function parseAthleteCsv(content: string, mapping: CsvColumnMapping): ParsedAthleteCsv {
  if (new TextEncoder().encode(content).byteLength > MAX_CSV_BYTES) {
    throw new CsvImportError('file_too_large', 'CSV exceeds the 1 MiB upload limit.');
  }
  if (content.includes('\0')) throw new CsvImportError('invalid_csv', 'CSV contains a NUL byte.');

  const parsed = Papa.parse<string[]>(content, {
    delimiter: ',',
    skipEmptyLines: 'greedy',
  });
  if (parsed.errors.length > 0 || parsed.data.length === 0) {
    throw new CsvImportError('invalid_csv', 'CSV could not be parsed unambiguously.');
  }
  const headerCells = parsed.data[0] ?? [];
  if (headerCells.length === 0 || headerCells.length > MAX_CSV_COLUMNS) {
    throw new CsvImportError('too_many_columns', `CSV must have 1-${MAX_CSV_COLUMNS} columns.`);
  }
  const headers = headerCells.map((value) =>
    canonicalRegistrationText(value.replace(/^\ufeff/u, '')),
  );
  if (headers.some((header) => header === '')) {
    throw new CsvImportError('invalid_csv', 'CSV headers cannot be blank.');
  }
  const normalized = headers.map(normalizedHeader);
  if (new Set(normalized).size !== normalized.length) {
    throw new CsvImportError('duplicate_header', 'CSV contains a duplicate header.');
  }
  validateMapping(headers, mapping);

  const dataRows = parsed.data.slice(1);
  if (dataRows.length > MAX_CSV_ROWS) {
    throw new CsvImportError('too_many_rows', `CSV exceeds the ${MAX_CSV_ROWS}-row limit.`);
  }
  const rows = dataRows.map((cells, index) => {
    if (cells.length !== headers.length) {
      throw new CsvImportError('invalid_csv', `Row ${index + 2} has an unexpected column count.`);
    }
    const values: Record<string, string> = {};
    headers.forEach((header, column) => {
      const value = cells[column] ?? '';
      if (registrationCodePointLength(value) > MAX_CSV_CELL_CODE_POINTS) {
        throw new CsvImportError('cell_too_large', `Row ${index + 2} contains an oversized cell.`);
      }
      values[header] = value;
    });
    return { row: index + 2, values };
  });
  return { headers, rows };
}

export function mappedValue(
  row: ParsedAthleteCsvRow,
  header: string | undefined,
): string | undefined {
  if (!header) return undefined;
  const target = normalizedHeader(header);
  const entry = Object.entries(row.values).find(([key]) => normalizedHeader(key) === target);
  return entry?.[1];
}
