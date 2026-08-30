'use client';

import {
  DndContext,
  PointerSensor,
  TouchSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '../../../components/ui/button';
import type { RosterMemberRankingEvidence } from '../application/load-roster-workspace';
import type { DecisionStatus } from '../domain/roster';
import { AthletePool } from './athlete-pool';
import { FinalizeRosterDialog } from './finalize-roster-dialog';
import { MoveAthleteDialog } from './move-athlete-dialog';
import { TeamRoster } from './team-roster';

export type RosterWorkspacePosition = Readonly<{ id: string; name: string }>;
export type RosterTeamView = Readonly<{
  id: string;
  name: string;
  targetSize: number | null;
  positionTargets: Readonly<Record<string, number>>;
}>;
export type RosterWorkspaceAthlete = Readonly<{
  registrationId: string;
  displayName: string;
  tryoutNumber: number | null;
  positionId: string | null;
  positionName: string | null;
  rankingEvidence: RosterMemberRankingEvidence;
  decision: DecisionStatus;
  teamId: string | null;
}>;
export type RosterWorkspaceSnapshot = Readonly<{
  rosterVersionId: string;
  state: 'draft' | 'finalized';
  version: number;
  revisionNumber: number;
  basedOnRosterVersionId: string | null;
  revisionReason: string | null;
  finalizedAt: string | null;
  evidenceAvailability: 'available' | 'unavailable' | 'not_authorized';
  teams: readonly RosterTeamView[];
  positions: readonly RosterWorkspacePosition[];
  athletes: readonly RosterWorkspaceAthlete[];
}>;

export type RosterMutationResult =
  { ok: true; version: number } | { ok: false; code: string; currentVersion?: number };
export type RosterRevisionResult =
  | { ok: true; rosterVersionId: string; version: number }
  | { ok: false; code: string; currentVersion?: number };

export type RosterBuilderProps = {
  canEdit: boolean;
  initial: RosterWorkspaceSnapshot;
  onMove(input: {
    rosterVersionId: string;
    registrationId: string;
    teamId: string | null;
    expectedVersion: number;
  }): Promise<RosterMutationResult>;
  onChangeDecisions(input: {
    rosterVersionId: string;
    changes: readonly { registrationId: string; status: DecisionStatus }[];
    expectedVersion: number;
  }): Promise<RosterMutationResult>;
  onFinalize(input: {
    rosterVersionId: string;
    expectedVersion: number;
  }): Promise<RosterMutationResult>;
  onRevise(input: {
    rosterVersionId: string;
    expectedVersion: number;
    reason: string;
  }): Promise<RosterRevisionResult>;
};

export type CreateRosterUiResult =
  { ok: true; rosterVersionId: string; version: number } | { ok: false; code: string };

const decisions: readonly DecisionStatus[] = [
  'undecided',
  'callback',
  'selected',
  'waitlisted',
  'released',
  'withdrawn',
];

export function resolveRosterDrop(event: {
  active: { id: UniqueIdentifier };
  over: { id: UniqueIdentifier } | null;
}): {
  registrationId: string;
  teamId: string | null;
} | null {
  if (event.over === null) return null;
  const registrationId = String(event.active.id);
  const destination = String(event.over.id);
  if (!destination.startsWith('destination:')) return null;
  const teamId = destination.slice('destination:'.length);
  return { registrationId, teamId: teamId === 'pool' ? null : teamId };
}

function decisionLabel(status: DecisionStatus) {
  return status[0]!.toUpperCase() + status.slice(1);
}

function finalizedAuditTime(value: string | null) {
  if (value === null) return null;
  const timestamp = new Date(value);
  if (!Number.isFinite(timestamp.getTime())) return null;
  const dateTime = timestamp.toISOString();
  return {
    dateTime,
    label: `${dateTime.slice(0, 10)} ${dateTime.slice(11, 19)} UTC`,
  };
}

type DraftTeamInput = {
  name: string;
  targetSize: string;
  positionTargets: Record<string, string>;
};

function blankTeam(): DraftTeamInput {
  return { name: '', targetSize: '', positionTargets: {} };
}

export function RosterDraftSetup({
  divisionName,
  onCreate,
  positions,
}: {
  divisionName: string;
  onCreate(input: {
    teams: readonly {
      name: string;
      targetSize: number | null;
      positionTargets: Readonly<Record<string, number>>;
    }[];
  }): Promise<CreateRosterUiResult>;
  positions: readonly RosterWorkspacePosition[];
}) {
  const [teams, setTeams] = useState<DraftTeamInput[]>([blankTeam(), blankTeam()]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function create() {
    const payload = teams.map((team) => ({
      name: team.name.trim(),
      targetSize: team.targetSize === '' ? null : Number(team.targetSize),
      positionTargets: Object.fromEntries(
        Object.entries(team.positionTargets)
          .filter(([, value]) => value !== '')
          .map(([id, value]) => [id, Number(value)]),
      ),
    }));
    if (payload.some((team) => team.name.length === 0)) {
      setMessage('Every team needs a name.');
      return;
    }
    setBusy(true);
    setMessage('Creating draft roster…');
    let result: CreateRosterUiResult;
    try {
      result = await onCreate({ teams: payload });
    } catch {
      setBusy(false);
      setMessage('The draft roster could not reach the server. Try again.');
      return;
    }
    setBusy(false);
    if (!result.ok) {
      setMessage(
        result.code === 'conflict'
          ? 'A roster was created elsewhere. Refresh to review it.'
          : 'The draft roster could not be created. Review the team targets and try again.',
      );
      return;
    }
    setMessage('Draft roster created. Loading the workspace…');
    if (typeof window !== 'undefined' && !navigator.userAgent.includes('jsdom'))
      window.location.reload();
  }

  return (
    <section
      aria-labelledby="create-roster-heading"
      className="space-y-4 rounded-[var(--radius-surface)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
    >
      <div>
        <p className="eyebrow">{divisionName}</p>
        <h3 id="create-roster-heading" className="text-xl font-bold">
          Create a draft roster
        </h3>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          Teams and targets guide human review. Creating a draft does not assign, select, release,
          message, or export any athlete.
        </p>
      </div>
      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        {teams.map((team, index) => (
          <fieldset
            className="min-w-0 space-y-3 rounded-[var(--radius-control)] border border-[var(--color-border)] p-3"
            key={index}
          >
            <legend className="px-1 font-bold">Team {index + 1}</legend>
            <label className="grid min-w-0 gap-1 font-medium">
              Team {index + 1} name
              <input
                className="min-h-11 min-w-0 rounded-[var(--radius-control)] border border-[var(--color-border)] px-3"
                disabled={busy}
                maxLength={120}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setTeams((current) =>
                    current.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, name: value } : item,
                    ),
                  );
                }}
                required
                value={team.name}
              />
            </label>
            <label className="grid min-w-0 gap-1 font-medium">
              Team {index + 1} roster target
              <input
                className="min-h-11 min-w-0 rounded-[var(--radius-control)] border border-[var(--color-border)] px-3"
                disabled={busy}
                max="500"
                min="1"
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setTeams((current) =>
                    current.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, targetSize: value } : item,
                    ),
                  );
                }}
                type="number"
                value={team.targetSize}
              />
            </label>
            {positions.map((position) => (
              <label className="grid min-w-0 gap-1 text-sm font-medium" key={position.id}>
                Team {index + 1} {position.name} target
                <input
                  className="min-h-11 min-w-0 rounded-[var(--radius-control)] border border-[var(--color-border)] px-3"
                  disabled={busy}
                  max="500"
                  min="0"
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    setTeams((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index
                          ? {
                              ...item,
                              positionTargets: {
                                ...item.positionTargets,
                                [position.id]: value,
                              },
                            }
                          : item,
                      ),
                    );
                  }}
                  type="number"
                  value={team.positionTargets[position.id] ?? ''}
                />
              </label>
            ))}
          </fieldset>
        ))}
      </div>
      <div className="flex flex-wrap gap-3">
        {teams.length < 50 ? (
          <Button
            disabled={busy}
            onClick={() => setTeams((current) => [...current, blankTeam()])}
            variant="secondary"
          >
            Add team
          </Button>
        ) : null}
        {teams.length > 1 ? (
          <Button
            disabled={busy}
            onClick={() => setTeams((current) => current.slice(0, -1))}
            variant="secondary"
          >
            Remove last team
          </Button>
        ) : null}
        <Button busy={busy} onClick={create}>
          Create draft roster
        </Button>
      </div>
      <p aria-live="polite" className="text-sm text-[var(--color-text-muted)]" role="status">
        {message}
      </p>
    </section>
  );
}

