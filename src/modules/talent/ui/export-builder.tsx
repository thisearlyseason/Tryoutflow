'use client';

import { FeedbackButton } from '@/components/ui/button';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  startPerformanceExport,
  getPerformanceExport,
  retryPerformanceExport,
} from '../application/export-actions';
export function ExportBuilder({
  slug,
  sessions,
  metrics,
}: {
  slug: string;
  sessions: { id: string; name: string }[];
  metrics: { id: string; name: string }[];
}) {
  const [id, setId] = useState('');
  const [message, setMessage] = useState('');
  const [state, setState] = useState('');
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<number | null>(null);
  const requesting = useRef(false);
  const retrying = useRef(false);
  const [retryBusy, setRetryBusy] = useState(false);
  useEffect(() => {
    if (!id || state === 'ready' || state === 'failed') return;
    let active = true;
    let attempts = 0;
    const timer = setInterval(async () => {
      attempts++;
      try {
        const r = await getPerformanceExport(slug, id);
        if (active && r) {
          setState(r.state);
          setRows(r.rows);
          setMessage(
            r.message ||
              (r.state === 'ready'
                ? 'Ready to download. Link expires in 24 hours.'
                : 'Preparing export…'),
          );
        }
      } catch {
        if (active) setMessage('Status could not refresh. Try again.');
      }
      if (attempts >= 30) clearInterval(timer);
    }, 2000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [slug, id, state]);
  return (
    <section className="talent-stack">
      <form
        className="talent-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (requesting.current) return;
          requesting.current = true;
          setBusy(true);
          try {
            const r = await startPerformanceExport(
              slug,
              Object.fromEntries(new FormData(e.currentTarget)),
            );
            setMessage(r.message);
            if (r.ok && r.id) {
              setId(r.id);
              setState('queued');
            }
          } catch {
            setMessage('Export could not start. Retry.');
          } finally {
            requesting.current = false;
            setBusy(false);
          }
        }}
      >
        <div className="talent-form-grid">
          <label>
            From
            <input type="date" name="from" />
          </label>
          <label>
            Through
            <input type="date" name="to" />
          </label>
          <label>
            Session
            <select name="session">
              <option value="">All sessions</option>
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Metric
            <select name="metric">
              <option value="">All metrics</option>
              {metrics.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <FeedbackButton busy={busy} className="button-primary" disabled={busy}>
          {busy ? 'Requesting…' : 'Prepare CSV export'}
        </FeedbackButton>
      </form>
      <p role="status">{message}</p>
      {id && (
        <section className="talent-card">
          <p>
            Export {id} · {state} {rows !== null ? `· ${rows} trials` : ''}
          </p>
          {state === 'ready' ? (
            <Link className="button-primary" href={`/app/${slug}/reports/exports/${id}`}>
              Download CSV
            </Link>
          ) : (
            <FeedbackButton
              className="button-secondary"
              busy={retryBusy}
              disabled={busy || retryBusy}
              onClick={async () => {
                if (retrying.current) return;
                retrying.current = true;
                setRetryBusy(true);
                setMessage('Checking export preparation…');
                try {
                  await retryPerformanceExport(slug, id);
                  const r = await getPerformanceExport(slug, id);
                  if (r) {
                    setState(r.state);
                    setMessage(
                      r.message ||
                        (r.state === 'ready'
                          ? 'Ready to download. Link expires in 24 hours.'
                          : 'Preparing export…'),
                    );
                    setRows(r.rows);
                  } else {
                    setMessage('Export status could not load. Retry or refresh this page.');
                  }
                } catch {
                  setMessage('Could not check export preparation. Retry or refresh this page.');
                } finally {
                  retrying.current = false;
                  setRetryBusy(false);
                }
              }}
            >
              {retryBusy ? 'Checking…' : 'Retry / check status'}
            </FeedbackButton>
          )}
        </section>
      )}
    </section>
  );
}

export function ExportRetry({ slug, id }: { slug: string; id: string }) {
  const [message, setMessage] = useState('');
  const router = useRouter();
  const retrying = useRef(false);
  const [busy, setBusy] = useState(false);
  return (
    <div>
      <FeedbackButton
        className="button-secondary"
        busy={busy}
        disabled={busy}
        onClick={async () => {
          if (retrying.current) return;
          retrying.current = true;
          setBusy(true);
          setMessage('Requesting preparation…');
          try {
            await retryPerformanceExport(slug, id);
            setMessage('Preparation requested. Refresh this page to check progress.');
            router.refresh();
          } catch {
            setMessage('Could not retry. Refresh and try again.');
          } finally {
            retrying.current = false;
            setBusy(false);
          }
        }}
      >
        {busy ? 'Requesting…' : 'Retry preparation'}
      </FeedbackButton>
      <p role="status">{message}</p>
    </div>
  );
}
