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

## Fix round 1

### Status

DONE — all five reviewed synchronization, recovery, lifecycle, notification, and Unicode findings addressed. The authenticated production-browser traversal remains the same honest release-environment gate.

### RED evidence

- Typed HTTP sender probes first received the generic `sync_request_failed`; deterministic 400/401/403/409/413/415 outcomes could not bypass retry and bounded malformed responses were not classified.
- Subscription/retry/stop probes first failed because no event contract or generation fence existed. The StrictMode stop→start probe then demonstrated that a stale lease had no scheduled recovery.
- Real Dexie conflict probes first failed because `resolveConflict` did not exist. They covered exact scope, newest dependent draft, keep-local rebase, server discard, reload, terminal replay fencing, action idempotency, and cross-scope denial.
- Route/outbox probes first accepted NUL and unpaired UTF-16 surrogates. PostgreSQL pgTAP characterized its matching parser rejection codes before the shared TypeScript guard was added.
- The production synchronized browser probe exposed a display/server-snapshot conflation: hydration showed the authoritative server draft instead of the locally recovered draft. Separate display and verified recovery snapshots fixed the root cause.
- Local acknowledgment failure notification first produced no subscriber event, then emitted an immediate scoped recovery event without misclassifying or mutating it as a network failure.

### Delivered

- Conflict resolution is one serialized authenticated-user Dexie transaction. It requires the exact scoped conflict FIFO head and fresh same-evaluation server identity/version/draft, validates both drafts against the stored rubric, retires the head and all dependent queued work, and records digest-bound permanent non-PII terminal fences.
- `keep_local` chooses the newest durable local draft, rebases it to the verified server version under a new mutation identity and monotonic queue sequence, and resumes FIFO. `use_server` replaces the device draft with the server snapshot and removes all discarded local mutations. Exact repeats are idempotent, changed actions fail, cross-scope calls fail, and reopen cannot resurrect discarded IDs or content.
- `SynchronizedEvaluationForm` now drives those durable operations from the existing fresh-snapshot recovery gate. Background retry success, conflict, access removal, deterministic invalid input, retry exhaustion, and local acknowledgment errors publish immediately to the mounted form through a scoped, exception-isolated subscription that is unsubscribed on cleanup.
- The synchronizer now fences start/stop generations. An in-flight request may finish remotely, but a stopped generation never acknowledges locally, claims another head, schedules a stale timer, or emits a stale event. A later generation schedules safe replay at the old lease deadline.
- The sender parses bounded strict non-oracle error envelopes and maps permanent authorization, mutation-identity, and invalid-input responses directly to attention; 429, 5xx, malformed responses, and network loss remain typed transient paths.
- A shared JSON/PostgreSQL string contract rejects NUL and unpaired UTF-16 surrogates before route, IndexedDB, digest, or RPC use while accepting valid supplementary pairs and preserving NFC/NFD. pgTAP and browser canonicalization share an exact nested digest literal.
- The production-component mobile fixture now covers offline/reload plus real synchronized keep-local→sync→edit→sync→reload and use-server→reload/no-resurrection in Mobile Chrome and Mobile Safari.

### Verification

```text
Focused RED suites                                              FAIL for reviewed missing behavior
Focused unit suites after implementation                        PASS (130 tests)
npx supabase db reset --local --no-seed                         PASS (46 migrations)
npx supabase test db --local                                    PASS (29 files / 843 tests)
Unicode pgTAP 029                                                PASS (8 tests)
npm run test:integration, repeated                              PASS twice (19 files / 137 tests)
npm run verify                                                   PASS (format, lint, types, 307 unit tests, build)
npm run test:e2e:evaluation                                     PASS (6 tests; Mobile Chrome + Mobile Safari)
npm audit --audit-level=high                                    PASS (0 vulnerabilities)
git diff --check                                                PASS
```

### Self-review

- No migration rewrite or schema migration was necessary: PostgreSQL `jsonb` already enforces the incompatible-string parser boundary, so additive pgTAP `029` records parity without manufacturing a redundant database function.
- Resolution fences contain only opaque scope/mutation identifiers, reason, timestamp, and integrity digest; no note, score, tag, flag, athlete identity, or contact data enters recovery metadata or events.
- Existing Task 16 physical user partitioning, quotas, immutable digest checks, FIFO counters, leases, fencing, authoritative receipts, compaction, corruption recovery, and teardown rules remain active.
- HTTP/UI messages expose only coarse recovery categories and never reflect response details.
- `progress.md` and unrelated files were not changed.
