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

## Fix round 4

### Status

DONE — the displayed newest draft and its earliest blocking FIFO predecessor are now separate durable lineage facts; strict target validation and resolution replay no longer trust partial or stale terminal state.

### RED evidence

- Focused outbox probes first returned `saved_device` with no blocker when sequence 1 was conflicted and sequence 2 backed the displayed draft, both for one evaluation ID and for a provisional-to-authoritative ID mapping.
- A keep-local remap into an empty target first succeeded despite an invalid scoped receipt or receipt tombstone because strict append returned before terminal validation.
- Exact resolution replay first returned the tombstone result after the successor draft was changed without revalidating any live or terminal successor proof.

### Delivered

- `reconcileDraftLineage` returns the newest exact draft mutation and the earliest related queue head independently. Conflict mappings propagate the natural lineage across provisional and authoritative evaluation IDs, while all physical reads remain exact-scope. Claim selection fences mapped successor queues behind a predecessor needing attention.
- Conflict recovery is bound to the exact blocking head. Keep-local selects the newest durable local draft, removes its mapped dependent chain, and rebases one authoritative successor; use-server discards that exact chain. The synchronized form listens to both displayed and blocking mutation events, suppresses confirmation/completion authority while a predecessor remains, and selects the successor by mutation ID, evaluation ID, version, queue sequence, and payload digest.
- Strict target append validates all physically scoped receipts and tombstones, terminal-pair consistency, scoped quarantine envelopes, mutation lineage, and the target counter before every return, including empty mutation/counter targets. Invalid targets roll the transaction back with the original conflict unchanged.
- Resolution tombstones now bind the result payload digest. Replays prove an exact live successor and its queue/context or an exact receipt/receipt-authority tombstone after compaction; divergent draft, payload digest, version, queue sequence, evaluation identity, or missing proof returns `corrupt_record` instead of success.
- Mobile Chrome and Mobile Safari hold the real production component's conflict response while a newer edit is durably queued, then prove the conflict remains visible, reload recovers the newest draft, keep-local resolves that newest draft, and synchronization resumes.

### Verification

```text
Focused RED outbox probes                                      FAIL (5 reviewed gaps), then GREEN
Focused outbox/form unit tests                                 PASS (116, then 76 expanded outbox cases)
npm run test:unit                                              PASS (32 files / 329 tests)
npm run test:integration, repeated                             PASS twice (19 files / 137 tests)
npx supabase db reset --local --no-seed                        PASS (47 migrations)
npx supabase test db --local                                   PASS (29 files / 847 tests)
npm run verify                                                 PASS (format, lint, types, 329 unit tests, build)
npm run test:e2e:evaluation                                    PASS (6 tests; Mobile Chrome + Mobile Safari)
npm audit --audit-level=high                                   PASS (0 vulnerabilities)
git diff --check                                               PASS
```

### Release gate

The authenticated production-browser traversal remains a release-environment gate. The browser fixture imports the real synchronized form, repository, synchronizer, and conflict recovery path; PostgreSQL and the production route remain covered at their real security boundaries separately.

## Fix round 5

### Status

DONE — the newest recovery input is transactionally authoritative, strict append validates the physical/embedded IndexedDB union, and already-mounted tabs reconcile predecessor conflicts and permanent winners without reload.

### RED evidence

- The newest-recovery probe first rebased the older IndexedDB digest instead of the explicit in-memory Unicode edit.
- Seven fake-IndexedDB probes first resolved successfully despite target-attributable malformed records hidden in session contexts, drafts, mutations, receipts, tombstones, counters, and quarantine under string, number, Date, and Array keys.
- The already-mounted sibling synchronizer first received zero events when the other tab discovered the predecessor conflict.
- Browser design exposed that a non-resolving tab could remain in recovery after the sibling's exact successor receipt; receipt-bound sibling resolution coverage now closes that state only after durable confirmation.

### Delivered

