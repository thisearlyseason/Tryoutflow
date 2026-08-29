'use client';

import { useRef, useState, useTransition } from 'react';

export type CheckinSearchResult = {
  registrationId: string;
  athleteName: string;
  guardianName: string;
  divisionName: string;
  tryoutNumber: number | null;
  status: 'ready' | 'checked_in' | 'withdrawn' | 'cancelled' | 'missing_information';
};

export type CheckinOutcome =
  | 'checked_in'
  | 'already_checked_in'
  | 'number_conflict'
  | 'capacity'
  | 'withdrawn'
  | 'cancelled'
  | 'missing_information'
  | 'invalid_registration'
  | 'invalid_placement'
  | 'forbidden'
  | 'invalid_request'
  | 'exhausted'
  | 'conflict'
  | 'unexpected_error';

export type CheckinActionResult = {
  outcome: CheckinOutcome;
  receiptId?: string;
  checkedInAt?: string;
  assignedNumber?: number;
  nextAvailable?: number;
};

export type CheckinSearchResponse =
  | CheckinSearchResult[]
  | {
      outcome: 'ok' | 'rate_limited' | 'forbidden' | 'invalid_request' | 'unexpected_error';
      results: CheckinSearchResult[];
    };

const failureMessages: Record<
  Exclude<CheckinOutcome, 'checked_in' | 'already_checked_in'>,
  string
> = {
  number_conflict: 'That number is already active.',
  capacity: 'That placement is at capacity.',
  withdrawn: 'This registration was withdrawn.',
  cancelled: 'This registration was cancelled.',
  missing_information: 'Required registration information is missing.',
  invalid_registration: 'That registration is not eligible for this placement.',
  invalid_placement: 'That session or group is no longer available.',
  forbidden: 'You are not authorized for that placement.',
  invalid_request: 'The check-in request is invalid.',
  exhausted: 'No tryout numbers are available in this scope.',
  conflict: 'This retry key belongs to a different check-in request.',
  unexpected_error: 'The service could not complete the check-in. Try again.',
};

