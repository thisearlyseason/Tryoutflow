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

## Fix round 2

### Status

DONE — authoritative identity remapping, exact receipt-gated confirmation, durable resolution replay, generation fencing, and streaming response caps are addressed. The authenticated production-browser traversal remains the same release-environment gate.

### RED evidence

- A natural-key conflict returned only the provisional evaluation ID; fake-IndexedDB remap tests first could not reconcile a different authoritative ID, and the synchronized mobile fixture kept recovery disabled after the server identity changed.
- Keep-local resolution initially promoted `Saved on server` through an `expectedVersion + 1` fallback with no receipt. The enhanced mobile flow held the browser offline during resolution and exposed that completion remained visually enabled while only device durability existed.
- Existing action-only tombstones accepted a changed server snapshot and reconstructed replay results from mutable current draft state. Concurrent opposite tab decisions had no exact result-bound replay record.
- StrictMode stop→start could schedule retry and publish from an old generation after awaited sender/storage work.
- Success responses used `response.json()` and error responses used `response.text()`, allocating the complete body before the byte check.

### Delivered

- Additive migration `202608280047_authoritative_evaluation_conflicts.sql` preserves the original immutable client/evaluation mutation identity while augmenting exact-scope natural-key conflict receipts with `serverEvaluationId`. The wrapper remains actor-bound, delegates all authorization and atomic mutation behavior to the prior command, and stores the augmented byte-equivalent replay receipt before commit.
- Conflict attention persists the verified authoritative ID/version from the receipt. Resolution requires the exact physical user/scope, original client ID/evaluation ID/payload digest/FIFO sequence, authoritative server ID/version, and canonical server snapshot digest. Arbitrary ID/scope/rubric/snapshot swaps fail closed.
- Keep-local atomically retires the original queue, rebases the newest durable local draft onto the authoritative evaluation and queue identity, and creates one successor mutation. Use-server atomically replaces the draft with the authoritative snapshot and permanently discards the local lineage. Reload, teardown, and cleanup retain permanent fences.
- The conflict-head tombstone now stores a bounded privacy-safe resolution record: action, original lineage/digests, authoritative identity/version/snapshot digest, and exact successor mutation/sequence/draft digest or discard marker. No notes, scores, athlete identity, or contact data are copied. Exact replay returns the stored result; changed action/snapshot/identity conflicts; concurrent tabs serialize to one winner.
- Keep-local remains `Saved on device` and completion is disabled until the exact new successor receipt exists. Missing receipt/offline/transient/attention paths retain the draft; the later background receipt alone promotes `Saved on server` and completion authority. The optimistic version is never treated as confirmation.
- Every awaited synchronizer transition is generation-fenced before emit, retry, continuation, or recursion. New-generation recovery is scheduled only by start/current-generation callbacks; stale sends and acknowledgements cannot publish into new subscribers.
- Both response paths share a streaming actual-byte reader with strict MIME and announced-length preflight, actual chunk caps, early cancellation, fatal UTF-8 decode, JSON parse, and strict Zod envelope validation. Missing/lying lengths and split multibyte/oversize bodies are covered without full-body allocation.
- The production-component mobile fixture now exercises a provisional `fefe…` mutation remapped to authoritative `eded…`, reload recovery, offline keep-local, blocked completion, background receipt promotion, an authoritative-ID network send, and both keep/discard reload outcomes in Mobile Chrome and Mobile Safari.

### Verification

```text
npx supabase db reset --local --no-seed                         PASS (47 migrations)
npx supabase test db --local                                    PASS (29 files / 847 tests)
npm run test:integration, repeated                              PASS twice (19 files / 137 tests)
focused outbox/synchronizer/form unit suites                    PASS (125 focused tests)
npm run verify                                                  PASS (format, lint, types, 310 unit tests, build)
npm run test:e2e:evaluation                                     PASS (6 tests; Mobile Chrome + Mobile Safari)
npm audit --audit-level=high                                    PASS (0 vulnerabilities)
git diff --check                                                PASS
```

### Self-review

- Migration 046 and Task 16 primary-key/schema history remain untouched; migration 047 is additive and the browser record extension is schemaless within the existing integrity-digested tombstone store.
- The SQL wrapper does not preflight natural identity before the legacy authorization boundary, so it adds no cross-tenant existence oracle. Advisory locking remains held until the augmented receipt commits.
- Server identity can change only when it matches the conflict receipt already persisted on the exact queue head; UI freshness merely enables the action, while the repository remains the durable authority.
- Resolution metadata contains UUIDs, versions, sequence numbers, and SHA-256 digests only. Raw local/server drafts remain in their existing scoped draft/mutation stores, not in replay metadata.
- Authenticated production cookies, live membership lookup, Next route, PostgREST, and PostgreSQL in one browser request still require the documented staging/local authenticated release run; no stronger claim is made.
- `progress.md` was not changed.