export function RosterBuilder({
  canEdit,
  initial,
  onChangeDecisions,
  onFinalize,
  onMove,
  onRevise,
}: RosterBuilderProps) {
  const [hydrated, setHydrated] = useState(false);
  const [snapshot, setSnapshot] = useState(initial);
  const [positionFilter, setPositionFilter] = useState('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [moveTarget, setMoveTarget] = useState<RosterWorkspaceAthlete | null>(null);
  const [bulkDecision, setBulkDecision] = useState<DecisionStatus>('undecided');
  const [bulkOpen, setBulkOpen] = useState(false);
  const [finalizeOpen, setFinalizeOpen] = useState(false);
  const [revisionOpen, setRevisionOpen] = useState(false);
  const [revisionReason, setRevisionReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [staleVersion, setStaleVersion] = useState<number | 'unknown' | null>(null);
  const [message, setMessage] = useState('');
  const statusRef = useRef<HTMLDivElement>(null);
  const recoveryRef = useRef<HTMLElement>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } }),
  );

  useEffect(() => {
    setHydrated(true);
  }, []);

  useEffect(() => {
    setSnapshot(initial);
    setStaleVersion(null);
    setMessage('');
    setSelected(new Set());
  }, [initial]);

  useEffect(() => {
    if (message.includes('placement saved')) statusRef.current?.focus();
  }, [message]);

  useEffect(() => {
    if (staleVersion !== null) recoveryRef.current?.focus();
  }, [staleVersion]);

  const editable =
    hydrated && canEdit && snapshot.state === 'draft' && staleVersion === null && !busy;
  const finalizedTime = finalizedAuditTime(snapshot.finalizedAt);
  const visibleAthletes = useMemo(
    () =>
      snapshot.athletes.filter(
        (athlete) => positionFilter === 'all' || athlete.positionId === positionFilter,
      ),
    [positionFilter, snapshot.athletes],
  );

  function fail(result: Exclude<RosterMutationResult, { ok: true }>) {
    if (['conflict', 'invalid_roster', 'invalid_state'].includes(result.code)) {
      setMoveTarget(null);
      setBulkOpen(false);
      setFinalizeOpen(false);
      setRevisionOpen(false);
      setStaleVersion(result.currentVersion ?? 'unknown');
      setMessage('');
      return;
    }
    setMessage(
      result.code === 'forbidden'
        ? 'Your roster access changed. Refresh before continuing.'
        : 'The roster change was not saved. Review the current state and try again.',
    );
  }

  async function performMove(registrationId: string, teamId: string | null) {
    if (!editable) return;
    if (teamId !== null && !snapshot.teams.some((team) => team.id === teamId)) return;
    const athlete = snapshot.athletes.find(
      (candidate) => candidate.registrationId === registrationId,
    );
    if (!athlete || athlete.teamId === teamId) {
      setMoveTarget(null);
      return;
    }
    setBusy(true);
    setMessage('Saving roster placement…');
    let result: RosterMutationResult;
    try {
      result = await onMove({
        rosterVersionId: snapshot.rosterVersionId,
        registrationId,
        teamId,
        expectedVersion: snapshot.version,
      });
    } catch {
      setBusy(false);
      setMoveTarget(null);
      setMessage('The roster change could not reach the server. Try again.');
      return;
    }
    setBusy(false);
    if (!result.ok) {
      setMoveTarget(null);
      fail(result);
      return;
    }
    setSnapshot((current) => ({
      ...current,
      version: result.version,
      athletes: current.athletes.map((candidate) =>
        candidate.registrationId === registrationId ? { ...candidate, teamId } : candidate,
      ),
    }));
    setMoveTarget(null);
    setMessage(`${athlete.displayName} placement saved to roster version ${result.version}.`);
  }

  async function applyBulkDecision() {
    if (!editable || selected.size === 0) return;
    const changes = snapshot.athletes
      .filter((athlete) => selected.has(athlete.registrationId))
      .map((athlete) => ({ registrationId: athlete.registrationId, status: bulkDecision }));
    setBusy(true);
    setMessage('Saving decision changes…');
    let result: RosterMutationResult;
    try {
      result = await onChangeDecisions({
        rosterVersionId: snapshot.rosterVersionId,
        changes,
        expectedVersion: snapshot.version,
      });
    } catch {
      setBusy(false);
      setBulkOpen(false);
      setMessage('The decision change could not reach the server. Try again.');
      return;
    }
    setBusy(false);
    if (!result.ok) {
      fail(result);
      return;
    }
    setSnapshot((current) => ({
      ...current,
      version: result.version,
      athletes: current.athletes.map((athlete) =>
        selected.has(athlete.registrationId) ? { ...athlete, decision: bulkDecision } : athlete,
      ),
    }));
    setSelected(new Set());
    setBulkOpen(false);
    setMessage(
      `${changes.length} decision${changes.length === 1 ? '' : 's'} saved. No messages were sent.`,
    );
  }

  async function finalize() {
    if (!editable) return;
    setBusy(true);
    setMessage('Finalizing roster…');
    let result: RosterMutationResult;
    try {
      result = await onFinalize({
        rosterVersionId: snapshot.rosterVersionId,
        expectedVersion: snapshot.version,
      });
    } catch {
      setBusy(false);
      setFinalizeOpen(false);
      setMessage('Finalization could not reach the server. The roster remains a draft.');
      return;
    }
    setBusy(false);
    if (!result.ok) {
      fail(result);
      return;
    }
    setSnapshot((current) => ({
      ...current,
      state: 'finalized',
      version: result.version,
      finalizedAt: null,
    }));
    setFinalizeOpen(false);
    setSelected(new Set());
    setMessage('Roster finalized. No messages were sent by finalization.');
  }

  async function revise() {
    const reason = revisionReason.trim();
    if (!canEdit || snapshot.state !== 'finalized' || reason.length < 10 || busy) return;
    setBusy(true);
    setMessage('Creating audited revision…');
    let result: RosterRevisionResult;
    try {
      result = await onRevise({
        rosterVersionId: snapshot.rosterVersionId,
        expectedVersion: snapshot.version,
        reason,
      });
    } catch {
      setBusy(false);
      setRevisionOpen(false);
      setMessage('The revision could not reach the server. Try again.');
      return;
    }
    setBusy(false);
    if (!result.ok) {
      fail(result);
      return;
    }
    const sourceId = snapshot.rosterVersionId;
    setSnapshot((current) => ({
      ...current,
      rosterVersionId: result.rosterVersionId,
      state: 'draft',
      version: result.version,
      revisionNumber: current.revisionNumber + 1,
      basedOnRosterVersionId: sourceId,
      revisionReason: reason,
      finalizedAt: null,
    }));
    setRevisionOpen(false);
    setRevisionReason('');
    setMessage(`Revision ${snapshot.revisionNumber + 1} created from the immutable snapshot.`);
  }

  return (
    <DndContext
      accessibility={{
        restoreFocus: false,
        screenReaderInstructions: {
          draggable:
            'Use the Move button for full keyboard placement controls. Drag handles support pointer and touch placement.',
        },
      }}
      collisionDetection={pointerWithin}
      id="roster-builder-dnd"
      onDragEnd={(event) => {
        const drop = resolveRosterDrop(event);
        if (drop) void performMove(drop.registrationId, drop.teamId);
      }}
      sensors={sensors}
    >
      <div className="min-w-0 space-y-5">
        <header className="flex min-w-0 flex-wrap items-start justify-between gap-3 rounded-[var(--radius-surface)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <div className="min-w-0">
            <p className="eyebrow">Roster revision {snapshot.revisionNumber}</p>
            <h3 className="break-words text-xl font-bold">
              {snapshot.state === 'finalized'
                ? 'Finalized roster · immutable'
                : `Draft roster · version ${snapshot.version}`}
            </h3>
            <p className="mt-1 max-w-3xl text-sm text-[var(--color-text-muted)]">
              Scores, coverage, and flags are decision evidence. Placement and decision status are
              separate human choices; rankings never select athletes automatically.
            </p>
            {snapshot.state === 'finalized' ? (
              <p className="mt-2 text-sm">
                Recorded in the roster audit trail.{' '}
                {snapshot.finalizedAt === null ? null : finalizedTime === null ? (
                  'Finalization time unavailable.'
                ) : (
                  <>
                    Finalized at{' '}
                    <time dateTime={finalizedTime.dateTime}>{finalizedTime.label}</time>.
                  </>
                )}
              </p>
            ) : null}
          </div>
          {canEdit && snapshot.state === 'draft' ? (
            <Button
              disabled={!hydrated || staleVersion !== null}
              onClick={() => setFinalizeOpen(true)}
            >
              Finalize roster
            </Button>
          ) : canEdit && snapshot.state === 'finalized' ? (
            <Button disabled={!hydrated} onClick={() => setRevisionOpen(true)} variant="secondary">
              Create revision
            </Button>
          ) : null}
        </header>

        {staleVersion !== null ? (
          <section
            aria-live="assertive"
            className="rounded-[var(--radius-surface)] border border-[var(--color-destructive)] bg-[var(--color-surface)] p-4"
            role="alert"
            ref={recoveryRef}
            tabIndex={-1}
          >
            <h3 className="font-bold">Roster changed elsewhere</h3>
            <p className="mt-1 text-sm">
              Roster changed elsewhere.{' '}
              {staleVersion === 'unknown'
                ? 'Refresh and review the current roster before retrying.'
                : `Refresh and review version ${staleVersion} before retrying.`}{' '}
              Your attempted change was not applied.
            </p>
            <Button className="mt-3" onClick={() => window.location.reload()} variant="secondary">
              Refresh roster
            </Button>
          </section>
        ) : null}

        {snapshot.evidenceAvailability !== 'available' ? (
          <section
            aria-label="Ranking evidence unavailable"
            className="rounded-[var(--radius-surface)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-sm"
            role="status"
          >
            <strong>Ranking evidence unavailable.</strong>{' '}
            {snapshot.evidenceAvailability === 'not_authorized'
              ? 'This role is not authorized to load ranking evidence. '
              : 'Ranking evidence could not be loaded. '}
            Roster membership, placements, and decisions remain available from the exact roster
            snapshot.
          </section>
        ) : null}

        <div
          aria-live="polite"
          className="min-h-5 text-sm text-[var(--color-text-muted)]"
          ref={statusRef}
          role="status"
          tabIndex={-1}
        >
          {message}
        </div>

        <section className="grid min-w-0 gap-3 rounded-[var(--radius-surface)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 sm:grid-cols-[minmax(0,1fr)_auto]">
          <label className="grid min-w-0 gap-1 font-medium">
            Filter by position
            <select
              className="h-11 min-w-0 rounded-[var(--radius-control)] border border-[var(--color-border)] px-3"
              disabled={!hydrated}
              onChange={(event) => {
                setPositionFilter(event.currentTarget.value);
                setSelected(new Set());
              }}
              value={positionFilter}
            >
              <option value="all">All positions</option>
              {snapshot.positions.map((position) => (
                <option key={position.id} value={position.id}>
                  {position.name}
                </option>
              ))}
            </select>
          </label>
          {canEdit && snapshot.state === 'draft' ? (
            <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,12rem)_auto] sm:self-end">
              <label className="grid gap-1 font-medium">
                Bulk decision
                <select
                  className="h-11 min-w-0 rounded-[var(--radius-control)] border border-[var(--color-border)] px-3"
                  disabled={!editable}
                  onChange={(event) => setBulkDecision(event.currentTarget.value as DecisionStatus)}
                  value={bulkDecision}
                >
                  {decisions.map((status) => (
                    <option key={status} value={status}>
                      {decisionLabel(status)}
                    </option>
                  ))}
                </select>
              </label>
              <Button
                disabled={!editable || selected.size === 0}
                onClick={() => setBulkOpen(true)}
                variant={bulkDecision === 'released' ? 'destructive' : 'secondary'}
              >
                Review decision for {selected.size} athlete{selected.size === 1 ? '' : 's'}
              </Button>
            </div>
          ) : null}
        </section>

        <div className="grid min-w-0 gap-4 lg:grid-cols-3">
          <AthletePool
            athletes={visibleAthletes.filter((athlete) => athlete.teamId === null)}
            disabled={!editable}
            filtered={positionFilter !== 'all'}
            onMove={setMoveTarget}
            onSelect={(registrationId, checked) =>
              setSelected((current) => {
                const next = new Set(current);
                if (checked) next.add(registrationId);
                else next.delete(registrationId);
                return next;
              })
            }
            selected={selected}
            totalCount={snapshot.athletes.filter((athlete) => athlete.teamId === null).length}
          />
          {snapshot.teams.map((team) => (
            <TeamRoster
              allAthletes={snapshot.athletes.filter((athlete) => athlete.teamId === team.id)}
              athletes={visibleAthletes.filter((athlete) => athlete.teamId === team.id)}
              disabled={!editable}
              filtered={positionFilter !== 'all'}
              key={team.id}
              onMove={setMoveTarget}
              onSelect={(registrationId, checked) =>
                setSelected((current) => {
                  const next = new Set(current);
                  if (checked) next.add(registrationId);
                  else next.delete(registrationId);
                  return next;
                })
              }
              positions={snapshot.positions}
              selected={selected}
              team={team}
            />
          ))}
        </div>

        <MoveAthleteDialog
          athlete={moveTarget}
          busy={busy}
          onClose={() => setMoveTarget(null)}
          onConfirm={(teamId) =>
            moveTarget ? performMove(moveTarget.registrationId, teamId) : Promise.resolve()
          }
          open={moveTarget !== null}
          teams={snapshot.teams}
        />
        <FinalizeRosterDialog
          busy={busy}
          onConfirm={finalize}
          onOpenChange={setFinalizeOpen}
          open={finalizeOpen}
        />

        <Dialog.Root open={bulkOpen} onOpenChange={(next) => !busy && setBulkOpen(next)}>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
            <Dialog.Content className="fixed left-1/2 top-1/2 z-50 grid max-h-[90dvh] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-[var(--radius-surface)] bg-[var(--color-surface)] p-5 shadow-xl">
              <Dialog.Title className="text-xl font-bold">
                Confirm bulk {bulkDecision === 'released' ? 'release' : 'decision'}
              </Dialog.Title>
              <Dialog.Description className="text-sm text-[var(--color-text-muted)]">
                Change {selected.size} athlete{selected.size === 1 ? '' : 's'} to{' '}
                <strong>{decisionLabel(bulkDecision)}</strong>. This records decision history but
                does not move athletes and does not send a message.
              </Dialog.Description>
              {bulkDecision === 'released' ? (
                <p className="rounded-[var(--radius-control)] border border-[var(--color-destructive)] p-3 text-sm">
                  Release is a consequential decision. Review the selected athletes before
                  confirming.
                </p>
              ) : null}
              <div className="flex flex-wrap justify-end gap-3">
                <Dialog.Close asChild>
                  <Button disabled={busy} variant="secondary">
                    Cancel
                  </Button>
                </Dialog.Close>
                <Button
                  busy={busy}
                  onClick={applyBulkDecision}
                  variant={bulkDecision === 'released' ? 'destructive' : 'primary'}
                >
                  {bulkDecision === 'released' ? 'Confirm release' : 'Confirm decisions'}
                </Button>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>

        <Dialog.Root open={revisionOpen} onOpenChange={(next) => !busy && setRevisionOpen(next)}>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
            <Dialog.Content className="fixed left-1/2 top-1/2 z-50 grid max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-[var(--radius-surface)] bg-[var(--color-surface)] p-5 shadow-xl">
              <Dialog.Title className="text-xl font-bold">Create roster revision</Dialog.Title>
              <Dialog.Description className="text-sm text-[var(--color-text-muted)]">
                The finalized snapshot stays immutable. A new draft will clone its placements and
                decisions, and the reason will be recorded in the audit trail.
              </Dialog.Description>
              <label className="grid gap-1 font-medium">
                Revision reason
                <textarea
                  className="min-h-24 min-w-0 rounded-[var(--radius-control)] border border-[var(--color-border)] p-3"
                  disabled={busy}
                  maxLength={500}
                  minLength={10}
                  onChange={(event) => setRevisionReason(event.currentTarget.value)}
                  required
                  value={revisionReason}
                />
              </label>
              <div className="flex flex-wrap justify-end gap-3">
                <Dialog.Close asChild>
                  <Button disabled={busy} variant="secondary">
                    Cancel
                  </Button>
                </Dialog.Close>
                <Button busy={busy} disabled={revisionReason.trim().length < 10} onClick={revise}>
                  Confirm revision
                </Button>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      </div>
    </DndContext>
  );
}