- `resolveConflict` requires the exact newest local recovery draft, strictly validates its schema, PostgreSQL-compatible Unicode, rubric categories and values, computes its canonical digest, and persists/rebases it in the same all-store transaction that validates the authoritative server snapshot and retires the blocker. Exact replay is bound to that result digest. `use_server` discards the supplied local draft only through the explicit action.
- Keep-local resolution disables editing during the transaction. A pending result marks only the exact UI revision device-durable, preventing a duplicate reconnect enqueue; server authority, cache clearing, completion, and `Saved on server` still require the matching successor receipt.
- Strict append scans primary-key/value pairs across all seven relevant stores and takes the union of trusted physical prefixes and embedded scope/recovery metadata. Typed key comparison covers legal IndexedDB string/number/Date/Array/binary shapes. Physical/embedded divergence, malformed counters, duplicate/colliding lineage, and corrupt terminal records fail before retirement and roll the whole transaction back. Valid unrelated scope records remain accepted.
- Per-physical-user-database BroadcastChannel propagation carries only protocol plus scope/client/evaluation IDs and state. Messages are strict-schema and exact-scope validated; malformed, foreign, duplicate, out-of-order, throwing-subscriber, start/stop/StrictMode, and close paths are isolated. Unsupported/failed channels use a deterministic scoped polling pulse.
- Every mounted synchronized form re-queries durable natural lineage for every same-scope signal rather than filtering pre-known mutation IDs. Both tabs surface an unknown predecessor conflict; the exact receipt-backed winner clears the sibling recovery and replaces its local display/cache only after durable confirmation.
- Mobile Chrome and Mobile Safari assert the authoritative successor POST body contains the delayed newest edit, immediate reload after server confirmation preserves it, offline successor remains device-only, and a two-tab sequence-1 conflict/sequence-2 draft is visible in both tabs and resolved once for both.

### Verification

```text
Focused RED newest-draft / physical-union / cross-tab probes       FAIL, then GREEN
Focused outbox/synchronizer/form unit suites                       PASS (157 tests)
npx supabase db reset --local --no-seed                            PASS (47 migrations)
npx supabase test db --local                                       PASS (29 files / 847 tests)
npm run test:integration, repeated                                 PASS twice (19 files / 137 tests)
npm run verify                                                     PASS (format, lint, types, 342 unit tests, build)
npm run test:e2e:evaluation                                        PASS (8 tests; Mobile Chrome + Mobile Safari, including multi-tab)
npm audit --audit-level=high                                       PASS (0 vulnerabilities)
git diff --check                                                   PASS
```

### Release gate

Authenticated production cookies, live membership lookup, the production Next route, PostgREST, and PostgreSQL in one browser traversal still require the documented staging/local authenticated release run. The fixture imports the real production client components and persistence/synchronization paths; no stronger end-to-end authentication claim is made.

## User-authorized exceptional remediation

### Status

DONE — the four parked findings are addressed without starting Task 18. The authenticated production-browser traversal remains the documented release-environment gate.

### RED evidence

- Seven typed-key fake-IndexedDB cases proved `use_server` could replace the draft and retire conflict lineage while target-attributable corruption existed in each of session contexts, drafts, mutations, receipts, tombstones, counters, and quarantine.
- A use-server replay with a changed local draft returned the prior successful result because the tombstone bound only the server/result draft digest.
- The cross-tab protocol accepted duplicate and non-increasing messages, and UI fallback logic could derive recovery from an event payload after durable lineage no longer contained a blocker.
- A receipt-bound sibling resolution overwrote an edit made after the local recovery panel opened.
- The fixture kept authoritative IDs, receipts, versions, and forced-conflict markers in user-agent-global maps, allowing Mobile Safari runs to inherit prior tests.

### Delivered

- Both conflict actions and their replay path enter the same seven-store physical-plus-embedded union validator before reading or changing resolution lineage. Live resolutions additionally validate terminal pairs, all scoped queue/counter lineage, target counters, duplicates, gaps, and quarantine integrity before replacing a draft or retiring predecessors. Every failure rolls the all-store transaction back with the original blocker, newest draft, dependents, counters, fences, and resolution records unchanged.
- Conflict tombstones now store a separate canonical `resolutionInputLocalDraftDigest` for both actions. Exact replay requires the same action, original lineage, authoritative snapshot, and exact local input digest; changed/newer local input fails without mutation. Resolution metadata remains bounded UUID/version/sequence/SHA-256 data only—no note, score, tag, flag, athlete identity, or contact content.
- Durable reconciliation exposes exact keep-local receipt/tombstone lineage and exact use-server tombstone authority. The form preserves edits made after recovery opened instead of replacing them with a sibling winner, while unchanged recovery state still accepts the exact durable sibling result.
- Cross-tab protocol v2 uses a random per-instance UUID, authenticated user binding, strict exact-scope schema, and monotonic per-source sequence. It ignores self, duplicate, non-increasing, malformed, wrong-user, and wrong-scope messages; source tracking is bounded. Remote messages and polling are re-query pulses only. UI reconciliation is serialized and derives exclusively from current durable lineage, so stale attention cannot recreate recovery after a receipt/resolution.
- Fixture state is namespaced by project, test ID, retry, and repeat index rather than user agent. Browser gates use explicit durable request/receipt/reload assertions and retain exact successor bodies.

