'use client';

import { useState } from 'react';

import type { ExternalRosterDestination, RosterExportPreview } from '../domain/contracts';

const fieldOptions = [
  ['first_name', 'First name'],
  ['last_name', 'Last name'],
  ['email', 'Email'],
  ['phone', 'Phone'],
  ['position', 'Position'],
  ['team_name', 'Team name'],
  ['tryout_number', 'Tryout number'],
] as const;

type Field = (typeof fieldOptions)[number][0];
type PreviewResult = ({ outcome: 'previewed' } & RosterExportPreview) | { outcome: string };
type ConfirmResult = { outcome: string; jobId?: string };
type RetryResult = { outcome: string; jobId?: string };

type RosterExportWizardProps = Readonly<{
  rosterVersionId: string;
  destinations: readonly ExternalRosterDestination[];
  onPreview(input: {
    destination: ExternalRosterDestination;
    approvedFields: readonly Field[];
  }): Promise<PreviewResult>;
  onConfirm(input: { previewId: string; confirmationToken: string }): Promise<ConfirmResult>;
  onRetry(jobId: string): Promise<RetryResult>;
  initialJob?: Readonly<{
    id: string;
    state:
      'pending' | 'processing' | 'completed' | 'partially_completed' | 'failed' | 'needs_attention';
    completedCount: number;
    failedCount: number;
  }>;
}>;

