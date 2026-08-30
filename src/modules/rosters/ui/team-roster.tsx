'use client';

import { useDroppable } from '@dnd-kit/core';

import { RosterAthleteCard } from './athlete-pool';
import type {
  RosterTeamView,
  RosterWorkspaceAthlete,
  RosterWorkspacePosition,
} from './roster-builder';

export function TeamRoster({
  allAthletes,
  athletes,
  disabled,
  filtered,
  onMove,
  onSelect,
  positions,
  selected,
  team,
}: {
  allAthletes: readonly RosterWorkspaceAthlete[];
  athletes: readonly RosterWorkspaceAthlete[];
  disabled: boolean;
  filtered: boolean;
  onMove(athlete: RosterWorkspaceAthlete): void;
  onSelect(registrationId: string, selected: boolean): void;
  positions: readonly RosterWorkspacePosition[];
  selected: ReadonlySet<string>;
  team: RosterTeamView;
}) {
  const drop = useDroppable({ id: `destination:${team.id}`, disabled });
  return (
    <section
      aria-labelledby={`team-${team.id}`}
      className="min-w-0 rounded-[var(--radius-surface)] border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3"
      data-testid={`roster-destination-${team.id}`}
      ref={drop.setNodeRef}
    >
      <h3 id={`team-${team.id}`} className="font-[var(--font-bib)] text-lg">
        {team.name} roster {allAthletes.length}
        {team.targetSize === null ? '' : ` of ${team.targetSize}`}
      </h3>
      {filtered ? (
        <p className="mt-1 text-xs font-medium">{athletes.length} visible with this filter</p>
      ) : null}
      {Object.entries(team.positionTargets).length > 0 ? (
        <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--color-text-muted)]">
          {Object.entries(team.positionTargets).map(([positionId, target]) => {
            const position = positions.find((candidate) => candidate.id === positionId);
            const count = allAthletes.filter((athlete) => athlete.positionId === positionId).length;
            return (
              <li key={positionId}>
                {position?.name ?? 'Unknown position'} target {count} of {target}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-1 text-xs text-[var(--color-text-muted)]">No position targets set</p>
      )}
      <div className="mt-3 grid min-w-0 gap-3">
        {athletes.map((athlete) => (
          <RosterAthleteCard
            athlete={athlete}
            disabled={disabled}
            key={athlete.registrationId}
            onMove={onMove}
            onSelect={onSelect}
            selected={selected.has(athlete.registrationId)}
          />
        ))}
        {athletes.length === 0 ? (
          <p className="rounded-[var(--radius-control)] border border-dashed border-[var(--color-border)] p-3 text-sm text-[var(--color-text-muted)]">
            No athletes assigned.
          </p>
        ) : null}
      </div>
    </section>
  );
}
