'use client';

import Link from 'next/link';
import { useId, useMemo, useState, type ReactNode } from 'react';

import { EmptyState } from '../../../components/feedback/empty-state';
import { BibBadge } from '../../../components/ui/bib-badge';
import { Button } from '../../../components/ui/button';
import { StatusBadge } from '../../../components/ui/status-badge';
import type { RankingPage } from '../application/list-rankings';

type RankingFilterValues = Readonly<{
  divisionId?: string;
  positionId?: string;
  sessionId?: string;
  groupId?: string;
  completion?: 'all' | 'complete' | 'incomplete' | 'unscored';
  minimumEvaluators?: number;
  search?: string;
  category?: string;
  columns?: string;
  sort?: 'overall' | 'category' | 'coverage' | 'spread';
}>;

export function RankingsWorkspace({
  initial,
  compareHref = './compare',
  filters = {},
  savedViews,
}: {
  initial: RankingPage;
  compareHref?: string;
  filters?: RankingFilterValues;
  savedViews?: ReactNode;
}) {
  const filterFormId = useId();
  const [selected, setSelected] = useState<string[]>([]);
  const [columns, setColumns] = useState(
    () =>
      new Set(
        (filters.columns ?? 'score,coverage,range')
          .split(',')
          .filter((c) => ['score', 'coverage', 'range'].includes(c)),
      ),
  );
  const visible = (column: string) => ({ display: columns.has(column) ? undefined : 'none' });
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
  if (filters.sort && filters.sort !== 'overall') filterQuery.set('sort', filters.sort);
  if (filters.category) filterQuery.set('category', filters.category);
  if (filters.columns !== undefined) filterQuery.set('columns', filters.columns);
  filterQuery.set('pageSize', String(initial.pageSize));
  const pageHref = (page: number) => {
    const query = new URLSearchParams(filterQuery);
    query.set('page', String(page));
    return `?${query.toString()}`;
  };
  return (
    <div className="min-w-0 space-y-5">
      <div className="ranking-search-bar">
        <label className="grid gap-1 text-sm font-medium">
          Search athletes
          <input
            className="min-h-11 rounded-[var(--radius-control)] border border-[var(--color-border)] px-3"
            defaultValue={filters.search ?? ''}
            form={filterFormId}
            name="search"
            placeholder="Find an athlete by name or number"
            type="search"
          />
        </label>
        <Button type="submit" form={filterFormId}>
          Search
        </Button>
      </div>
      <details className="ranking-filters">
        <summary>
          Filter rankings {filterQuery.size > 1 ? `(${filterQuery.size - 1} active)` : ''}
        </summary>
        {savedViews}
        <form
          id={filterFormId}
          className="grid gap-3 rounded-[var(--radius-surface)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-surface)] sm:grid-cols-2 lg:grid-cols-4"
        >
          <input name="pageSize" type="hidden" value={initial.pageSize} />
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
          <label className="grid gap-1 text-sm font-medium">
            Sort results
            <select
              className="min-h-11 rounded-lg border px-3"
              name="sort"
              defaultValue={filters.sort || 'overall'}
            >
              <option value="overall">Overall rank</option>
              <option value="category">Category: highest first</option>
              <option value="coverage">Coverage: lowest first</option>
              <option value="spread">Evaluator spread: widest first</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm font-medium">
            Category
            <select
              className="min-h-11 rounded-lg border px-3"
              name="category"
              defaultValue={filters.category || ''}
            >
              <option value="">Choose a category</option>
              {initial.categoryOptions?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <fieldset className="col-span-full flex flex-wrap gap-4">
            <legend className="font-bold">Display columns</legend>
            {[
              ['score', 'Score and evidence'],
              ['coverage', 'Coverage'],
              ['range', 'Evaluator range'],
            ].map(([key, label]) => (
              <label className="inline-flex items-center gap-2" key={key}>
                <input
                  type="checkbox"
                  checked={columns.has(key!)}
                  onChange={(e) =>
                    setColumns((current) => {
                      const next = new Set(current);
                      if (e.target.checked) next.add(key!);
                      else next.delete(key!);
                      return next;
                    })
                  }
                />
                {label}
              </label>
            ))}
            <input type="hidden" name="columns" value={[...columns].join(',')} />
          </fieldset>
          <Button className="self-end" type="submit">
            Apply filters
          </Button>
          <Link
            className="inline-flex min-h-11 items-center self-end font-bold"
            href={`?pageSize=${initial.pageSize}`}
            prefetch={false}
          >
            Clear filters
          </Link>
        </form>
      </details>

      {initial.rows.length === 0 ? (
        <EmptyState
          description="Adjust the filters or wait for completed evaluations. Incomplete work is never scored as zero."
          title="No ranking evidence yet"
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-[var(--color-text-muted)]" role="status">
              {initial.total} athletes ·{' '}
              <span title={`Generated ${initial.generatedAt}`}>updated results</span>
            </p>
            <Link
              aria-disabled={selected.length < 2}
              className="inline-flex min-h-11 items-center rounded-[var(--radius-control)] border border-[var(--color-primary)] px-4 font-bold aria-disabled:pointer-events-none aria-disabled:opacity-50"
              href={comparisonHref}
              prefetch={false}
            >
              Compare selected ({selected.length}/4)
            </Link>
          </div>

          <div className="card overflow-x-auto">
            <table
              aria-label="Player rankings"
              className="ranking-responsive-table w-full min-w-[760px] text-left"
            >
              <thead>
                <tr>
                  <th scope="col">
                    <span className="sr-only">Compare</span>
                  </th>
                  <th scope="col">Rank</th>
                  <th scope="col">Athlete</th>
                  <th scope="col" style={visible('score')}>
                    Score
                  </th>
                  <th scope="col" style={visible('coverage')}>
                    Evaluation coverage
                  </th>
                  <th scope="col" style={visible('range')}>
                    Score range
                  </th>
                </tr>
              </thead>
              <tbody>
                {initial.rows.map((row) => {
                  const checked = selected.includes(row.athleteId);
                  return (
                    <tr
                      className="ranking-card"
                      data-testid={`ranking-card-${row.registrationId}`}
                      key={row.registrationId}
                    >
                      <td>
                        <label className="inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center">
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
                          <span className="sr-only">Select {row.displayName} for comparison</span>
                        </label>
                      </td>
                      <td data-testid={`ranking-rank-${row.registrationId}`}>
                        <strong>{row.rank === null ? 'Unranked' : `Rank ${row.rank}`}</strong>
                        {row.isTied && row.rank ? (
                          <small className="block text-[var(--color-primary)]">
                            Tied at rank {row.rank}
                          </small>
                        ) : null}
                      </td>
                      <td>
                        <div className="flex items-center gap-3">
                          <BibBadge number={row.tryoutNumber} />
                          <div>
                            <h2 className="ranking-athlete-name">{row.displayName}</h2>
                            <p className="m-0 text-xs text-[var(--color-text-muted)]">
                              {row.divisionName}
                              {row.positionName ? ` · ${row.positionName}` : ''}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td
                        style={visible('score')}
                        data-label="Score"
                        data-testid={`ranking-score-${row.registrationId}`}
                      >
                        <details>
                          <summary className="cursor-pointer">
                            <strong className="text-base">{row.overall ?? 'Unranked'}</strong>
                            <span className="sr-only"> — score evidence for {row.displayName}</span>
                          </summary>
                          <p className="text-xs">
                            Weighted overall from completed evaluations. Category values are
                            normalized to 100; each retains its rubric category.
                          </p>
                          <dl>
                            {row.categories.map((c) => (
                              <div key={c.categoryId}>
                                <dt>{c.name}</dt>
                                <dd>{c.normalizedAverage} / 100</dd>
                              </div>
                            ))}
                          </dl>
                          {!row.categories.length && <p>No completed category scores.</p>}
                          <p className="text-xs">
                            Select a second athlete to compare session evidence.
                          </p>
                        </details>
                        {filters.category && (
                          <p className="text-xs">
                            Selected category:{' '}
                            {row.categories.find((c) => c.categoryId === filters.category)
                              ?.normalizedAverage ?? 'Not observed'}{' '}
                            / 100
                          </p>
                        )}
                        <small className="block text-[var(--color-text-muted)]">
                          {row.overall === null ? 'No completed score' : 'overall / 100'}
                        </small>
                      </td>
                      <td style={visible('coverage')}>
                        <StatusBadge
                          status={row.completionPercent === 100 ? 'complete' : 'warning'}
                        >
                          Evaluation coverage
                        </StatusBadge>
                        <p className="mt-2 mb-0 text-xs">
                          <strong>
                            {row.completedEvaluators} of {row.expectedEvaluators}
                          </strong>{' '}
                          evaluations complete
                        </p>
                        <small className="text-[var(--color-text-muted)]">
                          Coverage <strong>{row.completionPercent}%</strong>
                        </small>
                      </td>
                      <td style={visible('range')} data-label="Score range">
                        {row.scoreRange ? row.scoreRange.join('–') : 'Not available'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {initial.totalPages > 1 ? (
            <nav aria-label="Ranking pages" className="flex items-center justify-between gap-3">
              {initial.page > 1 ? (
                <Link
                  className="inline-flex min-h-11 items-center font-bold"
                  href={pageHref(initial.page - 1)}
                  prefetch={false}
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
                  prefetch={false}
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
