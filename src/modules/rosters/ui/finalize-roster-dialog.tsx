'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useState, type RefObject } from 'react';

import { Button } from '../../../components/ui/button';

export function FinalizeRosterDialog({
  busy,
  onConfirm,
  onOpenChange,
  open,
  returnFocusRef,
}: {
  busy: boolean;
  onConfirm(): Promise<void>;
  onOpenChange(open: boolean): void;
  open: boolean;
  returnFocusRef: RefObject<HTMLElement | null>;
}) {
  const [understood, setUnderstood] = useState(false);
  useEffect(() => {
    if (!open) setUnderstood(false);
  }, [open]);

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 grid max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-[var(--radius-surface)] bg-[var(--color-surface)] p-5 shadow-xl"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            returnFocusRef.current?.focus();
          }}
        >
          <Dialog.Title className="text-xl font-bold">Finalize roster version</Dialog.Title>
          <Dialog.Description className="text-sm text-[var(--color-text-muted)]">
            Finalization records an immutable roster snapshot and audit event.
          </Dialog.Description>
          <ul className="list-disc space-y-2 pl-5 text-sm">
            <li>Placements and decisions in this version can no longer be changed.</li>
            <li>Any correction requires a new audited revision.</li>
            <li>Finalization does not send athlete or guardian messages.</li>
            <li>Finalization does not start an export or provider synchronization.</li>
          </ul>
          <label className="flex min-h-11 cursor-pointer items-center gap-3 font-medium">
            <input
              checked={understood}
              disabled={busy}
              onChange={(event) => setUnderstood(event.currentTarget.checked)}
              type="checkbox"
            />
            I understand this roster becomes immutable
          </label>
          <div className="flex flex-wrap justify-end gap-3">
            <Dialog.Close asChild>
              <Button disabled={busy} variant="secondary">
                Cancel
              </Button>
            </Dialog.Close>
            <Button busy={busy} disabled={!understood} onClick={onConfirm}>
              Confirm finalization
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
