# Task 17 report — idempotent evaluation synchronization

## Status

DONE, with the authenticated production-browser exercise retained as a release gate.

## TDD evidence

- Initial application RED: the focused integration suite failed because `sync-evaluation-mutation` did not exist.
- Initial route RED: the focused route suite failed because the evaluation mutation endpoint did not exist.
- Canonical-digest RED: the first database run could not resolve the qualified digest function; after qualification, the exact browser/server parity assertion exposed the need for recursive ASCII-key canonicalization.
- Route retryability RED: an unexpected authentication/storage exception returned `400`; it now returns retryable `503`, while malformed input remains `400` and streamed oversize input is rejected as `413` before authentication.
- Synchronizer transition RED: an IndexedDB acknowledgment failure was caught and mislabeled as a network failure; only sender failures now enter network backoff, while local transition failures propagate truthfully.
- Browser-bundle RED: the client synchronizer imported a server-only module and pulled `next/headers` into the fixture bundle. The strict transport schemas now live in a client-safe contract.
- SSR/StrictMode RED: server rendering touched IndexedDB, then development cleanup closed the shared repository before the second effect setup. The component now renders an accessible preparation state until browser storage is ready and stops synchronizers/listeners without invalidating the persistent per-user repository.
- Completion-authority RED: an older server receipt could mark a newer queued local revision as confirmed. Completion now requires a receipt for the same evaluation at least as new as the optimistic local version.
- Lost-response/multi-tab RED coverage exercises retry backoff with the same mutation ID and shared-database lease fencing; only one server write and one tab send are accepted.

## Delivered

- Additive migration `202608280046_evaluation_mutations.sql` adds actor-bound immutable receipts and the `sync_evaluation_mutation` security-definer command. It derives the actor from `auth.uid()`, rechecks active membership and exact evaluator assignment at execution time, binds the tenant/session/registration/published rubric/evaluation natural key, and atomically writes the evaluation children plus receipt.
- Browser and PostgreSQL canonicalizers now agree on recursively sorted object keys, preserved array order, and compact JSON. The pgTAP suite asserts the exact SHA-256 literal `f502ce258ac95f0b687f5e154b2b5550176057b981ebb06422a67c0edac8c869`.
- Exact replays return the stored byte-equivalent receipt without another evaluation or version. Reusing a client mutation ID with changed scope/version/evaluation/draft raises `TF409`. Stale versions return a recoverable conflict and preserve the existing score/version.
- Assignment revocation and session-rubric changes fail closed at execution time and leave server evaluation data unchanged. Receipts contain identifiers, digest, versions, outcome, and timestamp only—no note, score, athlete identity, or peer data.
- The same-origin route enforces authenticated user lookup, exact JSON MIME, fatal UTF-8 JSON parsing, strict Zod allowlists, path-bound evaluation identity, announced and streamed 128 KiB caps, live membership lookup, and typed `400/401/403/409/413/415/503` responses.
- The Task 16 v5 repository now feeds a FIFO synchronizer with single-instance flush coalescing, shared-tab lease/fencing, online start/stop/flush lifecycle, exponential retry scheduling, exact receipt validation, exact successor-version acknowledgment, and permanent attention mapping for conflict/access/rubric/corruption outcomes.
- The production evaluator page uses `SynchronizedEvaluationForm`. Offline saves commit context, draft, and mutation before claiming `Saved on device`; reconnect confirms `Saved on server`; reload hydrates the scoped device draft; conflicts retain recovery UI; completion stays blocked until the optimistic revision has an equal-or-newer server receipt.
- Generated database types include the new table and RPC and were generated twice byte-identically.

## Verification

```text
Initial focused application/route tests                            RED (missing modules)
Canonical digest qualification/parity probes                      RED, then GREEN
Route unexpected-failure probe                                    RED (400 vs 503), then GREEN
Local-ack classification probe                                    RED (resolved/network), then GREEN
Older-receipt completion probe                                    RED (completion invoked), then GREEN
npx supabase db reset --local --no-seed                            PASS (46 migrations)
npx supabase test db --local                                      PASS (28 files / 835 tests)
Task 17 pgTAP                                                     PASS (19 tests)
focused synchronization integration, repeated                     PASS twice (2 tests)
npm run test:integration, repeated                                PASS twice (19 files / 137 tests)
npm run verify                                                    PASS (format, lint, types, 280 unit tests, build)
npm run test:e2e:evaluation                                       PASS (4 tests; Mobile Chrome + Mobile Safari)
npm audit --audit-level=high                                      PASS (0 vulnerabilities)
database.types.ts reproducibility                                 PASS (SHA-256 08d48e13dd3426e9ecf2ea0e8778612fb8c2d2c4809fa76c61ef8dab6745f71e twice)
git diff --check                                                  PASS
```

## Browser evidence and release gate

- The browser fixture imports the production form, synchronizer, Task 16 repository, transport contract, and canonical digest logic. Mobile Chrome and Mobile Safari prove offline durable save with zero requests, reconnect with one request, reload recovery, server-conflict recovery, mobile touch sizing, and accessibility checks.
- This checkout does not provide an authenticated production-browser fixture or credentials, and local Supabase reports the auth service stopped. The browser endpoint is therefore a deliberately non-routable fixture endpoint, not evidence that production cookies, live membership lookup, Next route, PostgREST, and PostgreSQL were traversed in one browser request. A staging/local authenticated run of that complete chain remains a release gate.
- The real local PostgreSQL security/atomicity boundary is covered by pgTAP, the Next route boundary is covered with production route tests, and the production client components are covered in both mobile engines. No stronger end-to-end claim is made.

## Self-review

- Kept migration history additive and used the required non-colliding `202608280046_*` / `028_*` names.
- Preserved Task 14’s evaluation lifecycle and private write permit rather than creating a competing persistence path.
- Reused Task 16’s authenticated physical database, full-scope keys, immutable digest, FIFO counters, leases, fencing tokens, backoff, receipts, quarantine, and teardown semantics; no cross-user lookup was added.
- Split server-only dependencies from client-safe schemas after browser compilation exposed the boundary violation.
- Narrowed network error handling so a local durable-state failure cannot be rewritten as a remote response failure.
- Added automatic bounded retry scheduling while the synchronizer is running and cancellation on stop; retries reuse the exact immutable client mutation ID and payload.
- Prevented an older acknowledged queue head from authorizing completion of a newer pending revision.
- `progress.md` and unrelated files were not changed.
