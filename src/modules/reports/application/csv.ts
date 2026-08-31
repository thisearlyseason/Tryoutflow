export const MAX_EXPORT_ROWS = 5_000;
export const MAX_EXPORT_BYTES = 4 * 1024 * 1024;

export class CsvExportLimitError extends Error {
  constructor(readonly code: 'row_limit' | 'byte_limit') {
    super(
      code === 'row_limit'
        ? 'CSV export exceeds the 5,000-row limit.'
        : 'CSV export exceeds the 4 MiB limit.',
    );
    this.name = 'CsvExportLimitError';
  }
}

function isControlOrWhitespace(character: string): boolean {
  const point = character.codePointAt(0)!;
  return point <= 0x20 || point === 0x7f || point === 0xfeff || /\s/u.test(character);
}

/** Neutralizes formula execution even when a spreadsheet skips leading whitespace/control bytes. */
export function escapeSpreadsheetCell(value: string): string {
  let index = 0;
  for (const character of value) {
    if (!isControlOrWhitespace(character)) break;
    index += character.length;
  }
  const firstSignificant = value.slice(index, index + 1);
  return ['=', '+', '-', '@'].includes(firstSignificant) ||
    (index > 0 && /[\u0000-\u001f\u007f\ufeff]/u.test(value.slice(0, index)))
    ? `'${value}`
    : value;
}

function field(value: string | number | null): string {
  const escaped = escapeSpreadsheetCell(value === null ? '' : String(value));
  return /[",\r\n]/u.test(escaped) ? `"${escaped.replaceAll('"', '""')}"` : escaped;
}

export type CsvEncoding = Readonly<{
  chunks: readonly Uint8Array[];
  byteLength: number;
}>;

export function serializeCsvChunks(
  headers: readonly string[],
  rows: readonly (readonly (string | number | null)[])[],
): CsvEncoding {
  if (rows.length > MAX_EXPORT_ROWS) throw new CsvExportLimitError('row_limit');
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  for (const values of [headers, ...rows]) {
    const chunk = encoder.encode(`${values.map(field).join(',')}\r\n`);
    byteLength += chunk.byteLength;
    if (byteLength > MAX_EXPORT_BYTES) throw new CsvExportLimitError('byte_limit');
    chunks.push(chunk);
  }
  return { chunks, byteLength };
}

export function serializeCsv(
  headers: readonly string[],
  rows: readonly (readonly (string | number | null)[])[],
): string {
  const encoded = serializeCsvChunks(headers, rows);
  const decoder = new TextDecoder();
  return encoded.chunks.map((chunk) => decoder.decode(chunk)).join('');
}
