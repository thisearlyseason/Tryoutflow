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
type ReviewedRosterExportPreview = RosterExportPreview & Readonly<{ sourceDigest: string }>;
type PreviewResult = ({ outcome: 'previewed' } & ReviewedRosterExportPreview) | { outcome: string };
type JobView = Readonly<{
  id: string;
  state:
    | 'pending'
    | 'processing'
    | 'completed'
    | 'partially_completed'
    | 'failed'
    | 'needs_attention'
    | 'cancelled';
  completedCount: number;
  skippedCount: number;
  failedCount: number;
  retryEligibleCount: number;
}>;
type ConfirmResult = {
  outcome: string;
  jobId?: string;
  state?: string;
  completedCount?: number;
  skippedCount?: number;
  failedCount?: number;
  retryEligibleCount?: number;
};
type RetryResult =
  | {
      outcome: 'queued' | 'replayed' | 'nothing_to_retry' | 'manual_attention_required';
      jobId: string;
      state: string;
      retriedItemCount: number;
      preservedCompletedItemCount: number;
      preservedSkippedItemCount: number;
      completedCount: number;
      skippedCount: number;
      failedCount: number;
      retryEligibleCount: number;
    }
  | {
      outcome: 'invalid_input' | 'forbidden' | 'not_found' | 'conflict' | 'unavailable';
    };

const jobStates = new Set<JobView['state']>([
  'pending',
  'processing',
  'completed',
  'partially_completed',
  'failed',
  'needs_attention',
  'cancelled',
]);

function isJobState(value: string | undefined): value is JobView['state'] {
  return value !== undefined && jobStates.has(value as JobView['state']);
}

function isNonnegativeInteger(value: number | undefined): value is number {
  return value !== undefined && Number.isInteger(value) && value >= 0;
}

type RosterExportWizardProps = Readonly<{
  rosterVersionId: string;
  destinations: readonly ExternalRosterDestination[];
  onPreview(input: {
    destination: ExternalRosterDestination;
    approvedFields: readonly Field[];
  }): Promise<PreviewResult>;
  onConfirm(input: {
    previewId: string;
    sourceDigest: string;
    confirmationToken: string;
  }): Promise<ConfirmResult>;
  onRetry(jobId: string): Promise<RetryResult>;
  initialJob?: JobView;
  availabilityMessage?: string;
}>;

