'use client';
import { Button } from '@/components/ui/button';
import type { useSetupRecovery } from './use-setup-recovery';
export function SetupRecoveryPanel({
  recovery,
  unavailableCycle = false,
  unavailableDetails = false,
  pending = false,
}: {
  recovery: ReturnType<typeof useSetupRecovery>;
  unavailableCycle?: boolean;
  unavailableDetails?: boolean;
  pending?: boolean;
}) {
  return (
    <section aria-label="Device recovery" className="setup-recovery-panel">
      <h3>Device recovery</h3>
      {!recovery.ready ? (
        <p role="status">Checking for an unfinished copy…</p>
      ) : recovery.mode === 'candidate' ? (
        <>
          <p>
            {recovery.stale
              ? 'The saved tryout changed after this copy was made. Review the current saved details; this older copy cannot be resumed.'
              : unavailableDetails
                ? 'Some saved divisions, sessions or related options are no longer available. Discard this copy and review the current setup.'
                : unavailableCycle
                  ? 'The saved cycle is no longer available. Discard this copy and choose a current cycle.'
                  : 'Unfinished event details were found on this device. Resume them or discard the copy before continuing.'}
          </p>
          <div className="flex flex-wrap gap-2">
            {!recovery.stale && !unavailableCycle && !unavailableDetails && (
              <Button
                variant="secondary"
                type="button"
                disabled={pending}
                onClick={recovery.resume}
              >
                Resume recovery copy
              </Button>
            )}
            <Button variant="secondary" type="button" disabled={pending} onClick={recovery.discard}>
              Discard recovery copy
            </Button>
          </div>
        </>
      ) : recovery.mode === 'enabled' ? (
        <>
          <p role="status">
            A recovery copy is kept on this device. Save the form to confirm changes to the tryout.
          </p>
          {recovery.entry && <p>Expires {new Date(recovery.entry.expiresAt).toLocaleString()}.</p>}
          <Button variant="secondary" type="button" disabled={pending} onClick={recovery.discard}>
            Discard recovery copy
          </Button>
        </>
      ) : recovery.mode === 'unavailable' ? (
        <p role="status">
          Recovery is unavailable on this device. You can still enter and save these details
          normally.
        </p>
      ) : (
        <>
          <p>
            Keep these event details on this device for 24 hours. Use a device you trust. Signing
            out clears the copy.
          </p>
          <Button variant="secondary" type="button" disabled={pending} onClick={recovery.enable}>
            Enable recovery
          </Button>
        </>
      )}
    </section>
  );
}
