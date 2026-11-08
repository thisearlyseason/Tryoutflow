'use client';
import { Button } from '@/components/ui/button';
import type { useFamilyRecovery } from './use-family-recovery';
export function FamilyRecoveryPanel({
  recovery,
  pending,
}: {
  recovery: ReturnType<typeof useFamilyRecovery>;
  pending: boolean;
}) {
  const policy = (
    <p className="text-sm">
      Keep names, contact details and division/position choices in this tab for 30 minutes on a
      device you trust. Date of birth, additional answers and consent are not kept. This copy is
      unencrypted; browser session restore may retain it until expiry.
    </p>
  );
  const clear = (
    <Button type="button" variant="secondary" disabled={pending} onClick={recovery.clear}>
      Clear this form
    </Button>
  );
  return (
    <section
      aria-label="Temporary registration recovery"
      className="mt-5 rounded-xl border border-[var(--color-border)] p-4 space-y-3"
    >
      {recovery.note && <p role="status">{recovery.note}</p>}
      {recovery.mode === 'off' ? (
        <details>
          <summary className="min-h-11 cursor-pointer font-bold">
            Keep an unfinished form temporarily
          </summary>
          <div className="mt-3 space-y-3">
            {policy}
            <p className="text-sm">
              Clearing removes visible details and temporary copies in other open tabs. It does not
              cancel a registration already sent.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                disabled={pending || recovery.blocked}
                onClick={recovery.enable}
              >
                Enable temporary recovery
              </Button>
              {clear}
            </div>
          </div>
        </details>
      ) : recovery.mode === 'unavailable' ? (
        <>
          <p role="status">
            Temporary recovery is unavailable. You can complete the form normally.
          </p>
          {clear}
        </>
      ) : (
        <>
          <h2 className="text-lg font-bold">Temporary recovery</h2>
          {policy}
          {recovery.mode === 'candidate' ? (
            <>
              <p>
                {recovery.stale
                  ? 'The registration form changed. Clear the old copy and complete the current form.'
                  : recovery.invalidChoices
                    ? 'A saved division or position is no longer available. Clear the copy and choose current options.'
                    : 'An unfinished copy was found in this tab. Resume it or clear this form before continuing.'}
              </p>
              <div className="flex flex-wrap gap-2">
                {!recovery.stale && !recovery.invalidChoices && (
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={pending}
                    onClick={recovery.resume}
                  >
                    Resume temporary copy
                  </Button>
                )}
                {clear}
              </div>
            </>
          ) : (
            <>
              <p role="status">
                A temporary copy is kept in this tab. Your registration has not been submitted.
              </p>
              {recovery.record && (
                <p className="text-sm">
                  Expires {new Date(recovery.record.expiresAt).toLocaleTimeString()}.
                </p>
              )}
              {clear}
            </>
          )}
        </>
      )}
    </section>
  );
}
