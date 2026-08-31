'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

import { EmptyState } from '../../../components/feedback/empty-state';
import type { RankingPage } from '../application/list-rankings';

type RankingFilterValues = Readonly<{
  divisionId?: string;
  positionId?: string;
  sessionId?: string;
  groupId?: string;
  completion?: 'all' | 'complete' | 'incomplete' | 'unscored';
  minimumEvaluators?: number;
  search?: string;
}>;

function formatSnapshotTimestamp(value: string) {
  return new Date(value)
    .toISOString()
    .replace('T', ' ')
    .replace(/\.\d{3}Z$/u, ' UTC');
}

export function RankingsWorkspace({
  initial,
  compareHref = './compare',
  filters = {},
}: {
  initial: RankingPage;
  compareHref?: string;
  filters?: RankingFilterValues;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const comparisonHref = useMemo(
    () => `${compareHref}?athletes=${selected.join(',')}`,
    [compareHref, selected],
  );
  const divisions = initial.filterOptions.divisions.map(({ id, name }) => [id, name] as const);
  const positions = initial.filterOptions.positions.map(({ id, name }) => [id, name] as const);
  const sessions = initial.filterOptions.sessions.map(({ id, name }) => [id, name] as const);
  const groups = initial.filterOptions.groups.map(({ id, name }) => [id, name] as const);
  const filterQuery = new URLSearchParams();
  if (filters.divisionId) filterQuery.set('division', filters.divisionId);
  if (filters.positionId) filterQuery.set('position', filters.positionId);
  if (filters.sessionId) filterQuery.set('session', filters.sessionId);
  if (filters.groupId) filterQuery.set('group', filters.groupId);
  if (filters.completion && filters.completion !== 'all')
    filterQuery.set('completion', filters.completion);
  if (filters.minimumEvaluators) {
    filterQuery.set('minimumEvaluators', String(filters.minimumEvaluators));
  }
  if (filters.search) filterQuery.set('search', filters.search);
  filterQuery.set('pageSize', String(initial.pageSize));
  const pageHref = (page: number) => {
    const query = new URLSearchParams(filterQuery);
    query.set('page', String(page));
    return `?${query.toString()}`;
  };
  return (
    <div className="min-w-0 space-y-5">
      <form className="grid gap-3 rounded-[var(--radius-surface)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 sm:grid-cols-2 lg:grid-cols-4">
        <input name="pageSize" type="hidden" value={initial.pageSize} />
        <label className="grid gap-1 text-sm font-medium">
          Search athletes
          <input
            className="min-h-11 rounded-[var(--radius-control)] border border-[var(--color-border)] px-3"
            defaultValue={filters.search ?? ''}
            name="search"
            type="search"
          />
        </label>
        {[
          ['Division', 'division', divisions],
          ['Position', 'position', positions],
          ['Session', 'session', sessions],
          ['Group', 'group', groups],
        ].map(([label, name, options]) => (
          <label className="grid gap-1 text-sm font-medium" key={name as string}>
            {label as string}
            <select
              className="min-h-11 rounded-[var(--radius-control)] border border-[var(--color-border)] px-3"
              name={name as string}
              defaultValue={
                name === 'division'
                  ? filters.divisionId
                  : name === 'position'
                    ? filters.positionId
                    : name === 'session'
                      ? filters.sessionId
                      : filters.groupId
              }
            >
              <option value="">All</option>
              {(options as [string, string][]).map(([id, optionLabel]) => (
                <option key={id} value={id}>
                  {optionLabel}
                </option>
              ))}
            </select>
          </label>
        ))}
        <label className="grid gap-1 text-sm font-medium">
          Completion
          <select
            className="min-h-11 rounded-[var(--radius-control)] border border-[var(--color-border)] px-3"
            defaultValue={filters.completion ?? 'all'}
            name="completion"
          >
            <option value="all">All coverage</option>
            <option value="complete">Complete</option>
            <option value="incomplete">Partially complete</option>
            <option value="unscored">No completed evaluations</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm font-medium">
          Minimum completed evaluations
          <input
            className="min-h-11 rounded-[var(--radius-control)] border border-[var(--color-border)] px-3"
            defaultValue={String(filters.minimumEvaluators ?? 0)}
            max="1000"
            min="0"
            name="minimumEvaluators"
            type="number"
          />
        </label>
        <button className="min-h-11 self-end rounded-[var(--radius-control)] bg-[var(--color-primary)] px-4 font-bold text-white">
          Apply filters
        </button>
        <Link
          className="inline-flex min-h-11 items-center self-end font-bold"
          href={`?pageSize=${initial.pageSize}`}
        >
          Clear filters
        </Link>
      </form>

      {initial.rows.length === 0 ? (
        <EmptyState
          description="Adjust the filters or wait for completed evaluations. Incomplete work is never scored as zero."
          title="No ranking evidence yet"
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-[var(--color-text-muted)]" role="status">
              {initial.total} athletes · snapshot {formatSnapshotTimestamp(initial.generatedAt)}
            </p>
            <Link
              aria-disabled={selected.length < 2}
              className="inline-flex min-h-11 items-center rounded-[var(--radius-control)] border border-[var(--color-primary)] px-4 font-bold aria-disabled:pointer-events-none aria-disabled:opacity-50"
              href={comparisonHref}
            >
              Compare selected ({selected.length}/4)
            </Link>
          </div>

          <ol className="grid gap-3">
            {initial.rows.map((row) => {
              const checked = selected.includes(row.athleteId);
              return (
                <li
                  className="min-w-0 rounded-[var(--radius-surface)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-surface)]"
                  key={row.registrationId}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 gap-3">
                      <span className="font-[var(--font-bib)] text-3xl tabular-nums">
                        {row.rank ?? '—'}
                      </span>
                      <div className="min-w-0">
                        <h2 className="truncate text-lg font-bold">{row.displayName}</h2>
                        <p className="text-sm text-[var(--color-text-muted)]">
                          {row.tryoutNumber ? `#${row.tryoutNumber} · ` : ''}
                          {row.divisionName}
                          {row.positionName ? ` · ${row.positionName}` : ''}
                        </p>
                        {row.isTied && row.rank ? (
                          <p className="mt-1 text-sm font-bold text-[var(--color-primary)]">
                            Tied at rank {row.rank}
                          </p>
                        ) : null}
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-[var(--font-bib)] text-3xl tabular-nums">
                        {row.overall ?? 'Unranked'}
                      </p>
                      <p className="text-xs text-[var(--color-text-muted)]">overall / 100</p>
                    </div>
                  </div>
                  <div className="mt-4 grid gap-2 border-t border-[var(--color-border)] pt-3 text-sm sm:grid-cols-3">
                    <p>
                      <strong>
                        {row.completedEvaluators} of {row.expectedEvaluators}
                      </strong>{' '}
                      evaluations complete
                    </p>
                    <p>
                      Coverage <strong>{row.completionPercent}%</strong>
                    </p>
                    <p>
                      Range{' '}
                      <strong>{row.scoreRange ? row.scoreRange.join('–') : 'Not available'}</strong>
                    </p>
                  </div>
                  <label className="mt-3 inline-flex min-h-11 cursor-pointer items-center gap-2 font-medium">
                    <input
                      checked={checked}
                      disabled={!checked && selected.length === 4}
                      onChange={() =>
                        setSelected((current) =>
                          checked
                            ? current.filter((id) => id !== row.athleteId)
                            : [...current, row.athleteId],
                        )
                      }
                      type="checkbox"
                    />
                    Select {row.displayName} for comparison
                  </label>
                </li>
              );
            })}
          </ol>
          {initial.totalPages > 1 ? (
            <nav aria-label="Ranking pages" className="flex items-center justify-between gap-3">
              {initial.page > 1 ? (
                <Link
                  className="inline-flex min-h-11 items-center font-bold"
                  href={pageHref(initial.page - 1)}
                >
                  Previous page
                </Link>
              ) : (
                <span />
              )}
              <span className="text-sm text-[var(--color-text-muted)]">
                Page {initial.page} of {initial.totalPages}
              </span>
              {initial.page < initial.totalPages ? (
                <Link
                  className="inline-flex min-h-11 items-center font-bold"
                  href={pageHref(initial.page + 1)}
                >
                  Next page
                </Link>
              ) : (
                <span />
              )}
            </nav>
          ) : null}
        </>
      )}
    </div>
  );
}