export function RosterExportWizard({
  rosterVersionId,
  destinations,
  onPreview,
  onConfirm,
  onRetry,
  initialJob,
}: RosterExportWizardProps) {
  const [destinationId, setDestinationId] = useState('');
  const [approvedFields, setApprovedFields] = useState<Field[]>([]);
  const [preview, setPreview] = useState<RosterExportPreview | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [jobId, setJobId] = useState(initialJob?.id ?? null);
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);

  const destination = destinations.find((item) => item.team.externalId === destinationId);
  const toggleField = (field: Field) => {
    setApprovedFields((current) =>
      current.includes(field) ? current.filter((item) => item !== field) : [...current, field],
    );
    setPreview(null);
    setReviewed(false);
  };

  const requestPreview = async () => {
    if (!destination || approvedFields.length === 0) return;
    setPending(true);
    setMessage('');
    const result = await onPreview({ destination, approvedFields });
    setPending(false);
    if (result.outcome === 'previewed' && 'previewId' in result) {
      const { outcome: _outcome, ...nextPreview } = result;
      setPreview(nextPreview);
      setReviewed(false);
      setMessage('Preview ready. Review the exact destination and approved fields.');
    } else {
      setMessage('Preview could not be created. Refresh and review the connection and roster.');
    }
  };

  const confirm = async () => {
    if (!preview || !reviewed) return;
    setPending(true);
    const result = await onConfirm({
      previewId: preview.previewId,
      confirmationToken: preview.confirmationToken,
    });
    setPending(false);
    if ((result.outcome === 'queued' || result.outcome === 'replayed') && result.jobId) {
      setJobId(result.jobId);
      setMessage('Export queued. The result history remains available if this page is refreshed.');
    } else {
      setMessage('Confirmation was stale or conflicted. Create and review a new preview.');
      setPreview(null);
      setReviewed(false);
    }
  };

  const retry = async () => {
    if (!jobId) return;
    setPending(true);
    const result = await onRetry(jobId);
    setPending(false);
    setMessage(
      result.outcome === 'queued' || result.outcome === 'replayed'
        ? 'Retry queued for failed or reviewable items only. Completed items were preserved.'
        : 'No retryable items were changed.',
    );
  };

  return (
    <section aria-labelledby="export-heading" className="space-y-6">
      <header>
        <p className="text-sm font-bold uppercase tracking-[0.16em] text-coral-700">
          The Squad · demo/mock only
        </p>
        <h1 id="export-heading" className="mt-2 text-3xl font-black tracking-tight text-slate-950">
          Export finalized roster
        </h1>
        <p className="mt-2 text-slate-700">
          Roster version <span className="font-mono text-sm">{rosterVersionId}</span> stays distinct
          from selection, decisions, and finalization.
        </p>
      </header>

      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <label htmlFor="external-destination" className="block font-bold text-slate-950">
          External destination
        </label>
        <select
          id="external-destination"
          value={destinationId}
          onChange={(event) => {
            setDestinationId(event.target.value);
            setPreview(null);
            setReviewed(false);
          }}
          className="mt-2 min-h-11 w-full rounded-xl border border-slate-400 bg-white px-3 py-2"
        >
          <option value="">Choose a demo/mock destination</option>
          {destinations.map((item) => (
            <option key={item.team.externalId} value={item.team.externalId}>
              {item.displayLabel}
            </option>
          ))}
        </select>

        <fieldset className="mt-6">
          <legend className="font-bold text-slate-950">Approved fields</legend>
          <p className="mt-1 text-sm text-slate-600">
            Only checked fields are projected into the provider preview and confirmed payload.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {fieldOptions.map(([value, label]) => (
              <label
                key={value}
                className="flex min-h-11 items-center gap-3 rounded-xl border border-slate-200 px-3 py-2"
              >
                <input
                  type="checkbox"
                  checked={approvedFields.includes(value)}
                  onChange={() => toggleField(value)}
                  className="size-5"
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <button
          type="button"
          disabled={pending || !destination || approvedFields.length === 0}
          onClick={requestPreview}
          className="mt-6 min-h-11 rounded-xl bg-blue-700 px-5 py-3 font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-400"
        >
          {pending ? 'Working…' : 'Preview export'}
        </button>
      </div>

      {preview ? (
        <section
          aria-labelledby="review-heading"
          className="rounded-3xl border-2 border-blue-300 bg-blue-50 p-6"
        >
          <h2 id="review-heading" className="text-2xl font-black text-slate-950">
            Review {preview.totalItems} athletes
          </h2>
          <p className="mt-2 text-slate-700">
            Confirming sends only the approved fields to {destination?.displayLabel}. This remains
            synthetic demo/mock behavior.
          </p>
          <ul className="mt-4 space-y-2">
            {preview.items.map((item) => (
              <li key={item.itemKey} className="rounded-xl bg-white px-4 py-3">
                <span className="font-bold">{item.displayLabel}</span>{' '}
                <span className="text-sm text-slate-600">· {item.operation}</span>
              </li>
            ))}
          </ul>
          <label className="mt-5 flex min-h-11 items-center gap-3 font-semibold">
            <input
              type="checkbox"
              checked={reviewed}
              onChange={(event) => setReviewed(event.target.checked)}
              className="size-5"
            />
            I reviewed the exact destination and fields
          </label>
          <button
            type="button"
            disabled={pending || !reviewed}
            onClick={confirm}
            className="mt-4 min-h-11 rounded-xl bg-slate-950 px-5 py-3 font-bold text-white disabled:bg-slate-400"
          >
            Confirm and queue export
          </button>
        </section>
      ) : null}

      {initialJob ? (
        <section
          aria-labelledby="job-heading"
          className="rounded-3xl border border-slate-200 bg-white p-6"
        >
          <h2 id="job-heading" className="text-xl font-black text-slate-950">
            Latest durable job
          </h2>
          <p className="mt-2" role="status">
            {initialJob.completedCount} completed · {initialJob.failedCount} failed/reviewable ·{' '}
            {initialJob.state.replaceAll('_', ' ')}
          </p>
          {initialJob.failedCount > 0 ? (
            <button
              type="button"
              disabled={pending}
              onClick={retry}
              className="mt-4 min-h-11 rounded-xl border-2 border-coral-600 px-5 py-3 font-bold text-coral-800"
            >
              Retry {initialJob.failedCount} failed item{initialJob.failedCount === 1 ? '' : 's'}
            </button>
          ) : null}
        </section>
      ) : null}

      <p aria-live="polite" className="min-h-6 font-semibold text-slate-800">
        {message}
      </p>
    </section>
  );
}
