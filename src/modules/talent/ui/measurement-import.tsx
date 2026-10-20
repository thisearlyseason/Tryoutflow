'use client';

import { FeedbackButton } from '@/components/ui/button';

import { useState } from 'react';
import Papa from 'papaparse';
import { resultSchema } from '../domain/schemas';
import { importMeasurements } from '../application/actions';
import type { Metric } from '../domain/performance';
export function MeasurementImport({
  slug,
  athletes,
  metrics,
  sessions,
}: {
  slug: string;
  athletes: { id: string; given_name: string; family_name: string }[];
  metrics: Metric[];
  sessions: { id: string; name: string }[];
}) {
  const [metric, setMetric] = useState('');
  const [session, setSession] = useState('');
  const [rows, setRows] = useState<
    { id: string; values: Record<string, unknown>; error: string }[]
  >([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  async function read(file: File | undefined) {
    setRows([]);
    setSaved(false);
    if (!file) return;
    if (file.size > 1024 * 1024) {
      setMessage('Choose a CSV smaller than 1 MB.');
      return;
    }
    const parsed = Papa.parse<Record<string, string>>(await file.text(), {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: (h) => h.trim().toLowerCase(),
    });
    if (parsed.errors.length || parsed.data.length > 500 || !parsed.data.length) {
      setMessage('Use a valid CSV with 1–500 rows and matching column counts.');
      return;
    }
    const next = parsed.data.map((row) => {
      const match = athletes.filter(
        (a) =>
          a.id === row.athlete_id ||
          (row.athlete &&
            `${a.given_name} ${a.family_name}`.toLowerCase() === row.athlete.trim().toLowerCase()),
      );
      const values = {
        athlete_id: match.length === 1 ? match[0]!.id : (row.athlete_id ?? ''),
        metric_id: metric,
        session_id: session,
        value: row.value ?? '',
        numerator: row.successes ?? '',
        denominator: row.attempts ?? '',
        status: row.status || 'valid',
        trial: row.trial || '1',
        measured_at: row.measured_at || '',
        source: row.source || '',
        verified: row.verified === 'true',
        note: row.note || '',
      };
      const validation = resultSchema.safeParse(values);
      return {
        id: crypto.randomUUID(),
        values,
        error:
          match.length !== 1
            ? 'Use a unique athlete name or athlete_id.'
            : validation.success
              ? ''
              : validation.error.issues.map((i) => `${String(i.path[0])}: ${i.message}`).join(' '),
      };
    });
    setRows(next);
    setMessage(
      `${next.length} rows ready for review. ${next.filter((r) => r.error).length} need correction.`,
    );
  }
  async function submit() {
    setBusy(true);
    try {
      const result = await importMeasurements(
        slug,
        rows.map(({ id, values }) => ({ id, values })),
      );
      setMessage(result.message);
      setSaved(result.ok);
    } catch {
      setMessage('Connection interrupted. Retry the same batch safely.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="talent-stack">
      <p>
        Import one metric per file. Required columns: <code>athlete_id</code> (or unique{' '}
        <code>athlete</code> name), <code>measured_at</code> (ISO timestamp with timezone),{' '}
        <code>source</code>, and <code>value</code>. For ratios use <code>successes</code> and{' '}
        <code>attempts</code>. Optional: trial, status, verified, note. Missing performance must use
        a status such as not_observed.
      </p>
      <div className="talent-form-grid">
        <label>
          Metric
          <select
            value={metric}
            disabled={busy}
            onChange={(e) => {
              setMetric(e.target.value);
              setRows([]);
            }}
          >
            <option value="">Choose metric</option>
            {metrics.map((m) => (
              <option key={m.id} value={m.id}>
                {m.sport} · {m.name} ({m.unit})
              </option>
            ))}
          </select>
        </label>
        <label>
          Session
          <select
            value={session}
            disabled={busy}
            onChange={(e) => {
              setSession(e.target.value);
              setRows([]);
            }}
          >
            <option value="">Independent observation</option>
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          CSV file
          <input
            type="file"
            accept=".csv,text/csv"
            disabled={!metric || busy}
            onChange={(e) => void read(e.target.files?.[0])}
          />
        </label>
      </div>
      {metrics.find((m) => m.id === metric)?.protocol && (
        <p>{metrics.find((m) => m.id === metric)?.protocol}</p>
      )}
      <p role="status">{message}</p>
      {rows.length > 0 && (
        <>
          <div className="talent-table">
            <table>
              <caption>Import preview — nothing saves until you import</caption>
              <thead>
                <tr>
                  <th>Row</th>
                  <th>Athlete</th>
                  <th>Result</th>
                  <th>Date</th>
                  <th>Validation</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.id}>
                    <td>{i + 2}</td>
                    <td>
                      {athletes.find((a) => a.id === r.values.athlete_id)?.given_name}{' '}
                      {athletes.find((a) => a.id === r.values.athlete_id)?.family_name}
                    </td>
                    <td>
                      {String(
                        r.values.status !== 'valid'
                          ? 'Not measured'
                          : r.values.value !== '' && r.values.value !== null
                            ? r.values.value
                            : `${r.values.numerator}/${r.values.denominator}`,
                      )}{' '}
                      · {String(r.values.status)}
                    </td>
                    <td>{String(r.values.measured_at)}</td>
                    <td>{r.error || 'Ready'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <FeedbackButton
            className="button-primary"
            disabled={busy || saved || rows.some((r) => r.error)}
            onClick={() => void submit()}
          >
            {busy ? 'Importing…' : saved ? 'Imported' : `Import ${rows.length} measurements`}
          </FeedbackButton>
        </>
      )}
    </section>
  );
}