export function CheckinWorkspace({
  search,
  onCheckIn,
  placements = [],
}: {
  search: (
    query: string,
    placement?: { sessionId: string; groupId?: string },
  ) => Promise<CheckinSearchResponse>;
  onCheckIn: (input: {
    registrationId: string;
    sessionId?: string;
    groupId?: string;
    requestedNumber?: number;
    requestKey: string;
    numberScope: 'session' | 'group';
  }) => Promise<CheckinActionResult>;
  placements?: {
    sessionId: string;
    sessionName: string;
    groupId?: string;
    groupName?: string;
    numberScope?: 'session' | 'group';
  }[];
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CheckinSearchResult[] | null>(null);
  const [message, setMessage] = useState('Search for a registration to begin.');
  const [placementIndex, setPlacementIndex] = useState(0);
  const [requestedNumber, setRequestedNumber] = useState('');
  const [pending, startTransition] = useTransition();
  const requestKeys = useRef(new Map<string, string>());
  const inFlightRequests = useRef(new Set<string>());

  function runSearch() {
    const bounded = query.trim();
    if (bounded.length < 2 || bounded.length > 120) {
      setMessage('Enter between 2 and 120 characters.');
      return;
    }
    startTransition(async () => {
      try {
        const placement = placements[placementIndex];
        const response = await search(
          bounded,
          placement ? { sessionId: placement.sessionId, groupId: placement.groupId } : undefined,
        );
        const outcome = Array.isArray(response) ? 'ok' : response.outcome;
        const matches = Array.isArray(response) ? response : response.results;
        if (outcome !== 'ok') {
          setResults(null);
          setMessage(
            outcome === 'rate_limited'
              ? 'Too many searches. Wait a minute and try again.'
              : outcome === 'forbidden'
                ? 'You are not authorized for that placement.'
                : outcome === 'unexpected_error'
                  ? 'Search service is temporarily unavailable. Try again.'
                  : 'Search request is invalid.',
          );
          return;
        }
        setResults(matches);
        setMessage(
          matches.length === 0 ? 'No matching registrations.' : `${matches.length} found.`,
        );
      } catch {
        setResults(null);
        setMessage('Search could not be completed. Try again.');
      }
    });
  }

  function checkIn(result: CheckinSearchResult) {
    const placement = placements[placementIndex];
    const requestPayload = JSON.stringify([
      result.registrationId,
      placement?.sessionId ?? null,
      placement?.groupId ?? null,
      requestedNumber === '' ? null : Number(requestedNumber),
    ]);
    if (inFlightRequests.current.has(requestPayload)) return;
    inFlightRequests.current.add(requestPayload);
    startTransition(async () => {
      try {
        let requestKey = requestKeys.current.get(requestPayload);
        if (!requestKey) {
          requestKey = crypto.randomUUID();
          requestKeys.current.set(requestPayload, requestKey);
        }
        const receipt = await onCheckIn({
          registrationId: result.registrationId,
          sessionId: placement?.sessionId,
          groupId: placement?.groupId,
          requestedNumber: requestedNumber === '' ? undefined : Number(requestedNumber),
          requestKey,
          numberScope: placement?.numberScope ?? (placement?.groupId ? 'group' : 'session'),
        });
        if (receipt.outcome !== 'unexpected_error') requestKeys.current.delete(requestPayload);
        if (receipt.outcome !== 'checked_in' && receipt.outcome !== 'already_checked_in') {
          const suffix =
            receipt.outcome === 'number_conflict' && receipt.nextAvailable
              ? ` Try #${receipt.nextAvailable}.`
              : '';
          setMessage(`${failureMessages[receipt.outcome]}${suffix}`);
          return;
        }
        const repeat = receipt.outcome === 'already_checked_in';
        const number = receipt.assignedNumber ? ` #${receipt.assignedNumber}.` : '';
        setMessage(
          repeat
            ? `${result.athleteName} was already checked in.${number}`
            : `${result.athleteName} checked in.${number}`,
        );
        setResults(
          (current) =>
            current?.map((row) =>
              row.registrationId === result.registrationId ? { ...row, status: 'checked_in' } : row,
            ) ?? null,
        );
      } catch {
        setMessage(
          `The check-in request for ${result.athleteName} could not be confirmed. Try again.`,
        );
      } finally {
        inFlightRequests.current.delete(requestPayload);
      }
    });
  }

  return (
    <div className="grid min-w-0 gap-5">
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <label className="block font-bold" htmlFor="checkin-search">
          Search registrations
        </label>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          Athlete, guardian, registration ID, permitted phone, QR, or tryout number
        </p>
        <div className="mt-3 flex min-w-0 flex-col gap-2 sm:flex-row">
          <input
            autoComplete="off"
            className="min-h-[44px] min-w-0 flex-1 rounded-lg border border-[var(--color-border)] px-3"
            id="checkin-search"
            maxLength={120}
            onChange={(event) => setQuery(event.target.value)}
            style={{ minHeight: 44 }}
            value={query}
          />
          <button
            className="min-h-[44px] rounded-lg bg-[var(--color-primary)] px-5 font-bold text-[var(--color-primary-foreground)] disabled:opacity-60"
            disabled={pending}
            onClick={runSearch}
            style={{ minHeight: 44 }}
            type="button"
          >
            {pending ? 'Searching…' : 'Search'}
          </button>
        </div>
      </div>
      {placements.length > 0 ? (
        <div className="grid gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 sm:grid-cols-2">
          <label className="grid gap-1 font-bold">
            Session and group
            <select
              className="min-h-[44px] min-w-0 rounded-lg border border-[var(--color-border)] px-3 font-normal"
              onChange={(event) => setPlacementIndex(Number(event.target.value))}
              style={{ height: 44, minHeight: 44 }}
              value={placementIndex}
            >
              {placements.map((placement, index) => (
                <option key={`${placement.sessionId}:${placement.groupId ?? ''}`} value={index}>
                  {placement.sessionName}
                  {placement.groupName ? ` · ${placement.groupName}` : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 font-bold">
            Requested number (optional)
            <input
              className="min-h-[44px] min-w-0 rounded-lg border border-[var(--color-border)] px-3 font-normal"
              inputMode="numeric"
              max={9999}
              min={1}
              onChange={(event) => setRequestedNumber(event.target.value)}
              style={{ minHeight: 44 }}
              type="number"
              value={requestedNumber}
            />
          </label>
        </div>
      ) : null}
      <p aria-live="polite" className="text-sm text-[var(--color-text-muted)]" role="status">
        {message}
      </p>
      {results ? (
        <ul className="grid min-w-0 gap-3">
          {results.map((result) => (
            <li
              className="grid min-w-0 gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 sm:grid-cols-[1fr_auto] sm:items-center"
              key={result.registrationId}
            >
              <div className="min-w-0">
                <h3 className="break-words font-bold">{result.athleteName}</h3>
                <p className="break-words text-sm text-[var(--color-text-muted)]">
                  {result.guardianName} · {result.divisionName} · {result.registrationId}
                </p>
                <p className="mt-1 text-sm">
                  {result.tryoutNumber ? `#${result.tryoutNumber}` : 'Number not assigned'} ·{' '}
                  {result.status.replace('_', ' ')}
                </p>
              </div>
              <button
                className="min-h-[44px] rounded-lg border border-[var(--color-primary)] px-5 font-bold text-[var(--color-primary)] disabled:opacity-60"
                disabled={
                  pending ||
                  result.status === 'withdrawn' ||
                  result.status === 'cancelled' ||
                  result.status === 'missing_information'
                }
                onClick={() => checkIn(result)}
                style={{ minHeight: 44 }}
                type="button"
              >
                {result.status === 'checked_in'
                  ? `Confirm ${result.athleteName} again`
                  : `Check in ${result.athleteName}`}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
