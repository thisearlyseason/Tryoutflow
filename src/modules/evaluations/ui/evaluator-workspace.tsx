'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { AssignedAthleteSummary } from '../../staffing/domain/assignment';
import type { OwnEvaluationSummary } from '../infrastructure/evaluator-session-loader';
import { AssignedAthleteList } from './session-state';

import {
  athletesAtStation,
  nextUnscoredAthlete,
  type EvaluatorStation,
} from '../domain/evaluator-workspace';

export function EvaluatorWorkspace({
  athletes,
  evaluations,
  basePath,
  stations = [],
  stationsUnavailable = false,
}: {
  athletes: AssignedAthleteSummary[];
  evaluations: OwnEvaluationSummary[];
  basePath: string;
  stations?: EvaluatorStation[];
  stationsUnavailable?: boolean;
}) {
  const [mode, setMode] = useState<'athletes' | 'stations' | 'overview'>('athletes');
  const [stationId, setStationId] = useState('');
  const [query, setQuery] = useState('');
  const [incompleteOnly, setIncompleteOnly] = useState(false);
  const station = stations.find((item) => item.id === stationId);
  const completed = new Set(
    evaluations
      .filter((item) => item.state === 'completed' || item.state === 'locked')
      .map((item) => item.registrationId),
  );
  const scoped = mode === 'stations' && station ? athletesAtStation(athletes, station) : athletes;
  const visible = scoped.filter(
    (item) =>
      (!incompleteOnly || !completed.has(item.registrationId)) &&
      `${item.displayName} ${item.tryoutNumber ?? ''} ${item.groupName ?? ''}`
        .toLocaleLowerCase()
        .includes(query.trim().toLocaleLowerCase()),
  );
  const next = nextUnscoredAthlete(scoped, evaluations);
  return (
    <div className="evaluator-workspace grid min-w-0 gap-4">
      <div className="evaluator-toolbar">
        <div aria-label="Scoring view" className="evaluator-view-switch" role="group">
          {(['athletes', 'stations', 'overview'] as const).map((value) => (
            <button
              type="button"
              key={value}
              aria-pressed={mode === value}
              onClick={() => setMode(value)}
            >
              {value === 'athletes'
                ? 'By athlete'
                : value === 'stations'
                  ? 'By station'
                  : 'Overview grid'}
            </button>
          ))}
        </div>
        {next ? (
          <Link
            className="button-primary"
            prefetch={false}
            href={`${basePath}/athletes/${next.registrationId}`}
          >
            Next unscored ·{' '}
            {next.tryoutNumber === null ? next.displayName : `#${next.tryoutNumber}`}
          </Link>
        ) : (
          <p role="status">
            {scoped.length === 0
              ? 'No assigned athletes in this view.'
              : 'All assigned evaluations in this view are complete.'}
          </p>
        )}
      </div>
      <p className="text-sm text-[var(--color-text-muted)]">
        Server-confirmed progress only. Device drafts may still be waiting to sync. Open an athlete
        to check the current save state.
      </p>
      {mode === 'stations' ? (
        <section className="evaluator-station-panel grid gap-3" aria-label="Your stations">
          {stationsUnavailable ? (
            <p role="status">
              Station details could not be loaded. Your assigned athletes remain available.
            </p>
          ) : stations.length === 0 ? (
            <p>
              No active stations assigned to you in this session. Ask the organizer to check station
              staffing.
            </p>
          ) : (
            <>
              <label className="grid gap-1 font-bold">
                Station
                <select value={stationId} onChange={(event) => setStationId(event.target.value)}>
                  <option value="">All my assigned athletes</option>
                  {stations.map((item) => (
                    <option value={item.id} key={item.id}>
                      {item.name}
                      {item.location ? ` · ${item.location}` : ''}
                    </option>
                  ))}
                </select>
              </label>
              {station ? (
                <div>
                  <h3>{station.name}</h3>
                  <p>{station.instructions}</p>
                  <p className="text-sm">
                    {station.groupLabel
                      ? `Group: ${station.groupLabel}. Only matching athletes already assigned to you are shown.`
                      : 'No group filter. Only athletes already assigned to you are shown.'}{' '}
                    Station scoring uses the session rubric.
                  </p>
                </div>
              ) : null}
            </>
          )}
        </section>
      ) : null}
      <div className="evaluator-filters">
        <label>
          Find athlete
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Number, name or group"
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={incompleteOnly}
            onChange={(event) => setIncompleteOnly(event.target.checked)}
          />{' '}
          Incomplete only
        </label>
      </div>
      <p className="text-sm" role="status">
        {visible.length} of {scoped.length} assigned athletes shown
      </p>
      {mode === 'overview' ? (
        <div className="evaluator-grid-scroll" tabIndex={0} aria-label="Assigned athlete overview">
          <table>
            <caption>
              Read-only overview. Open an athlete to score with the same saved-draft workflow.
            </caption>
            <thead>
              <tr>
                <th scope="col">Number</th>
                <th scope="col">Athlete</th>
                <th scope="col">Group</th>
                <th scope="col">Your server state</th>
                <th scope="col">Scoring</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((item) => (
                <tr key={item.registrationId}>
                  <td className="evaluator-number">
                    {item.tryoutNumber === null ? 'Unassigned' : `#${item.tryoutNumber}`}
                  </td>
                  <th scope="row">{item.displayName}</th>
                  <td>{item.groupName ?? 'No group'}</td>
                  <td>
                    {evaluations.find((entry) => entry.registrationId === item.registrationId)
                      ?.state ?? 'Not started'}
                  </td>
                  <td>
                    <Link prefetch={false} href={`${basePath}/athletes/${item.registrationId}`}>
                      Open scoring
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <AssignedAthleteList athletes={visible} evaluations={evaluations} basePath={basePath} />
      )}
      {visible.length === 0 ? (
        <p>No assigned athletes match these filters. Clear the search or change station.</p>
      ) : null}
    </div>
  );
}