### Verification

```text
Focused use-server physical-union and replay probes               RED (8 failures), then GREEN
Focused outbox/synchronizer/form suites                           PASS (166 tests)
npm run test:integration, repeated                                PASS twice (19 files / 137 tests)
npx supabase db reset --local --no-seed                           PASS (47 migrations)
npx supabase test db --local                                      PASS (29 files / 847 tests)
npm run verify                                                    PASS (format, lint, types, 351 unit tests, build)
npm run test:e2e:evaluation                                       PASS (8/8; Mobile Chrome + Mobile Safari)
Mobile Safari reconnect + durable-conflict --repeat-each=10       PASS (20/20; ten each)
npm audit --audit-level=high                                      PASS (0 vulnerabilities)
git diff --check                                                  PASS
```

### Self-review

- The destructive boundary is one Dexie all-store transaction. Validation precedes draft replacement, predecessor deletion, tombstone insertion, counter mutation, and successor append; rejected probes retain byte-equivalent durable snapshots.
- Receipt/tombstone authority remains exact identity/version/payload/draft-digest lineage. A broad `synced` flag or event state is never enough to confirm, discard, or overwrite a draft.
- Broadcast and resolution records contain only bounded opaque identifiers, state, counters, protocol metadata, and digests. Raw evaluator content never enters them.
- No migration or IndexedDB version rewrite was needed. Existing valid v5 records remain readable; newly written conflict-resolution tombstones use the strengthened complete-resolution schema.
- `progress.md` and Task 18 were not changed.

## Revised-scope fix round 2 — repository time and exact draft authority

### Status

DONE — destructive proof freshness is repository-clock authoritative and `use_server` requires one
exact durable draft matching the validated newest queue tail. Task 18 was not started. The
authenticated production-browser chain remains the documented release-environment gate.

### RED evidence

- Proof registration and conflict resolution publicly accepted caller-provided `now`; a caller could
  backdate an expired signed proof. Exact +5,000 ms future skew also could not be tested through a
  repository-owned clock.
- A valid conflict queue with its scoped draft physically deleted still passed the conditional draft
  comparison and could consume the proof while retiring local work.

### Delivered

- `registerAuthoritativeSnapshotProof` and `resolveConflict` expose no time input. The destructive
  input uses a strict runtime schema, so an unknown `now` or legacy freshness object is rejected
  before hashing or storage. Compile-time probes also reject both public time forms, and the bound
  module wrapper cannot accept a clock.
- Each repository captures its clock function once at construction. Production accepts only the
  module-private system UTC clock; deterministic fake clocks are limited to the test runtime and
  cannot be swapped through the auth wrapper or by replacing the injected object's method later.
- Signature verification and current-time validation run inside the serialized all-store Dexie
  transaction. The repository rereads time immediately after verification and again before proof
  registration, server-draft replacement, conflict retirement, replay consumption, and final proof
  consumption. Crossing expiry during transactional work rolls every store back.
- A live destructive resolution now requires the exact physical scoped draft. Its scope,
  evaluation identity, expected version, payload digest, canonical content digest, and rubric
  validity must equal the newest fully validated queue tail and the explicitly confirmed local
  input. Missing, duplicate/physically divergent, stale, or corrupt draft authority fails before
  proof consumption or any draft/mutation/counter/tombstone change.
- Exact terminal replay requires the stored server draft to remain byte/digest equivalent. Deleting
  it fails byte-exactly; restoring the exact record permits the same durable replay. Concurrent
  teardown and resolution serialize without a missing-draft crash gap.

