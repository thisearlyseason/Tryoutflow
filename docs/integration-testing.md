# Integration test harness recovery

`npm run test:integration` serializes commands by canonical local Supabase database identity. The
outer runner owns the PostgreSQL advisory-lock session. If its supervisor dies, the runner retains
that lock while the independent reaper stops the exact authenticated command process group and a
recovery-only supervisor attempts authenticated staged cleanup.

The reaper's exit is not proof of cleanup. Each bounded reaper attempt receives a fresh random
completion capability and may publish once, without replacement, to only that attempt's immutable
proof pathname. Existing, corrupt, or hostile entries are retained and ignored; no safety-critical
retry validates and then removes or overwrites a proof pathname. The HMAC-authenticated proof binds
the attempt capability, run nonce, and launcher's exact PID, process-group ID, and start time. The
outer runner independently verifies that the recorded group is absent before it can
release the lock. A killed, failed, missing, forged, or stale reaper is replaced without releasing
the lock. If the exact launcher identity disappears while members of its recorded group remain,
automatic signaling stops and the runner deliberately holds the lock until an operator has safely
terminated the old command tree; a reused PID or process-group ID is never treated as ownership.
Reaper replacement is bounded to five attempts with capped exponential backoff. Persistent failure
enters a quiescent state: no more reapers are spawned, one diagnostic identifies the authenticated
command-state path and runner PID, and the advisory lock remains held. To terminate that tree, first
use the exact identity procedure below to establish the old group is absent (terminating it if
necessary), then send `SIGTERM` to the reported runner PID. The runner rechecks absence before it can
release the lock; if evidence is unsafe or the group remains, it continues holding the lock.
`SIGINT` and `SIGTERM` handlers remain installed and idempotent throughout this state, so repeated
or mixed signals neither trigger default termination nor duplicate reapers, cleanup, or diagnostics.
At most five immutable attempt proofs are retained per run for manual inspection.
To prune retained proof evidence, first stop every integration runner, supervisor, reaper, and
launcher for that local database identity and finish any authenticated artifact recovery. Then
archive or remove the whole identity directory printed in the recovery diagnostic; do not remove
individual proof pathnames while a runner holds the canonical lock.

Normal completion, command failure, `SIGINT`, and `SIGTERM` automatically stop the owned command
group and clean exact authenticated database roots. Registration rate-counter rows are deliberately
not part of harness cleanup. Integration-only keys include an unguessable per-run namespace, so
leftover rows cannot collide with later runs and remain available to the product's normal expiry
purge.

An uncatchable kill of the whole runner/reaper process tree can leave namespaced local artifacts. Do
not infer ownership from a PID, PostgreSQL application name, filename, or rate-counter key, and do
not bulk-delete counters. Recover locally as follows:

1. Inspect `ps -axo pid=,pgid=,lstart=,command=` for an exact
   `integration-command-launcher.mjs` command and record its PID, process-group ID, start time, and
   full command before signaling it.
2. If that exact recorded identity is still present, send `SIGTERM` to only its recorded process
   group. Re-check the complete identity before an exact `SIGKILL` escalation if it ignores TERM.
3. Run `npm run test:integration -- <focused-test>` again. After it obtains the canonical lock, it
   retries only HMAC-authenticated staged manifest cleanup before creating new fixtures.
4. If authenticated cleanup cannot complete, reset the disposable local Supabase project with
   `npx supabase db reset --local --no-seed`. This is intentionally a manual, local destructive
   recovery choice.

Rate counters left by a hard kill should be allowed to expire normally. A local database reset also
removes them when a completely clean disposable environment is required.