export function RosterExportWizard({
  rosterVersionId,
  destinations,
  onPreview,
  onConfirm,
  onRetry,
  initialJob,
  availabilityMessage,
}: RosterExportWizardProps) {
  const [destinationId, setDestinationId] = useState('');
  const [approvedFields, setApprovedFields] = useState<Field[]>([]);
  const [preview, setPreview] = useState<ReviewedRosterExportPreview | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [job, setJob] = useState<JobView | null>(initialJob ?? null);
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
    try {
      const result = await onPreview({ destination, approvedFields });
      if (result.outcome === 'previewed' && 'previewId' in result) {
        const { outcome: _outcome, ...nextPreview } = result;
        setPreview(nextPreview);
        setReviewed(false);
        setMessage('Preview ready. Review the exact destination and approved fields.');
        return;
      }
      setMessage('Preview could not be created. Refresh and review the connection and roster.');
    } catch {
      setMessage('Preview could not be created. Refresh and review the connection and roster.');
    } finally {
      setPending(false);
    }
  };

  const confirm = async () => {
    if (!preview || !reviewed) return;
    setPending(true);
    try {
      const result = await onConfirm({
        previewId: preview.previewId,
        sourceDigest: preview.sourceDigest,
        confirmationToken: preview.confirmationToken,
      });
      if (['queued', 'replayed', 'completed'].includes(result.outcome) && result.jobId) {
        if (!isJobState(result.state)) {
          setMessage('The durable job returned an invalid state. Refresh before taking action.');
          return;
        }
        setJob({
          id: result.jobId,
          state: result.state,
          completedCount: result.completedCount ?? 0,
          skippedCount: result.skippedCount ?? 0,
          failedCount: result.failedCount ?? 0,
          retryEligibleCount: result.retryEligibleCount ?? 0,
        });
        setMessage(
          result.outcome === 'completed'
            ? 'Export completed with no transfer because the finalized roster is empty.'
            : 'Export queued. The result history remains available if this page is refreshed.',
        );
        return;
      }
      setMessage('Confirmation was stale or conflicted. Create and review a new preview.');
      setPreview(null);
      setReviewed(false);
    } catch {
      setMessage('Confirmation could not be completed. Refresh and create a new preview.');
    } finally {
      setPending(false);
    }
  };

  const retry = async () => {
    if (!job) return;
    setPending(true);
    try {
      const result = await onRetry(job.id);
      if (
        result.outcome === 'queued' ||
        result.outcome === 'replayed' ||
        result.outcome === 'nothing_to_retry' ||
        result.outcome === 'manual_attention_required'
      ) {
        if (
          typeof result.jobId === 'string' &&
          result.jobId.length > 0 &&
          result.jobId !== job.id
        ) {
          setMessage(
            'The durable retry returned an invalid projection. Refresh before taking action.',
          );
          return;
        }
        if (
          typeof result.jobId !== 'string' ||
          result.jobId.length === 0 ||
          !isJobState(result.state) ||
          !isNonnegativeInteger(result.retriedItemCount) ||
          !isNonnegativeInteger(result.preservedCompletedItemCount) ||
          !isNonnegativeInteger(result.preservedSkippedItemCount) ||
          !isNonnegativeInteger(result.completedCount) ||
          !isNonnegativeInteger(result.skippedCount) ||
          !isNonnegativeInteger(result.failedCount) ||
          !isNonnegativeInteger(result.retryEligibleCount) ||
          ((result.outcome === 'queued' || result.outcome === 'replayed') &&
            result.retriedItemCount === 0) ||
          ((result.outcome === 'nothing_to_retry' ||
            result.outcome === 'manual_attention_required') &&
            result.retriedItemCount !== 0)
        ) {
          setJob(null);
          setMessage(
            'The durable retry returned an invalid projection. Refresh before taking action.',
          );
          return;
        }
        setJob({
          id: result.jobId,
          state: result.state,
          completedCount: result.completedCount,
          skippedCount: result.skippedCount,
          failedCount: result.failedCount,
          retryEligibleCount: result.retryEligibleCount,
        });
      }
      setMessage(
        result.outcome === 'manual_attention_required'
          ? 'Delivery is uncertain. Manual attention is required; retry is disabled.'
          : result.outcome === 'queued' || result.outcome === 'replayed'
            ? 'Retry queued for failed or reviewable items only. Completed items were preserved.'
            : 'No retryable items were changed.',
      );
    } catch {
      setMessage('Retry could not be queued. Refresh the durable job status and try again.');
    } finally {
      setPending(false);
    }
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
        {availabilityMessage ? (
          <p className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-3 font-semibold text-amber-950">
            {availabilityMessage}
          </p>
        ) : null}
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
                <dl className="mt-2 grid gap-1 text-sm text-slate-700">
                  {Object.entries(item.fields).map(([field, value]) => (
                    <div key={field}>
                      <dt className="inline font-semibold">
                        {field
                          .replace(/([A-Z])/gu, ' $1')
                          .replace(/^./u, (letter) => letter.toUpperCase())}
                        :{' '}
                      </dt>
                      <dd className="inline">{String(value)}</dd>
                    </div>
                  ))}
                </dl>
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

      {job ? (
        <section
          aria-labelledby="job-heading"
          className="rounded-3xl border border-slate-200 bg-white p-6"
        >
          <h2 id="job-heading" className="text-xl font-black text-slate-950">
            Latest durable job
          </h2>
          <p className="mt-2" role="status">
            {job.completedCount} completed · {job.skippedCount} skipped · {job.failedCount}{' '}
            failed/reviewable · {job.state.replaceAll('_', ' ')}
          </p>
          {job.state === 'needs_attention' ? (
            <p className="mt-3 font-semibold text-amber-900">
              Delivery is uncertain. Manual attention is required; retry is disabled to prevent a
              duplicate external transfer.
            </p>
          ) : job.retryEligibleCount > 0 ? (
            <button
              type="button"
              disabled={pending}
              onClick={retry}
              className="mt-4 min-h-11 rounded-xl border-2 border-coral-600 px-5 py-3 font-bold text-coral-800"
            >
              Retry {job.retryEligibleCount} failed item
              {job.retryEligibleCount === 1 ? '' : 's'}
            </button>
          ) : job.failedCount > 0 ? (
            <p className="mt-3 font-semibold text-amber-900">
              These items are not safe for automatic retry. Review them manually.
            </p>
          ) : null}
        </section>
      ) : null}

      <p aria-live="polite" className="min-h-6 font-semibold text-slate-800">
        {message}
      </p>
    </section>
  );
}