### Verification

```text
Focused caller-time and missing-draft probes                     RED, then GREEN
Focused offline outbox                                           PASS (92/92)
npm run verify                                                    PASS (format, lint, types, 354 unit tests, build)
npm run test:integration, repeated                               PASS twice (19 files / 137 tests)
npx supabase db reset --local --no-seed                           PASS (47 migrations)
npx supabase test db --local                                      PASS (29 files / 847 tests)
npm run test:e2e:evaluation, repeated                             PASS twice (8/8; Mobile Chrome + Mobile Safari)
npm audit --audit-level=high                                      PASS (0 vulnerabilities)
git diff --check                                                  PASS
```

### Self-review

- Clock/freshness checks are inside the same transaction as every destructive write; expiry or
  invalid input produces byte-equivalent rollback and leaves an unconsumed proof reusable after
  exact draft restoration.
- The exact future-skew boundary accepts issued-at `clock + 5,000 ms` and rejects `+5,001 ms`.
  Expiry is exclusive: `expiresAt <= clock` is invalid.
- The new clock and strict input schema add no persistence fields, migration, raw evaluator content,
  or PII-bearing recovery metadata. Existing proof crypto, terminal fences, stale cross-tab guard,
  and `use_server`-only public contract are preserved.
- `progress.md` and Task 18 were not changed.

## MVP scope-revision review fix round 1

### Status

DONE — destructive server acceptance is bound to the newest durable local authority and a
short-lived server-signed snapshot proof. The public conflict action is `use_server` only; legacy
keep-local records remain read-compatible but cannot be requested through the repository API.
Task 18 was not started.

### RED evidence

- A sequence-1 conflict dialog could discard a sequence-2 sibling edit because its explicit local
  input was compared with the opened dialog rather than the newest related durable queue tail.
- Caller booleans `{ online: true, fresh: true }` were accepted as freshness provenance, and
  `keep_local` remained present in the public action type.
- The browser exercised Copy/Download controls but did not inspect the clipboard bytes or downloaded
  file, so an incorrect or PII-expanded export could pass.
- Two already-mounted tabs could race registration of distinct render nonces for the same exact
  server snapshot; registration order made one valid tab spuriously stale.

### Delivered

- `use_server` scans and validates the complete related natural lineage inside the same all-store
  Dexie transaction. The explicit local evaluation ID, expected version, canonical full-payload
  digest, and content must equal the newest live queue tail, and the stored draft must agree with
  that tail. Ambiguous queues, stored-draft/queue divergence, corruption, or a newer sibling edit
  reject before any draft, mutation, tombstone, proof-consumption, or counter write.
- An in-page edit made while conflict synchronization is in flight is first appended as ordinary
  durable recovery work only when the conflict head is still the exact durable tail. The first
  destructive attempt then reports `stale_local_draft`, reloads the newest durable draft, closes the
  confirmation, and requires a new two-step confirmation for those exact bytes. A concurrent sibling
  append and discard serialize so the append winner is never silently removed.
- The repository's public `resolveConflict` accepts only `action: 'use_server'`; a compile-time
  `@ts-expect-error` assertion proves `keep_local` is unavailable, and a cast runtime request is
  rejected before storage as defence in depth. Legacy tombstone parsing remains storage-only and
  fails closed for append/replay authority.
- The authenticated server render now issues a bounded P-256-signed proof over the exact user,
  evaluator, organization, tryout, session, registration, rubric, evaluation ID/version, canonical
  server draft digest, issued/expiry time, and random render nonce. The private JWK is server-only;
  the repository verifies with the public JWK before durable registration and again inside the
  destructive transaction. Missing, forged, edited, expired, wrong-scope, wrong-user, wrong-digest,
  changed-snapshot, and consumed proofs fail closed. Up to five independently signed nonces may be
  retained only for byte-identical snapshots so already-mounted tabs do not depend on registration
  order; a changed snapshot replaces the set.
- The proof threat boundary covers untrusted caller input, stale tabs, storage corruption, and replay.
  It does not claim protection from arbitrary compromised same-origin script, which can already read
  evaluator content and control that origin's IndexedDB. Deployment must configure a matching P-256
  private/public JWK pair; `.env.example` documents both variables without shipping a private key.
