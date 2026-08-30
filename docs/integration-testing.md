# Integration test harness recovery

`npm run test:integration` serializes commands by canonical local Supabase database identity. The
outer runner owns the PostgreSQL advisory-lock session. If its supervisor dies, the runner retains
that lock while the independent reaper stops the exact authenticated command process group and a
recovery-only supervisor attempts authenticated staged cleanup.

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