## Fix round 3

### Status

DONE — hydration authority, exact UI lineage, and authoritative remap queue validation are addressed. The authenticated production-browser traversal remains the same release-environment gate.

### RED evidence

- A quota failure after the draft write timed out under the first nested-transaction experiment and the original two-step UI could commit a draft without an outbox row. The final single Dexie transaction rolls both records and the counter back together.
- A legacy `saved_device` draft with no mutation had no repair API, while a forged `synced` draft without any receipt lineage could inherit SSR confirmation. Focused fake-IndexedDB probes failed before reconciliation was added.
- Two provisional evaluation queues both at sequence `1` exposed that UI hydration and background confirmation sorted queue-local sequences globally. The exact second evaluation/digest now wins regardless of the unrelated queue.
- A target authoritative queue with sequence `1` and counter `9` was accepted by keep-local remap. The failing probe also verified the original conflict was at risk of retirement before strict target validation.
- The first synchronized browser run exposed a recovery regression: a durable conflict reload had a verified authoritative SSR snapshot, but a background conflict notification overwrote its freshness and disabled both resolution actions. Freshness is now carried only when the stored conflict's authoritative ID/version exactly match SSR.

### Delivered

- `saveDraftAndEnqueueMutation` parses and hashes once, then commits the scoped draft, fresh mutation, monotonic counter, quotas, and rubric validation in one all-tables transaction. A failed enqueue leaves neither a draft nor partial counter lineage.
- `reconcileDraftLineage` binds hydration to the exact scope, evaluation identity, expected/server version, canonical payload digest, and client mutation lineage. It reconstructs only a `saved_device` draft through a CAS-safe pending mutation. An unprovable `synced` draft becomes durable `needs_attention`; content is never deleted or guessed as server state.
- Exact receipts confirm the matching draft, and a validated permanent `receipt_authority` tombstone continues that authority after acknowledged-mutation and receipt compaction. Older/equal/newer SSR probes preserve newer exact local authority, accept an actually newer authoritative snapshot, and never let SSR confirm device-only work.
- The synchronized form tracks one active client mutation lineage. Hydration, success/attention events, receipt lookup, conflict-head selection, and remap successor recovery require that exact ID/evaluation/version/digest. Queue sequence is used only inside its evaluation queue and is never compared globally.
- Keep-local remap validates all scoped mutation records, the complete target queue through Task 16's `validateQueueLineage`, strict contiguous retained sequences, exact target counter continuation, and every scoped receipt/tombstone before writing a successor or retiring the original. Corrupt/missing/behind/ahead lineage fails in the same transaction.
- Concurrent target enqueue/remap serializes to one valid target queue with sequences `[1, 2]`; the original conflict is retired only in the successful transaction. Existing opposite-action multi-tab resolution fencing remains intact.
- Mobile Chrome and Safari now exercise a legacy crash-gap by deleting the queued mutation after a durable device save, reloading with sends blocked, verifying the local draft and disabled completion, then observing exactly one reconstructed synchronization.

### Verification

```text
npx supabase db reset --local --no-seed                         PASS (47 migrations)
npx supabase test db --local                                    PASS (29 files / 847 tests)
npm run test:integration, repeated                              PASS twice (19 files / 137 tests)
focused outbox/synchronizer/form suites                         PASS (133 tests before final SSR probe)
npm run verify                                                   PASS (format, lint, types, 318 unit tests, build)
npm run test:e2e:evaluation                                     PASS (6 tests; Mobile Chrome + Mobile Safari)
npm audit --audit-level=high                                    PASS (0 vulnerabilities)
git diff --check                                                PASS
```

### Self-review

- No migration or IndexedDB schema rewrite was needed. The prevention is transactional in the existing v5 store; backward compatibility is a bounded reconciliation of already-valid stored drafts.
- Reconstruction cannot overwrite server data: it reuses the persisted base version and exact digest, so the normal server CAS either acknowledges that draft or returns recoverable conflict.
- Receipt/tombstone confirmation is content-bound by recomputing the canonical payload digest at the receipt's expected version. A UUID, version, queue sequence, or broad `synced` flag alone is never authority.
- Strict remap checks happen before conflict retirement in one serialized transaction. Any validation, quota, digest, counter, or write failure rolls back the draft, successor, counter, and original conflict changes together.
- Recovery metadata remains bounded identifiers, versions, and SHA-256 digests. No score, note, athlete identity, guardian/contact field, or other draft content was added to tombstones or quarantine.
- Authenticated cookies, live membership, the production Next route, PostgREST, and PostgreSQL in one browser request still require the documented staging/local authenticated release run; no stronger claim is made.
- `progress.md` was not changed.