- Mobile Chrome and Safari now inject an observable production-component clipboard adapter and assert
  the exact copied JSON. Playwright reads the downloaded file and asserts the exact newest note,
  scores, tags, flags, and context while rejecting athlete name/number/registration identity fields.
  The flow retains offline blocking, verified server acceptance, reload, and deliberate ordinary-save
  body assertions.

### Verification

```text
Focused stale-authority/proof/public-type/form suites             PASS (140 tests)
npm run verify                                                     PASS (format, lint, types, 349 unit tests, build)
npm run test:integration, repeated                                 PASS twice (19 files / 137 tests)
npx supabase db reset --local --no-seed                            PASS (47 migrations)
npx supabase test db --local                                       PASS (29 files / 847 tests)
npm run test:e2e:evaluation                                        PASS (8/8; Mobile Chrome + Mobile Safari)
Mobile Safari exact export + mounted-tab conflict --repeat=10      PASS (20/20)
npm audit --audit-level=high                                       PASS (0 vulnerabilities)
git diff --check                                                   PASS
```

### Self-review

- Every destructive authority check and proof revalidation occurs before mutations in the same
  serialized all-store transaction; stale/corrupt probes assert byte-equivalent rollback.
- The proof contains only scoped UUIDs, version, SHA-256 digest, timestamps, nonce, and signature.
  Neither proof nor conflict terminal metadata contains note, score, tag, flag, athlete name, contact,
  or jersey/tryout number data.
- Exact idempotent replay remains content-bound. A proof is consumed by resolution identity, and a
  changed live head cannot reuse it; identical concurrent confirmations return one identical durable
  outcome.
- No database migration or IndexedDB version change was introduced. `progress.md` and Task 18 were
  not changed.

## User-authorized MVP scope revision — final verification

### Status

DONE — automatic `keep_local` rebasing and chained successor creation are deferred for the MVP.
Conflicts now fail closed while preserving the newest local draft for exact copy/download. The only
destructive recovery is explicit `use_server`, gated by online state, a freshly verified server
snapshot, and the exact current local input digest. Keeping local work is a deliberate manual flow:
export it, accept server, then paste or re-enter it as a new ordinary save. Task 18 was not started.
The authenticated production-cookie browser chain remains the release-environment gate.

### Verification

```text
npm run verify                                                     PASS (format, lint, types, 346 unit tests, build)
npm run test:integration && npm run test:integration               PASS twice (19 files / 137 tests each)
npx supabase db reset --local --no-seed                            PASS (47 migrations)
npx supabase test db --local                                       PASS (29 files / 847 tests)
npm run test:e2e:evaluation                                        PASS (8/8; Mobile Chrome + Mobile Safari)
Mobile Safari conflict/export flow --repeat-each=10                PASS (20/20)
npm audit --audit-level=high                                       PASS (0 vulnerabilities)
git diff --check                                                   PASS
```

### Self-review

- Production attempts to request legacy `keep_local` are rejected before hashing or opening the
  all-store transaction, so they cannot alter drafts, queues, counters, receipts, tombstones, or
  recovery metadata.
- Legacy keep-local resolution artifacts remain schema-readable and exportable, but reconciliation,
  replay, and future append fail closed without sequence reuse.
- `use_server` validates the full seven-store physical and natural lineage before mutation. Offline,
  stale-provenance, changed-input, counter, terminal-prefix, and exact-replay failures preserve the
  durable state byte-for-byte.
- The UI exposes Copy Local Draft and Download Local Draft, no Keep Local action. Use Server requires
  a fresh online comparison and a second confirmation; an intervening edit cancels the action and
  requires reconfirmation.
- Repeated use-server groups, sequence-1 heads with sequence-2/3 dependents, exact replay, compaction,
  and a subsequent ordinary sequence-4 append are covered. The browser flow proves export, offline
  blocking, online server acceptance, reload, and a deliberate new ordinary save.
- `progress.md` and Task 18 were not changed.

## User-authorized MVP scope revision — defer automatic keep-local recovery

### Decision

