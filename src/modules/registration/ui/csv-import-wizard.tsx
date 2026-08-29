'use client';

import { useMemo, useState, type ChangeEvent } from 'react';
import Papa from 'papaparse';

import type { AthleteImportPreview } from '../application/preview-athlete-import';
import { escapeSpreadsheetFormula, type CsvColumnMapping } from '../application/parse-athlete-csv';

const fields = [
  ['givenName', 'Given name', true],
  ['familyName', 'Family name', true],
  ['birthDate', 'Birth date', true],
  ['guardianName', 'Guardian name', false],
  ['guardianEmail', 'Guardian email', false],
  ['guardianPhone', 'Guardian phone', false],
] as const;

export function CsvImportWizard({ organizationId }: { organizationId: string }) {
  const [content, setContent] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Partial<CsvColumnMapping>>({});
  const [preview, setPreview] = useState<AthleteImportPreview | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [message, setMessage] = useState('Choose a CSV file to begin.');
  const [busy, setBusy] = useState(false);
  const validRows = useMemo(
    () => preview?.rows.filter((row) => row.status === 'valid') ?? [],
    [preview],
  );

  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setPreview(null);
    setSelected(new Set());
    if (!file) return;
    if (file.size > 1_048_576) {
      setMessage('That file exceeds the 1 MiB limit.');
      return;
    }
    const text = await file.text();
    const parsed = Papa.parse<string[]>(text, { delimiter: ',', preview: 1 });
    const nextHeaders = parsed.data[0]?.map((header) => header.trim()).filter(Boolean) ?? [];
    if (parsed.errors.length > 0 || nextHeaders.length === 0) {
      setMessage('We could not read a clear comma-separated header row.');
      return;
    }
    setContent(text);
    setHeaders(nextHeaders);
    setMapping({});
    setMessage('Map each required field, then generate a review preview.');
  }

  async function request(body: unknown) {
    return fetch(`/api/organizations/${organizationId}/athlete-imports`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  async function generatePreview() {
    if (!mapping.givenName || !mapping.familyName || !mapping.birthDate) {
      setMessage('Map given name, family name, and birth date first.');
      return;
    }
    setBusy(true);
    try {
      const response = await request({ action: 'preview', content, mapping });
      if (!response.ok) throw new Error('preview');
      const result = (await response.json()) as { preview: AthleteImportPreview };
      setPreview(result.preview);
      setSelected(
        new Set(result.preview.rows.filter((row) => row.status === 'valid').map((row) => row.row)),
      );
      setMessage('Review every row. Only checked valid rows will be imported.');
    } catch {
      setMessage('The preview could not be created. Check the mapping and CSV format.');
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!preview || selected.size === 0) return;
    setBusy(true);
    try {
      const response = await request({
        action: 'commit',
        previewId: preview.id,
        selectedRows: [...selected],
      });
      const result = (await response.json()) as {
        result?: { outcome: string; athleteIds: string[] };
      };
      if (!response.ok || !result.result) throw new Error('commit');
      setMessage(
        result.result.outcome === 'replayed'
          ? `This import was already completed (${result.result.athleteIds.length} athletes).`
          : `Imported ${result.result.athleteIds.length} athletes.`,
      );
    } catch {
      setMessage('The import was not committed. Refresh the preview and try again.');
    } finally {
      setBusy(false);
    }
  }

  function downloadInvalidRows() {
    if (!preview) return;
    const unsafeRows = preview.rows.filter((row) => row.status !== 'valid');
    const quote = (value: string) => `"${escapeSpreadsheetFormula(value).replaceAll('"', '""')}"`;
    const csv = [
      ['Source row', 'Status', 'Errors', 'Given name', 'Family name', 'Birth date'],
      ...unsafeRows.map((row) => [
        String(row.row),
        row.status,
        row.errors.join('|'),
        row.athlete.givenName,
        row.athlete.familyName,
        row.athlete.birthDate,
      ]),
    ]
      .map((row) => row.map(quote).join(','))
      .join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'athlete-import-issues.csv';
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <label className="block font-bold" htmlFor="athlete-csv">
          CSV file
        </label>
        <input
          id="athlete-csv"
          type="file"
          accept=".csv,text/csv"
          onChange={chooseFile}
          className="mt-2 min-h-[var(--target-mobile)] w-full"
        />
        <p className="mt-2 text-sm text-[var(--color-text-muted)]">
          Comma-separated, maximum 1 MiB and 1,000 data rows. The file itself is not stored.
        </p>
      </div>

      {headers.length > 0 ? (
        <fieldset className="grid gap-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 sm:grid-cols-2">
          <legend className="px-2 font-bold">Column mapping</legend>
          {fields.map(([key, label, required]) => (
            <label className="grid gap-1" key={key}>
              <span className="font-medium">
                {label}
                {required ? ' (required)' : ''}
              </span>
              <select
                className="min-h-[var(--target-mobile)] rounded-[var(--radius-control)] border border-[var(--color-border)] bg-white px-3"
                value={mapping[key] ?? ''}
                onChange={(event) =>
                  setMapping((current) => ({ ...current, [key]: event.target.value || undefined }))
                }
              >
                <option value="">Not mapped</option>
                {headers.map((header) => (
                  <option key={header} value={header}>
                    {header}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <button
            className="min-h-[var(--target-mobile)] rounded-[var(--radius-control)] bg-[var(--color-primary)] px-4 font-bold text-[var(--color-primary-foreground)] sm:col-span-2"
            type="button"
            disabled={busy}
            onClick={generatePreview}
          >
            {busy ? 'Preparing preview…' : 'Preview import'}
          </button>
        </fieldset>
      ) : null}

      <p role="status" aria-live="polite" className="text-sm text-[var(--color-text-muted)]">
        {message}
      </p>

      {preview ? (
        <div className="overflow-x-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
          <table className="w-full min-w-[44rem] text-left text-sm">
            <caption className="p-4 text-left font-bold">Import preview</caption>
            <thead>
              <tr className="border-y border-[var(--color-border)]">
                <th className="p-3">Import</th>
                <th className="p-3">Row</th>
                <th className="p-3">Athlete</th>
                <th className="p-3">Birth date</th>
                <th className="p-3">Status</th>
                <th className="p-3">Issues</th>
              </tr>
            </thead>
            <tbody>
              {preview.rows.map((row) => (
                <tr key={row.row} className="border-b border-[var(--color-border)] align-top">
                  <td className="p-3">
                    <input
                      aria-label={`Import row ${row.row}`}
                      type="checkbox"
                      className="size-6"
                      disabled={row.status !== 'valid'}
                      checked={selected.has(row.row)}
                      onChange={(event) =>
                        setSelected((current) => {
                          const next = new Set(current);
                          if (event.target.checked) next.add(row.row);
                          else next.delete(row.row);
                          return next;
                        })
                      }
                    />
                  </td>
                  <td className="p-3 font-mono">{row.row}</td>
                  <td className="p-3">
                    {row.athlete.givenName} {row.athlete.familyName}
                  </td>
                  <td className="p-3">{row.athlete.birthDate}</td>
                  <td className="p-3 font-bold">{row.status.replaceAll('_', ' ')}</td>
                  <td className="p-3">
                    {row.errors.length
                      ? row.errors.join(', ')
                      : row.duplicateCandidateIds.length
                        ? 'Potential duplicate—review separately'
                        : 'Ready'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex flex-wrap items-center justify-between gap-3 p-4">
            <p>
              {selected.size} of {validRows.length} valid rows selected
            </p>
            <div className="flex flex-wrap gap-2">
              {preview.rows.some((row) => row.status !== 'valid') ? (
                <button
                  className="min-h-[var(--target-mobile)] rounded-[var(--radius-control)] border border-[var(--color-border)] px-4 font-bold"
                  type="button"
                  onClick={downloadInvalidRows}
                >
                  Download issues CSV
                </button>
              ) : null}
              <button
                className="min-h-[var(--target-mobile)] rounded-[var(--radius-control)] bg-[var(--color-primary)] px-4 font-bold text-[var(--color-primary-foreground)]"
                type="button"
                disabled={busy || selected.size === 0}
                onClick={commit}
              >
                Confirm import
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
