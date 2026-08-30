'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useState } from 'react';

import { Button } from '../../../components/ui/button';
import type { RosterTeamView, RosterWorkspaceAthlete } from './roster-builder';

export function MoveAthleteDialog({
  athlete,
  busy,
  onClose,
  onConfirm,
  open,
  teams,
}: {
  athlete: RosterWorkspaceAthlete | null;
  busy: boolean;
  onClose(): void;
  onConfirm(teamId: string | null): Promise<void>;
  open: boolean;
  teams: readonly RosterTeamView[];
}) {
  const [destination, setDestination] = useState('pool');

  useEffect(() => {
    setDestination(athlete?.teamId ?? 'pool');
  }, [athlete]);

  return (
    <Dialog.Root
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
      open={open}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 grid max-h-[90dvh] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-[var(--radius-surface)] bg-[var(--color-surface)] p-5 shadow-xl">
          <Dialog.Title className="text-xl font-bold">
            Move {athlete?.displayName ?? 'athlete'}
          </Dialog.Title>
          <Dialog.Description className="text-sm text-[var(--color-text-muted)]">
            Choose a destination. Placement does not change the athlete&apos;s decision status.
          </Dialog.Description>
          <label className="grid gap-1 font-medium">
            Destination team
            <select
              className="h-11 min-w-0 rounded-[var(--radius-control)] border border-[var(--color-border)] px-3"
              disabled={busy}
              onChange={(event) => setDestination(event.currentTarget.value)}
              value={destination}
            >
              <option value="pool">Athlete pool (unassigned)</option>
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-wrap justify-end gap-3">
            <Dialog.Close asChild>
              <Button disabled={busy} variant="secondary">
                Cancel
              </Button>
            </Dialog.Close>
            <Button
              busy={busy}
              onClick={() => onConfirm(destination === 'pool' ? null : destination)}
            >
              Confirm move
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