Automatic `keep_local` rebasing and chained conflict successor creation are deferred for the MVP.
The supported conflict workflow is now fail-closed export plus a verified online `use_server`
discard. An evaluator who wants the local work copies or downloads it, accepts the fresh server
draft, then deliberately pastes or re-enters the work as a new ordinary online save.

### RED evidence

- A production repository call accepted `keep_local` and created a successor mutation.
- A destructive `use_server` call accepted explicitly offline or stale provenance.
- The UI exposed Keep Local and had no confirmation snapshot that could detect an edit made after
  the destructive dialog opened.

### Delivered

- The public repository action documents `keep_local` as unsupported and rejects it before parsing,
  hashing, opening IndexedDB, or reading replay state. The synchronized production path calls only
  `use_server` with explicit `{ online: true, fresh: true }` provenance. Explicitly offline/stale
  provenance is rejected before mutation.
- `use_server` retains the complete seven-store physical/natural validation, exact newest-local
  digest binding, atomic retirement of the conflict and dependents, permanent terminal fencing,
  replay validation, and exact future counter continuation. It never creates a resolution successor.
- Legacy keep-local tombstones remain schema-readable. Reconciliation returns their preserved draft
  as `needs_attention` without resolution authority; append/replay fails closed so sequence cannot be
  reused.
- The recovery UI removes Keep Local, preserves exact Copy/Download actions, explains the manual
  re-entry workflow, disables Use Server offline or without a fresh comparison, and requires a
  second destructive confirmation. The confirmation binds the exact current draft snapshot; any
  intervening edit cancels it without invoking the repository.
- Cross-tab reconciliation continues to use bounded durable re-query signals. No keep-local
  successor or own keep-local authority path remains in the synchronized form.
- The design and implementation plan now record the narrowed MVP contract and authenticated
  production-browser release gate. Task 18 remains untouched.

### Verification

Pending final canonical matrix; see the final entry below for exact commands and counts.

## User-authorized final exceptional remediation

### Status

DONE — complete natural-lineage validation and bounded durable-only cross-tab reconciliation are implemented. Task 18 was not started. The authenticated production-browser traversal remains the documented release-environment gate.

### RED evidence

- A live `use_server` resolution accepted a valid-schema authoritative queue whose counter jumped from sequence 1 to 9, then destructively replaced the draft and retired the blocker.
- An exact successful `use_server` replay accepted a newly introduced counter-only divergence in the authoritative target queue.
- Protocol v2 accepted a new source beginning at sequence 2 and did not run its durable polling fallback while BroadcastChannel was available.
- A 10,000-pulse UI storm had no bounded single-flight abstraction; the prior promise chain allocated one continuation per pulse.
- The first durable-only UI implementation treated the resolving tab's own successor receipt as a sibling resolution. The canonical Chrome and Safari test exposed duplicate status regions before the display trigger was isolated from durable authority.

### Delivered

- Before either conflict action or an exact replay, one all-store transaction validates the physical/embedded scope union and the complete connected natural lineage seeded by the provisional, authoritative, and current durable draft identities. It follows mutation conflict remaps and resolution tombstones across every related queue.
- Related live queues, compacted terminal prefixes, counter-only queues, receipts, tombstones, mutations, and quarantine recovery metadata must form exact queue/counter and cross-store relationships. Counters exactly continue proven sequences; duplicate/gapped sequences, missing/ahead/behind counters, orphan receipts, divergent receipt/tombstone peers, live/resolved collisions, and related quarantine records fail closed. Valid unrelated evaluations in the same user/scope do not block.
- The same validation runs before replay success. Focused tests prove live and replay corruption leave drafts, blockers, dependents, counters, receipts, tombstones, and resolution records byte-equivalent.
- Cross-tab sources must start at sequence 1 and then deliver exactly `last + 1`; gaps, duplicates, reordering, self messages, invalid scope/user/source, and unknown fields are rejected. A bounded scoped poll now runs even when BroadcastChannel exists, so dropped channel messages cause a durable re-query without accepting their payload sequence.
- UI reconciliation uses a constant-memory runner with at most one in-flight durable read and one pending pulse. A 10,000-pulse test produces exactly two reads. Subscriber failures remain isolated and cleanup closes pending work.
- Recovery, clearing, confirmation, and `resolved_elsewhere` authority come only from the current `reconcileDraftLineage` result. Event origin is retained only as a bounded display trigger for a sibling/poll re-query; no remembered blocker or event state can authorize a transition.

