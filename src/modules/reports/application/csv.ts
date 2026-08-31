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

export function serializeCsv(
  headers: readonly string[],
  rows: readonly (readonly (string | number | null)[])[],
): string {
  if (rows.length > MAX_EXPORT_ROWS) throw new CsvExportLimitError('row_limit');
  const content = `${headers.map(field).join(',')}\r\n${rows.map((row) => row.map(field).join(',')).join('\r\n')}${rows.length > 0 ? '\r\n' : ''}`;
  if (new TextEncoder().encode(content).byteLength > MAX_EXPORT_BYTES) {
    throw new CsvExportLimitError('byte_limit');
  }
  return content;
}
