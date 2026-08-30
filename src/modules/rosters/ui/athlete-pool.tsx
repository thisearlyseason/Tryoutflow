'use client';

import { useDraggable, useDroppable } from '@dnd-kit/core';
import { GripVertical } from 'lucide-react';

import { Button } from '../../../components/ui/button';
import { StatusBadge } from '../../../components/ui/status-badge';
import type { RosterWorkspaceAthlete } from './roster-builder';

const flagLabels: Record<string, string> = {
  needs_another_look: 'Needs another look',
  injury_concern: 'Injury concern',
  eligibility_review: 'Eligibility review',
};

export function RosterAthleteCard({
  athlete,
  disabled,
  onMove,
  onSelect,
  selected,
}: {
  athlete: RosterWorkspaceAthlete;
  disabled: boolean;
  onMove(athlete: RosterWorkspaceAthlete): void;
  onSelect(registrationId: string, selected: boolean): void;
  selected: boolean;
}) {
  const draggable = useDraggable({ id: athlete.registrationId, disabled });
  return (
    <article
      className="min-w-0 rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 shadow-[var(--shadow-surface)]"
      data-testid={`roster-athlete-${athlete.registrationId}`}
      ref={draggable.setNodeRef}
      style={
        draggable.transform
          ? { transform: `translate3d(${draggable.transform.x}px, ${draggable.transform.y}px, 0)` }
          : undefined
      }
    >
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="break-words font-bold">{athlete.displayName}</h4>
          <p className="text-sm text-[var(--color-text-muted)]">
            {athlete.tryoutNumber === null ? 'No number' : `#${athlete.tryoutNumber}`} ·{' '}
            {athlete.positionName ?? 'Position unassigned'}
          </p>
        </div>
        {!disabled ? (
          <button
            {...draggable.attributes}
            {...draggable.listeners}
            aria-label={`Drag ${athlete.displayName}`}
            className="inline-flex min-h-11 min-w-11 touch-none items-center justify-center rounded-[var(--radius-control)] border border-[var(--color-border)]"
            type="button"
          >
            <GripVertical aria-hidden="true" size={20} />
          </button>
        ) : null}
      </div>
      <div className="mt-3 grid gap-1 text-sm">
        {athlete.rankingEvidence.status === 'available' ? (
          <>
            <p>
              <strong>{athlete.rankingEvidence.overall ?? 'No score'}</strong>
              {athlete.rankingEvidence.overall === null ? '' : ' / 100'}
            </p>
            <p>
              {athlete.rankingEvidence.completedEvaluators} of{' '}
              {athlete.rankingEvidence.expectedEvaluators} evaluations
            </p>
            <p>
              Range{' '}
              {athlete.rankingEvidence.scoreRange === null
                ? 'not available'
                : athlete.rankingEvidence.scoreRange.join('–')}
            </p>
          </>
        ) : (
          <p className="font-medium">
            {athlete.rankingEvidence.status === 'not_authorized'
              ? 'Ranking evidence not authorized'
              : 'Ranking evidence unavailable'}
          </p>
        )}
        <p>
          Decision: <strong className="capitalize">{athlete.decision}</strong>
        </p>
      </div>
      {athlete.rankingEvidence.status === 'available' &&
      athlete.rankingEvidence.flags.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {athlete.rankingEvidence.flags.map((flag) => (
            <StatusBadge key={flag} status="callback">
              {flagLabels[flag] ?? flag.replaceAll('_', ' ')}
            </StatusBadge>
          ))}
        </div>
      ) : null}
      {!disabled ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--color-border)] pt-2">
          <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm font-medium">
            <input
              checked={selected}
              onChange={(event) => onSelect(athlete.registrationId, event.currentTarget.checked)}
              type="checkbox"
            />
            Select {athlete.displayName}
          </label>
          <Button
            aria-label={`Move ${athlete.displayName}`}
            onClick={() => onMove(athlete)}
            variant="secondary"
          >
            Move {athlete.displayName}
          </Button>
        </div>
      ) : null}
    </article>
  );
}

export function AthletePool({
  athletes,
  disabled,
  filtered,
  onMove,
  onSelect,
  selected,
  totalCount,
}: {
  athletes: readonly RosterWorkspaceAthlete[];
  disabled: boolean;
  filtered: boolean;
  onMove(athlete: RosterWorkspaceAthlete): void;
  onSelect(registrationId: string, selected: boolean): void;
  selected: ReadonlySet<string>;
  totalCount: number;
}) {
  const drop = useDroppable({ id: 'destination:pool', disabled });
  return (
    <section
      aria-labelledby="athlete-pool-heading"
      className="min-w-0 rounded-[var(--radius-surface)] border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3"
      data-testid="roster-destination-pool"
      ref={drop.setNodeRef}
    >
      <h3 id="athlete-pool-heading" className="font-[var(--font-bib)] text-lg">
        Athlete pool {totalCount}
      </h3>
      <p className="mt-1 text-xs text-[var(--color-text-muted)]">Unassigned placements</p>
      {filtered ? (
        <p className="mt-1 text-xs font-medium">{athletes.length} visible with this filter</p>
      ) : null}
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
          <p
            className="rounded-[var(--radius-control)] border border-dashed border-[var(--color-border)] p-3 text-sm text-[var(--color-text-muted)]"
            role="status"
          >
            {filtered && totalCount > 0
              ? 'No athletes match this filter.'
              : 'No athletes in the pool.'}
          </p>
        ) : null}
      </div>
    </section>
  );
}