### Verification

```text
Focused relational/use-server/replay protocol probes             RED (3 failures), then GREEN
Focused outbox/synchronizer/form suites                           PASS (356 total unit tests)
npm run verify                                                     PASS (format, lint, types, 356 unit tests, build)
npm run test:integration, repeated                                 PASS twice (19 files / 137 tests)
npx supabase db reset --local --no-seed                            PASS (47 migrations)
npx supabase test db --local                                       PASS (29 files / 847 tests)
npm run test:e2e:evaluation                                        PASS (8/8; Mobile Chrome + Mobile Safari)
Mobile Safari offline/conflict + durable-resolution --repeat=10    PASS (20/20)
npm audit --audit-level=high                                       PASS (0 vulnerabilities)
git diff --check                                                   PASS
```

### Self-review

- All destructive validation precedes draft replacement, queue deletion, counter changes, tombstone writes, or replay return inside the same Dexie transaction.
- The relational scan is limited by the connected natural evaluation graph; a valid unrelated evaluation counter can remain independently recoverable without blocking this resolution.
- Cross-tab messages remain bounded and PII-free: protocol, opaque user/source/scope/evaluation/mutation IDs, sequence, and coarse state only. Durable reconciliation—not the message—decides UI state.
- Polling, source tracking, and UI work are bounded; no sequence gap is accepted to regain liveness.
- Existing local-digest binding, permanent terminal fences, generation fencing, and Mobile Safari fixture isolation remain intact. No migration or IndexedDB version rewrite was introduced.
- `progress.md` and Task 18 were not changed.

## User-authorized third exceptional remediation

### Status

DONE — the two reproduced Critical findings are remediated and verified. Task 18 was not started. The authenticated production-browser chain remains the release-environment gate.

### RED evidence

- Resolving a sequence-1 conflict retired sequence-2/3 dependents into bare tombstones without their physical queue identity, sequence, version, or payload/draft digests. A forged-behind counter could therefore hide the compacted prefix and permit reuse.
- A newer local edit survived the first `resolved_elsewhere` pulse but the pulse cleared its recovery watermark; the second identical pulse then replaced the edit with the sibling result.

### Delivered

- Every conflict head and dependent now receives an integrity-protected terminal record containing exact natural identity, physical queue lineage, mutation/version/payload/draft lineage, head relationship, resolution action/identity, input/output digests, and complete group cardinality/digest.
- Natural-lineage validation expands provisional/authoritative IDs and resolution groups, reconstructs the complete live-plus-terminal prefix, and rejects missing/deleted group members, duplicate/gapped/reused sequences, cross-queue collisions, and missing/behind/ahead counters atomically. Exact replay validates the same prefix and preserves byte-equivalent success; a valid successor continues at sequence 4.
- Legacy bare conflict-dependent or otherwise incomplete conflict fences fail closed with recoverable attention. They cannot authorize destructive replay, enqueue, or sequence/identity reuse.
- Cached drafts now persist a local-authority revision watermark plus observed resolution identity/result digest and exact pending receipt token. Unlimited identical pulses are no-ops; a legitimately changed sibling winner presents explicit rebase protection without overwriting the newer draft. Only its exact save result, exact matching receipt, or explicit discard clears authority.

### Verification

```text
Focused dependent-lineage and 100-pulse probes                   RED, then GREEN
npm run verify                                                    PASS (format, lint, types, 361 unit tests, build)
npm run test:integration, repeated                                PASS twice (19 files / 137 tests)
npx supabase db reset --local --no-seed                           PASS (47 migrations)
npx supabase test db --local                                      PASS (29 files / 847 tests)
npm run test:e2e:evaluation                                       PASS (8/8; Mobile Chrome + Mobile Safari)
Mobile Safari offline/conflict + durable-resolution --repeat=10   PASS (20/20)
npm audit --audit-level=high                                      PASS (0 vulnerabilities)
git diff --check                                                  PASS
```

### Self-review

- Terminal group digest and cardinality bind every retired row, so deleting a dependent and forging its counter behind cannot create a valid compacted prefix.
- Strict conflict-prefix validation is limited to connected active/resolved conflict lineage; ordinary queue compaction and Task 16 draft reconstruction remain compatible.
- Tombstones and local-authority metadata contain bounded identifiers, counters, versions, markers, and SHA-256 digests only; raw evaluator content is not copied into terminal records.
- All destructive conflict paths validate inside the all-store transaction before draft replacement, deletion, tombstone/counter mutation, or replay return. Rejection tests assert full byte-equivalent rollback.
- `progress.md` and Task 18 were not changed.

## Revised-scope fix round 3 — exact terminal triples and pre-write freshness

### Status

DONE — live resolution, exact replay, and future append now accept receipts only through an exact
terminal triple, while proof registration and destructive recovery cannot cross expiry during quota
or IndexedDB work. Task 18 was not started. The authenticated production-cookie browser traversal
remains the documented release-environment gate.

### RED evidence

- A `needs_attention` conflict mutation with a valid receipt but no `receipt_authority` tombstone
  passed natural-lineage validation and destructively resolved with `use_server`.
- Proof registration checked repository time immediately before an awaited full-store quota scan;
  an injected delay advanced the clock beyond expiry and the proof still persisted.

### Delivered

- Related natural lineage closes over both evaluation identity and client mutation ID. A receipt is
  accepted only with matching scope/storage/client/evaluation/version/payload lineage, an exact
  acknowledged mutation (when the mutation remains live), matching acknowledgment time, exact
  successor server version, and one matching `receipt_authority` tombstone. Missing, wrong-reason,
  divergent, pending, leased, attention, duplicate/collision, and conflicting conflict tombstones
  fail before proof consumption or any write.
- Valid acknowledged mutation/receipt/tombstone triples remain accepted. After mutation compaction,
  the exact receipt/tombstone pair remains accepted; after receipt TTL compaction, the permanent
  authority fence remains the last terminal boundary.
- Strict future append uses the same terminal-triple validator. Live and replay probes assert that a
  rejected relationship leaves all seven stores and the proof byte-equivalent. `use_server` never
  replaces receipt authority with a conflict fence for the same mutation ID.
- Signature verification, crypto/digest construction, full-store scans, and byte-quota checks all
  precede the final repository-clock check. Live draft replacement, mutation retirement, terminal
  insertion, and proof consumption are issued as one synchronous Dexie transaction phase, followed
  by a final clock check that rolls the transaction back if IndexedDB itself crossed expiry.
- Proof registration and exact replay similarly recheck after their final quota/write await and
  immediately before returning. The test-only clock phase hook is constructor-captured and remains
  unavailable through the authenticated production wrapper.

### Verification

```text
Focused terminal-triple and quota-race probes                    RED (2 failures), then GREEN
Focused/full offline outbox                                      PASS (363 total unit tests)
npm run verify                                                    PASS (format, lint, types, 363 unit tests, build)
npm run test:integration, repeated                               PASS twice (19 files / 137 tests)
npx supabase db reset --local --no-seed                           PASS (47 migrations)
npx supabase test db --local                                      PASS (29 files / 847 tests)
npm run test:e2e:evaluation                                       PASS (8/8; Mobile Chrome + Mobile Safari)
Mobile Safari offline/conflict + durable-resolution --repeat=10   PASS (20/20)
npm audit --audit-level=high                                      PASS (0 vulnerabilities)
git diff --check                                                  PASS
```

### Self-review

- Receipt validation derives authority from validated durable mutation/receipt/tombstone bytes; no
  caller flag, broad sync state, event, or proof registration can substitute for the exact triple.
- The mutation's validated payload digest binds its complete draft (scores, note, tags, and flags),
  while terminal metadata continues to contain only bounded opaque IDs, counters, timestamps, and
  SHA-256 digests. No raw evaluator content or PII was added to tombstones or recovery records.
- Expiry is still exclusive (`expiresAt <= now` rejects) and exact future skew remains unchanged.
  Every rejection test snapshots session context, draft, queue, receipt, tombstone, quarantine, and
  counter stores including proof consumption metadata.
- No migration, IndexedDB version change, public conflict action, or proof-crypto/export contract
  changed. `progress.md` and Task 18 were not changed.
