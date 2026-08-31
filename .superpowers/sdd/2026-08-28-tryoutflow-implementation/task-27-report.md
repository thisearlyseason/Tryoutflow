# Task 27 report — durable integration sync and retry UI

## Status

Complete after review fix round 5/5.

- Original implementation: `07e396c` (`feat: add idempotent mock roster export`)
- Review hardening: `7054702` (`fix(integrations): harden durable export execution`)
- Review fix round 2: `0e21243` (`fix(integrations): close execution and replay races`)

The implementation now persists actor-scoped integration connections, immutable export sources and approved projections, sync jobs/items, provider attempts, and athlete/team/roster-version mappings. It also provides truthful retry/manual-attention UI, a discoverable finalized-roster export entry point, and a production-route browser traversal through local authentication, RPC persistence, the protected processor, and refreshed durable state.

## Requirements and design gate

The approved Task 27 brief, design specification sections 14 and 15, Task 26 provider report/contracts, and Task 20 finalized-roster interfaces were the design gate. The binding filename ruling was followed:

- additive migration `202608280078_harden_integration_execution.sql`
- additive pgTAP `060_integration_hardening.test.sql`
- historical migration 077 was not edited
- historical pgTAP 059 was updated only where its direct-preview-read expectation contradicted the new private-preview ACL; its original 56-test plan remains intact

Task 26 remains contract machinery, not durable authority. The Squad is disabled unless `ENABLE_MOCK_THE_SQUAD_PROVIDER=true`, all user-facing provider text identifies demo/mock behavior, the callback uses the reserved `.invalid` domain, and no live endpoint or provider credential was added.

## Durable design

### Immutable preview and privacy

`issue_roster_export_source` executes under actor authorization and creates one database-issued immutable source containing the exact organization, actor, connection, destination, approved-field list, finalized roster version, teams, and athlete/contact source bytes. Its SHA-256 source digest binds that complete snapshot.

Provider preview operates only on that returned source. `save_roster_export_preview_v2` locks the source and performs compare-and-save validation: provider preview identity/token/digest, item keys, and every approved projected value must match the same immutable source. Authoritative athlete or guardian changes after issuance cannot silently change the reviewed projection.

Raw preview rows and provider confirmation tokens are not directly selectable by authenticated users. Confirmed jobs retain only the approved projection, token digest, source reference, and privacy-safe request metadata. Raw sources/tokens are redacted after completion, cancellation, delivery uncertainty, or empty no-op confirmation; unconfirmed expired sources are deleted by the bounded protected purge.

### Confirmation and retry serialization

Confirmation takes an advisory transaction lock on organization, connection, and business idempotency key before lookup/mutation. This lock is independent of provider preview identity. Byte-equivalent replay returns the original job; a different immutable source using the same business key returns a typed conflict. The exact creator, active owner/administrator membership, actor-bound connected connection, confirmation token, finalized roster ID/version, destination, approved fields, and digest must still match.

Retry takes an advisory lock on organization, job, and retry idempotency key, then row-locks the job before examining prior attempts or changing items. A repeated key replays only when the organization, job, and request digest are identical. Only durable `failed`/`requires_review` items marked `retry_eligible` become pending; completed and skipped items remain untouched. Attempt numbers and provider keys are durable and bounded.

### Worker, authorization, uncertainty, and mappings

Claims are bounded, ordered, leased, and fenced by token plus generation. Expired work with a recorded provider handoff becomes `needs_attention`/`delivery_uncertain`; it is never automatically reclaimed.

The worker performs a non-handoff execution validation before process-local registry/connection rehydration, again after that await, and again after retry preview. The separate handoff authorization rechecks and locks immediately before export, then records `provider_submission_started_at`. A second authorization check after the provider await catches offboarding, disconnect, source invalidation, lease expiry, or roster invalidation. Revocation before handoff cancels with no export call; revocation or expiry after handoff records delivery uncertainty and exposes no ordinary retry.

Provider completion must supply explicit team and roster-version mapping proofs in addition to athlete item results. The database validates exact set coverage, provider/mock identity, tenant/connection scope, and stable external references; it acquires mapping locks in deterministic entity/internal-ID order. No team or roster mapping is fabricated. Durable mappings drive create/update preview behavior after a fresh provider registry and prevent cold-restart duplicates.

### UI truth

The review screen renders the exact approved projected values before confirmation. Confirmation inserts the newly returned job immediately. Completed and skipped counts are distinct. An empty roster returns `completed` with explicit “no transfer” copy and creates no outbox row. Retry is shown only for provably failed-safe items; delivery uncertainty uses separate manual-attention language and has no retry control. Connection, destination, history, and empty-state failures are explicit rather than swallowed.

## TDD evidence

### RED

The review findings were reproduced before their production changes:

- New hardening pgTAP initially failed 15 of 18 assertions because immutable-source, private-preview, typed-outbox, and worker-authorization boundaries did not exist.
- Worker tests initially showed authorization after retry preview and no post-provider recheck; the later await-boundary self-review test failed 3 of 5 cases because validation was never called and provider verification still occurred after revocation.
- Preview application tests failed three cases around database-issued sources, exact projection CAS, and mutable authoritative reloads.
- Provider contracts failed two cases for explicit team/roster proof and cold-registry retry behavior.
- UI tests failed exact projected-value, immediate status, skipped/count, empty no-op, manual-attention, discoverability, and explicit-error expectations.
- Real database race/privacy coverage failed until confirmation and retry acquired their independent locks and raw previews were removed from authenticated table access.
- The first post-migration 059/060 compatibility run aborted on historical preview inserts missing `source_digest`; the next aborted on historical outbox inserts missing `request_digest`. Tenant-bound compatibility triggers now derive both without weakening `NOT NULL` or digest checks.
- After the privacy ACL landed, historical 059 still expected authenticated raw preview reads. That obsolete assertion was changed to require SQLSTATE `42501`; migration 077 remained untouched.

### GREEN

- Focused worker/outbox unit tests: 2 files / 7 tests passed, including validation before provider activity, retry-preview revalidation, pre-handoff cancellation, and post-handoff uncertainty.
- Focused pgTAP 059 + 060: 2 files / 81 assertions passed.
- Full pgTAP after clean reset: 60 files / 1,643 assertions passed.
- Full isolated integration suite, run twice: 26 files / 192 tests passed on each run, including two-session confirmation/retry races, immutable identity/contact source behavior, cold registry, mappings, empty no-op, offboarding, disconnect during provider await, privacy, and cleanup.
- Task 26/provider contracts: 3 files / 143 tests passed.
- Full application verification: formatting, ESLint, strict TypeScript, 58 unit files / 760 tests, and production Next.js build passed.
- Independent production build passed.
- Production-path Chromium: 1 test passed through real local auth, actual app pages/components, feature registry, server actions, RPCs, outbox worker, persistence, refresh, and axe scan without route interception.
- Chromium + Mobile Chrome fixture: 4 tests passed, including retry UI, 375 px overflow, target sizing, and critical axe accessibility.

## Files

### Database and generated types

- `supabase/migrations/202608280078_harden_integration_execution.sql`
- `supabase/tests/059_integration_integrity.test.sql`
- `supabase/tests/060_integration_hardening.test.sql`
- `src/infrastructure/supabase/database.types.ts`

### Application, provider, and worker

- `src/modules/integrations/domain/contracts.ts`
- `src/modules/integrations/application/preview-roster-export.ts`
- `src/modules/integrations/application/start-roster-export.ts`
- `src/modules/integrations/application/retry-sync-job.ts`
- `src/modules/integrations/infrastructure/supabase-integration-gateway.ts`
- `src/infrastructure/integrations/dispatch-integration-job.ts`
- `src/infrastructure/integrations/integration-outbox.ts`
- `src/infrastructure/integrations/mock-the-squad-provider.ts`
- `src/app/api/jobs/process/route.ts`

### Routes and UI

- `src/modules/integrations/ui/integration-card.tsx`
- `src/modules/integrations/ui/roster-export-wizard.tsx`
- `src/modules/integrations/ui/roster-export-link.tsx`
- `src/app/(app)/app/[organizationSlug]/organization/integrations/page.tsx`
- `src/app/(app)/app/[organizationSlug]/tryouts/[tryoutId]/rosters/page.tsx`
- `src/app/(app)/app/[organizationSlug]/tryouts/[tryoutId]/rosters/[rosterVersionId]/export/page.tsx`

### Tests and browser evidence

- `tests/unit/integrations/*`
- `tests/unit/communications/process-jobs-route.test.ts`
- `tests/contract/team-management-provider.contract.test.ts`
- `tests/integration/integrations/roster-export.test.ts`
- `tests/e2e/mock-roster-export.spec.ts`
- `tests/e2e/production-roster-export.spec.ts`
- `tests/fixtures/integrations/app/page.tsx`
- `playwright.integrations-production.config.ts`

## Release gates

- Clean schema application: migrations 001–078 applied in order.
- Full database: 60 files / 1,643 assertions passed.
- Integration repeatability: 26 files / 192 tests passed twice.
- Contracts: 3 files / 143 tests passed.
- `npm run verify`: passed formatting, lint, typecheck, 58 files / 760 unit tests, and build.
- Independent `npm run build`: passed.
- Production Chromium: 1/1 passed.
- Chromium + Mobile Chrome/a11y: 4/4 passed.
- Dependency audit: `npm audit --omit=dev` reported 0 vulnerabilities.
- Type reproducibility: consecutive generated type runs retained SHA-256 `97240dca22a76d3981626112e86a4c7e0af6b1c73fe80e4c6a69d1cdcf2e33a7`.
- `git diff --check`: passed.
- Strictness/secret scan: no added broad `any`, suppression directive, live Squad URL, JWT-like token, Stripe-like key, or client-secret literal.

## Self-review

- RLS/ACL/search path: all integration tables retain tenant RLS and composite tenant constraints; worker tables/previews have no direct authenticated access; every new security-definer function sets `search_path=''`; private helpers and legacy mutable-context RPCs are revoked.
- Locking/deadlocks: confirmation and retry use separate stable advisory namespaces; mapping locks use deterministic entity/internal-ID order; row locks follow advisory locks; bounded claims use `FOR UPDATE SKIP LOCKED`.
- Replay/token consumption: exact-digest replay is checked after business-key serialization, so a consumed preview can still truthfully replay the original job while changed bytes conflict.
- Lease fencing: validate/authorize/complete/fail require the same lease token and generation; stale or expired leases cannot complete. Expired post-handoff leases become delivery uncertainty.
- Mapping collision: internal and external unique keys are tenant/connection/entity scoped; exact provider proof is required. A conflicting provider external ID aborts completion rather than silently remapping.
- Revocation during await: execution state is checked around connection/preview awaits and immediately before/after export. Pre-handoff revocation cancels; post-handoff revocation requires manual attention.
- Retention/privacy: jobs store only approved projection and hashes/refs; raw private preview data is redacted on terminal outcomes and purged in bounded batches; normalized errors and processor responses contain codes/counters only.
- Task 26 compatibility: the provider contract remains intact with additive mapping proofs; disabled-by-default demo/mock behavior and no-live-transfer labeling remain unchanged.
- Workflow separation: selection, roster decisions, finalization, preview, confirmation, synchronization, and retry remain distinct. A finalized roster is exported only after explicit destination/field review and confirmation.

## Release concerns

No blocking concern. The production-path browser evidence uses the real application and local Supabase, but the provider remains intentionally synthetic. Operations must keep the protected processor schedule active so preview retention and queued work progress. Enabling `ENABLE_MOCK_THE_SQUAD_PROVIDER` demonstrates mock behavior only; it does not configure or authorize a live Squad integration.

## Review fix round 2/5

### Findings reproduced before production edits

All ten review findings were evaluated against the live schema or production components before the fixes were accepted.

- The first `061_integration_execution_closure.test.sql` RED run failed 8 of 16 assertions: immutable mapping snapshots, completion receipts, retention caps, legacy-context closure, and worker ACLs were absent. Expanding the retry-safety matrix to 23 assertions then stopped at the missing private eligibility predicate, leaving seven planned assertions unrun.
- Focused UI RED was 2 failures in 7 tests: a queued retry retained the old partial/retry state, and an ambiguous review item still received an ordinary retry control.
- Exact-state contract RED was 2 failures in 10 focused tests: confirmation rejected the new durable eligible count, and retry rendering coerced the returned state to `pending`.
- Preview CAS reproduced duplicate-A/omit-B acceptance risks, operation and label tampering, and ordering/empty behavior. A later self-review RED proved a missing `operation` was accepted as `created` because SQL three-valued logic bypassed the comparison.
- Exact preview replay RED returned `replayed` for the same preview ID with a changed confirmation token and payload.
- Real two-session authorization races were added for membership offboarding, connection disconnect, and exact source invalidation in both lock orderings. Early test iterations exposed output parsing, promise-ordering, and timeout issues before the production behavior was considered green.
- The exhausted-attempt scenario proved an expired max-attempt lease could hide healthy work under the old claimant. The final test verifies terminalization does not increment beyond `max_attempts` and a healthy job behind it is still claimed.
- The retention scenarios reproduced cap/cap+1 deletion, active-lease preservation, and post-expiry handoff denial.
- Completion replay after source redaction initially validated raw source first and could not provide exact terminal replay. Changed provider-result ordering now produces `terminal_conflict` while the exact prior result replays.
- Cold-registry runs initially attempted `create` despite durable mappings. Test helpers now consume the database-issued mapping snapshot, matching the application boundary.
- A natural two-session failure-edge RED returned `lease_conflict`: failure saw a valid handed-off lease, blocked on its row, and resumed after expiry. The final transition locks first and records `needs_attention` atomically.

### Durable schema and execution design

Migration `202608280079_close_integration_execution_races.sql` is additive; migrations 077 and 078 were not edited.

- Preview sources now snapshot the exact durable athlete-mapping set. The compare-and-save RPC requires one unique provider item for every source registration, rejects duplicates/omissions/extras, validates exact operation, privacy-safe label, approved projection, mock flag, item count, and provider identifiers, and binds ready-stage replay to the same token and complete preview payload.
- Preview expiry is database-capped at source creation plus seven days. Claim and authorization refuse an expired source. The bounded purge selects at most `p_limit`, skips active leases, cancels provably pre-handoff work, marks handed-off work uncertain, redacts token/raw roster material, and preserves privacy-safe jobs, items, mappings, receipts, and audit evidence. The protected processor invokes it opportunistically.
- Handoff authorization locks outbox, sync job, exact initiating membership, actor-bound connection, roster version, and source in one canonical order. Validation occurs under those locks immediately before the provider marker. Revocation that owns its row first cancels with no handoff; authorization that owns the rows first records the already-started linearization point. Later invalidity is delivery uncertainty, never a claim of cancellation.
- Claims terminalize a bounded set of expired handed-off or exhausted leases separately from healthy claims. Exhausted pre-handoff work becomes nonretryable terminal failure without incrementing beyond the constraint; handed-off work becomes manual attention.
- Failure after the handoff marker transitions atomically to uncertainty while holding the outbox row, including the lease-expiry edge. Ordinary retry eligibility is computed only for normalized `failed` items explicitly marked retryable with the allowlisted safe codes `rate_limited`, `provider_temporary`, or `timeout`. Permanent errors, ambiguous review, exhaustion, and delivery uncertainty cannot enter ordinary retry.
- Completion stores a privacy-safe SHA-256 digest of the canonical provider result. Exact terminal completion replays before consulting redacted source bytes; changed external job or result evidence conflicts. Athlete, team, and roster-version mapping keys are locked in deterministic order before any legacy mapping write, independent of provider result order.
- A v3 confirmation summary returns the durable job state, all item counts, and the exact retry-eligible count in the same transaction. Retry returns its durable state. The UI renders these values directly, removes the old retry control after queueing, distinguishes skipped/completed/failed-reviewable items, preserves empty no-transfer truth, and separates failed-safe retry from uncertainty/manual review.
- `load_roster_export_context` is revoked from all runtime roles. Recreated completion/failure RPCs and their legacy implementations are revoked from public/anon/authenticated and granted only to `service_role`. New private helpers are not executable by runtime roles; every new privileged function has an empty search path.

### Round 2 files

- `supabase/migrations/202608280079_close_integration_execution_races.sql`
- `supabase/tests/061_integration_execution_closure.test.sql`
- `src/infrastructure/supabase/database.types.ts`
- `src/modules/integrations/application/start-roster-export.ts`
- `src/modules/integrations/application/retry-sync-job.ts`
- `src/modules/integrations/infrastructure/supabase-integration-gateway.ts`
- `src/modules/integrations/ui/roster-export-wizard.tsx`
- `src/app/(app)/app/[organizationSlug]/tryouts/[tryoutId]/rosters/[rosterVersionId]/export/page.tsx`
- `tests/integration/integrations/roster-export.test.ts`
- `tests/unit/integrations/roster-export-ui.test.tsx`
- `tests/unit/integrations/supabase-integration-gateway.test.ts`
- `tests/fixtures/integrations/app/page.tsx`

### Final GREEN evidence

- Clean local reset applied migrations 001–079 in order.
- Focused pgTAP 061: 25/25 assertions passed.
- Full pgTAP: 61 files / 1,668 assertions passed.
- Expanded real-database integration scenario: passed after the final replay/operation/lease-edge fixes.
- Full isolated integration suite, twice: 26 files / 192 tests passed on each run.
- Task 26 provider contracts: 3 files / 143 tests passed.
- Full `npm run verify`: formatting, ESLint, strict TypeScript, 58 unit files / 761 tests, and production Next.js build passed.
- Independent `npm run build`: passed.
- Production-route Chromium: 1/1 passed through real local authentication, provider feature flag/registry, application components, server actions, RPC persistence, protected processor, refresh truth, and axe with no interception.
- Chromium + Mobile Chrome fixture: 4/4 passed, including 375 px overflow, target sizing, retry truth, and axe accessibility.
- `npm audit --omit=dev`: 0 vulnerabilities.
- Generated database types were reproduced twice with identical SHA-256 `79f98cfff672ae5c4a2b97ead25ef5d6a51f957ea76891109043b1022d2a2ec6`.
- Live-catalog audit confirmed empty search paths and exact grants for the new/private/legacy RPC set.
- `git diff --check`, broad-`any`/suppression scan, live-Squad-endpoint/credential scan, and old-migration diff check passed.

### Round 2 self-review

- Authorization and races: the provider marker is the documented linearization point. The implementation no longer promises cancellation after it. Tests cover membership, connection, and source invalidation in both orderings, plus revocation during the provider await.
- Lock order: handoff locks are outbox → sync → membership → connection → roster → source. Completion locks outbox/sync/source before sorted mapping advisory keys. Confirmation and retry retain distinct advisory namespaces and acquire them before their authoritative lookup/mutation.
- Replay: ready preview replay, confirmation, retry, and terminal completion bind exact durable evidence. Token consumption/redaction does not destroy exact completion replay authority.
- Fencing and uncertainty: claim, authorize, complete, and fail retain token/generation fencing. Expired or errored handed-off work becomes attention; late exact completion cannot overwrite a newer terminal truth.
- Mapping/tenant safety: athlete/team/roster mappings remain organization/connection/entity scoped with both internal and external uniqueness. Provider proofs are exact and no mapping is fabricated. Opposite-order overlapping completion sessions terminate without deadlock and converge on one mapping set.
- Privacy: raw source/token material is private, seven-day bounded, and redacted. Durable job reads expose only approved projection and privacy-safe counts/hashes/refs; normalized errors and processor responses contain codes rather than PII or secrets.
- UI: state is never coerced to pending, retry depends on item-level durable eligibility, completed and skipped counts remain distinct, empty export is completed/no-transfer, and uncertainty has manual-attention copy with no retry.
- Compatibility: selection, roster construction, finalization, preview, confirmation, synchronization, and retry remain distinct. Task 26 stays a disabled-by-default demo/mock with no live endpoint or credential.

### Round 2 release concern

No blocking concern. The provider remains intentionally synthetic, and the protected processor must remain scheduled so queued work, bounded terminalization, and seven-day retention cleanup progress. Delivery uncertainty intentionally requires operator reconciliation; it is not automatically retryable because duplicate external intent cannot be ruled out.

## Review fix round 3/5

### Findings reproduced before production edits

Each review finding was reproduced against the round-2 implementation before migration 080 or the TypeScript changes were written.

- Focused gateway and UI tests began with 8 failures in 17 tests. The confirmation parser rejected the complete v3 failure shape, six typed SQL outcomes collapsed to an unavailable error, and retry rendering retained client-synthesized counts instead of an authoritative durable projection.
- The initial `062_integration_round3_closure.test.sql` run failed 6 of 9 assertions because retry v3, categorical handoff exclusion, exact token-digest replay binding, and the retention lock-order proof did not exist.
- The expanded real-database scenario reported seven independent failures with soft assertions: a changed valid-shaped confirmation token replayed, mixed completed/exhausted work became wholly failed, a stale handed-off row was re-claimed under poison saturation, cleanup raced authorization and completion into rejected transactions, and the accepted completion could not reach terminal/redacted truth after that lock failure.
- A controlled 079-era retention rehearsal inserted an overlong expired ready preview containing a confirmation token, raw roster name, and provider preview label while a linked terminal job/outbox retained privacy-safe request/token/result hashes and an external receipt. Before 080 the probe returned `true|true|true` for overlong expiry, token presence, and private roster bytes.
- The first post-fix retention rehearsal exposed one additional privacy RED: the token and roster were removed but `preview_snapshot` still retained the display label. Migration 080 and pgTAP 062 were tightened before the full gate run so all three short-lived provider/source representations are now redacted.

### Round 3 durable design

Migration `202608280080_close_integration_claim_and_retention.sql` is additive. Migrations 077, 078, and 079 remain byte-untouched.

- Ordinary claim selection and its locked-row recheck both require `provider_submission_started_at is null`. Poison terminalization remains bounded, but saturation or delayed cleanup cannot make a prior handoff eligible for another provider submission. Healthy work behind poisoned and handed-off rows remains claimable with `p_batch_size = 1`.
- Claim, authorization, completion, and retention use the same row-lock prefix: exact outbox row(s), then sync job, then dependent authorization/source/mapping rows. Purge first selects IDs without row locks, locks all linked outboxes in deterministic ID order, then locks the sync job and preview. Natural cleanup-versus-authorization and cleanup-versus-completion sessions finish without deadlock or losing an accepted completion.
- Confirmation v3 binds replay to the stored SHA-256 confirmation-token digest after the serialized v2 business-key transition. Exact consumed/redacted replay remains possible; a changed valid-shaped token returns typed conflict with no additional job/outbox mutation.
- Retry v3 returns one exact same-transaction projection: outcome, job ID/state, retried count, preserved completed/skipped counts, and current completed/skipped/failed/retry-eligible counts. Strict discriminated Zod schemas accept every documented SQL outcome, reject unknown fields, and preserve typed stale/conflict/forbidden/not-found/already-consumed/invalid-input results.
- The UI replaces its prior job view only from that validated durable projection. It does not decrement or zero counts locally, so concurrent worker progress and exact replay are rendered truthfully and retry controls follow the returned durable eligibility.
- Exhausted pre-handoff terminalization computes the sync state from every durable item. All failures produce `failed`; any preserved completed/skipped item alongside failures produces `partially_completed`. Completed and skipped evidence is never overwritten.
- Every historical preview is capped to `created_at + 7 days`. Expired ready sources are processed in deterministic batches of 500 during the upgrade and bounded batches thereafter. Tokens, roster source bytes, and provider preview bytes are redacted; unconsumed orphan previews are deleted; handed-off active work becomes attention; provably pre-handoff work is cancelled; durable approved projections, mappings, hashes, receipts, jobs, and audit evidence remain.

### Round 3 files

- `supabase/migrations/202608280080_close_integration_claim_and_retention.sql`
- `supabase/tests/062_integration_round3_closure.test.sql`
- `src/infrastructure/supabase/database.types.ts`
- `src/modules/integrations/application/retry-sync-job.ts`
- `src/modules/integrations/infrastructure/supabase-integration-gateway.ts`
- `src/modules/integrations/ui/roster-export-wizard.tsx`
- `tests/integration/integrations/roster-export.test.ts`
- `tests/unit/integrations/roster-export.test.ts`
- `tests/unit/integrations/supabase-integration-gateway.test.ts`
- `tests/unit/integrations/roster-export-ui.test.tsx`
- `tests/fixtures/integrations/app/page.tsx`

### Final GREEN evidence

- Clean local reset applied migrations 001–080 in order.
- Focused pgTAP 062: 9/9 assertions passed. Full pgTAP: 62 files / 1,677 assertions passed.
- Focused round-3 unit coverage: 3 files / 22 tests passed after the strict gateway and authoritative UI changes.
- The expanded real-database round-3 scenario passed twice, including poisoned-row saturation, token replay, mixed exhaustion, and both cleanup interleavings.
- Full isolated integration suite passed twice: 26 files / 192 tests on each run.
- Task 26 provider contracts: 3 files / 143 tests passed.
- Full `npm run verify`: formatting, ESLint, strict TypeScript, 58 unit files / 768 tests, and production Next.js build passed. An independent production build also passed.
- The 079-to-080 retention rehearsal finished with capped expiry; null token, roster, and preview bytes; and unchanged request digest, token digest, external job receipt, completion-result digest, and completed outbox state.
- Production-path Chromium: 1/1 passed through real local authentication, feature registry, application route/components, server actions, RPC persistence, protected worker processing, refreshed durable state, and axe without route interception.
- Chromium + Mobile Chrome fixture: 4/4 passed, including retry projection, 375 px overflow, target sizing, and critical axe accessibility.
- Database type generation was reproducible across consecutive runs with SHA-256 `6e28d2e9dd41ac1fd27721ac1a245b63d873e4174c038d581e5ae64a0881ceac`.
- `npm audit --omit=dev`: 0 vulnerabilities. `git diff --check`, old-migration diff, broad-`any`/suppression scan, and live-Squad-endpoint/credential scan passed.
- Live catalog checks confirmed RLS on all six integration tables, empty search paths on the four replaced/new public RPCs, authenticated-only confirmation/retry access, and service-role-only claim/purge access.

### Round 3 self-review

- Claim and handoff truth: no ordinary claim path can lease a row with the provider-start marker, regardless of cleanup batch size or queue order. Poison cleanup can lag safely without enabling duplicate external intent.
- Locking: every modified multi-row execution or retention path starts outbox → sync. Purge locks all outboxes in sorted order before the job and preview; completion retains sorted mapping locks after its outbox/sync/source prefix. The natural two-session tests cover both blocking directions.
- Replay and strict contracts: confirmation replay includes exact token digest; retry results are exact durable projections. Unknown fields fail closed and documented business outcomes remain typed rather than converted to infrastructure unavailability.
- Privacy and retention: short-lived source, provider preview, and confirmation-token material is removed no later than the seven-day cap. Jobs retain only approved projection and privacy-safe identifiers/digests; receipt/mapping/audit authority survives redaction.
- Retry and uncertainty: only current durable `retry_eligible` item truth controls the UI. Handoff uncertainty, ambiguous review, permanent failure, and exhaustion remain outside ordinary retry.
- Tenant and privilege safety: existing organization-scoped keys, RLS, mapping uniqueness, fencing, and ACLs remain intact. The new type/RPC is additive and strict; no live endpoint, credential, or provider authority was introduced.

### Round 3 release concern

No blocking concern. The provider is still deliberately demo/mock-only and disabled by default. Production operations must schedule the protected processor so bounded poison cleanup and preview retention continue; delivery uncertainty still requires explicit operator reconciliation rather than an automatic retry that could duplicate external intent.

## Review fix round 4/5

### Findings reproduced before production edits

All five review findings were reproduced against the round-3 tree before migration 081 or the application changes were written.

- Live catalog and runtime probes showed that `authenticated` could execute `confirm_roster_export_preview_v2`. Direct v2 calls reached replay or initial queue mutation before the v3 token check, while SQL `NULL` token/digest inputs bypassed ordinary regular-expression and inequality predicates. The initial pgTAP 063 run failed 28 of 36 assertions, including the expected sole authenticated confirmation boundary.
- A stage-`redacted` preview could still retain its full `preview_snapshot`, including provider labels and approved-contact display data. Historical sync jobs could retain the pre-078 `roster_snapshot` and `provider_confirmation_token`. Byte probes found those values even though the row stage claimed redaction.
- The active provider-await rehearsal crossed source expiry and retention processing with a valid, unexpired handed-off lease. Before the fix the exact provider receipt was classified `delivery_uncertain` instead of accepted, demonstrating that source expiry could destroy an in-flight accepted completion.
- Focused gateway/application/UI tests began with 5 failures in 28 tests. Job-bound retry outcomes omitted or synthesized durable state/counts, and the UI could retain a stale Retry control after receiving an incomplete `nothing_to_retry` result. A later self-review RED deliberately supplied that malformed result and confirmed the stale control before tightening the UI boundary.
- Natural purge/retry/claim interleaving had no stable serialization point: purge locked the current outbox set before sync, retry locked sync before inserting, and claim could lock a newly inserted outbox before waiting on sync. The first pgTAP/concurrency draft therefore could neither find retry v4 nor prove that new outboxes could not enter the purge lock set mid-transaction.
- A later historical-repair self-review fixture exposed two more failed assertions: a preview already clean and marked `redacted` could leave sensitive `approved_projection` bytes on a linked failed job with no retry-eligible items. The repair predicate was expanded before final verification.

### Round 4 durable design

Migration `202608280081_close_integration_confirmation_retention_and_locking.sql` is additive. Migrations 077–080 remain unchanged.

- Confirmation v4 is the sole authenticated confirmation boundary. It accepts preview ID, exact source digest, exact confirmation token, and exact idempotency scope; rejects every `NULL`, malformed, changed, or cross-scope value before hashing, locking, or mutation; and permits only exact live or consumed replay. V1–v3 are revoked from `PUBLIC`, `anon`, `authenticated`, and `service_role`; v4 is granted only to `authenticated`.
- Redaction is defined by bytes, not by stage: a redacted preview has an empty roster, null provider token, null preview snapshot, and a redaction timestamp; legacy sync roster/token fields remain null. Terminal completion, failure, cancellation, attention, expiry, and bounded purge paths clear preview, job, and outbox-sensitive payload fields in the same transaction while retaining hashes, result receipts, durable mappings, and privacy-safe counts.
- A private bounded historical repair revisits stage-redacted-but-sensitive rows and terminal/no-retry jobs. It skips active unexpired provider leases, uses the same stable sync serialization key as runtime paths, and defers those rows until they are no longer active. The migration-time drain therefore cannot invalidate an accepted in-flight provider completion.
- Every purge, retry, claim, authorize, complete, and fail path acquires a private per-sync advisory serialization key before any mutable row-lock set. This prevents a retry insert or claimant from changing the purge set mid-transaction and gives all execution/retention paths one stable prefix independent of which outbox rows currently exist.
- Retry v4 returns an exact same-transaction durable projection for every job-bound outcome: outcome, job ID/state, retried and preserved counts, current completed/skipped/failed counts, and retry eligibility. Gateway and application contracts reject incomplete, inconsistent, or unknown projections. The UI replaces its job view for `queued`, `replayed`, `nothing_to_retry`, and `manual_attention_required` only from that validated projection and clears stale job controls on an invalid boundary response.
- Source digest is carried from preview through the server action, application boundary, gateway, and confirmation RPC. This closes the exact-live and exact-consumed source binding instead of relying on a preview ID alone.

### Round 4 files

- `supabase/migrations/202608280081_close_integration_confirmation_retention_and_locking.sql`
- `supabase/tests/063_integration_round4_closure.test.sql`
- `src/infrastructure/supabase/database.types.ts`
- `src/modules/integrations/application/preview-roster-export.ts`
- `src/modules/integrations/application/start-roster-export.ts`
- `src/modules/integrations/application/retry-sync-job.ts`
- `src/modules/integrations/infrastructure/supabase-integration-gateway.ts`
- `src/modules/integrations/ui/roster-export-wizard.tsx`
- `src/app/(app)/app/[organizationSlug]/tryouts/[tryoutId]/rosters/[rosterVersionId]/export/page.tsx`
- `tests/integration/integrations/roster-export.test.ts`
- `tests/unit/integrations/roster-export.test.ts`
- `tests/unit/integrations/supabase-integration-gateway.test.ts`
- `tests/unit/integrations/roster-export-ui.test.tsx`
- `tests/fixtures/integrations/app/page.tsx`

### Final GREEN evidence

- Clean local reset applied migrations 001–081 in order. Focused pgTAP 063 passed 38/38; the full database suite passed 63 files / 1,715 assertions.
- Focused integration unit coverage passed 3 files / 33 tests after the exact retry and malformed-boundary fixes.
- The expanded real-database scenario passed with exact live/consumed token-digest-scope checks, all retry outcomes, PII/token byte probes across terminal paths, active handed-off completion after source expiry, and natural three-session purge/retry/claim progress without deadlock or a missed active outbox.
- The full isolated integration suite passed twice: 26 files / 192 tests on each run. Task 26 provider contracts passed 3 files / 143 tests.
- Full `npm run verify` passed formatting, ESLint, strict TypeScript, 58 unit files / 779 tests, and the production Next.js build. An independent production build also passed.
- A controlled migration rehearsal built migrations 001–080, injected a stage-redacted sensitive preview and terminal legacy sync/job/outbox history, observed the pre-081 probe `true|true|true|completed`, then applied 081. The post-081 probe returned `true|true|true|true|true`: sensitive preview/sync bytes were gone while request/token/result hashes, external receipt, and completed outbox evidence were unchanged.
- The active-provider-await integration rehearsal retained its unexpired handed-off lease through cleanup and accepted the exact provider completion receipt after source expiry. No new handoff is authorized from an expired source.
- Production-path Chromium passed 1/1 through real local authentication, feature registry, application route/components, server actions, RPC persistence, protected worker processing, durable refresh, and axe. Chromium + Mobile Chrome fixture coverage passed 4/4, including retry replacement, 375 px overflow, target sizing, and critical accessibility.
- Database type generation was identical across consecutive runs with SHA-256 `6dae6a70a02561fc7df66360fb38019d4ee6a0d4294da6f90fff0e5288503565`.
- `npm audit --omit=dev` found 0 vulnerabilities. `git diff --check`, old-migration audit, broad-`any`/suppression scan, credential-pattern scan, and live-Squad-endpoint scan passed.
- Live catalog audit returned `true|6|true|true|true`: RLS is enabled on all six integration tables; all six audited public execution boundaries have empty search paths; authenticated callers have only v4 confirmation/retry authority; v1–v3 confirmation boundaries are retired; and service workers retain completion/failure authority.

### Round 4 self-review

- Categorical no-resend: ordinary claim still excludes every provider-started outbox. Expiry, exhaustion, failure, purge, retry, and saturation do not turn handed-off intent into resendable work.
- Revocation linearization: membership removal, connection disconnect, roster/source invalidation, and pre-handoff source expiry stop authorization. Once the provider marker is durably written, exact completion may finish; ambiguous or expired leases become manual attention rather than ordinary retry.
- Safe retry matrix: only durable item-level retry eligibility enters a new attempt. Completed/skipped evidence is preserved; permanent failure, exhaustion, handoff uncertainty, and operator-review states never invent a Retry control.
- Replay: changed/null token, digest, organization, actor, or idempotency scope fails without mutation. Exact consumed confirmation and exact terminal result replay remain available after raw-token/source redaction because their privacy-safe digests and receipt authority survive.
- Privacy: preview source, provider labels, approved-contact display bytes, legacy sync roster/token bytes, and transient outbox payloads are probed absent after every terminal family. Active work is not prematurely scrubbed, and bounded cleanup later revisits it safely.
- Preview CAS and mapping safety: confirmation remains bound to immutable preview/source evidence. Completion keeps generation fencing and organization/connection/entity-scoped mapping locks and uniqueness; the new sync serialization prefix does not weaken mapping convergence.
- Tenant/ACL/cold-start safety: RLS and actor scope remain authoritative, helper functions are private, public security-definer functions use empty search paths, database types are deterministic, and Task 26 remains a disabled-by-default synthetic provider with no live endpoint or credential.

### Round 4 release concern

No blocking concern. The provider is still intentionally synthetic and disabled by default. Production must keep the protected processor scheduled so queued work, deferred active-lease repair, poison cleanup, and bounded privacy retention progress. Delivery uncertainty still requires explicit reconciliation and is never automatically retried.

## Review fix round 5/5

### Finding reproduced before production edits

The retry response boundary validated UUID shape but did not bind a job-bound projection to the job requested by the caller. Three focused RED tests failed as intended: the Supabase gateway exposed a valid-shaped projection whose `job_id` belonged to another job, the application returned a mismatched adapter result unchanged instead of marshaling typed `unavailable`, and the wizard replaced the current job/counts/retry target with the mismatched projection.

### Round 5 boundary design

- The gateway refines the strict retry response schema with the requested job ID for every job-bound SQL outcome. A different valid UUID is therefore rejected before any other job's projection crosses the gateway boundary.
- The application independently checks every gateway result carrying `jobId`. A mismatch is marshaled to `{ outcome: 'unavailable' }`, so an alternate adapter cannot expose another job's durable data.
- The wizard independently compares a job-bound retry result to the job whose Retry control initiated the request. A mismatch displays the invalid-projection error without replacing the current durable state or changing the Retry button target. Existing exact matches for `queued`, `replayed`, `nothing_to_retry`, and `manual_attention_required` remain authoritative.
- No migration or SQL function change was needed; the defect was response correlation at the gateway, application, and UI boundaries.

### Round 5 files

- `src/modules/integrations/application/retry-sync-job.ts`
- `src/modules/integrations/infrastructure/supabase-integration-gateway.ts`
- `src/modules/integrations/ui/roster-export-wizard.tsx`
- `tests/unit/integrations/roster-export.test.ts`
- `tests/unit/integrations/supabase-integration-gateway.test.ts`
- `tests/unit/integrations/roster-export-ui.test.tsx`

### Final GREEN evidence

- Focused gateway/application/UI regression coverage passed 3 files / 36 tests after starting RED with exactly 3 failures.
- Full `npm run verify` passed formatting, ESLint, strict TypeScript, 58 unit files / 782 tests, and the production Next.js build. An independent `npm run build` also passed.
- Task 26 provider contracts passed 3 files / 143 tests.
- The relevant isolated real-database roster-export integration scenario passed 1/1.
- Chromium + Mobile Chrome fixture coverage passed 4/4, including retry truth, accessibility, narrow-screen overflow, and target sizing. Production-route Chromium passed 1/1 through local authentication, registry, RPC persistence, the protected worker, refresh truth, and axe.
- `npm audit --omit=dev` found 0 vulnerabilities. Formatting, final diff checks, suppression/broad-`any` scans, credential/live-endpoint scans, and the no-migration/type-change audit passed.

### Round 5 self-review

- Identity binding: every job-bound gateway schema branch requires the exact requested job ID; application and UI checks remain independent defense-in-depth boundaries.
- Non-disclosure and mutation: mismatched gateway/application results return no other-job projection. The UI does not render mismatched counts/state and retains the original durable job and Retry target.
- Exact authority: matching `queued`, `replayed`, `nothing_to_retry`, and `manual_attention_required` projections retain their existing exact-state/count behavior.
- Scope: no migration, generated type, database function, provider contract, or unrelated module changed.

### Round 5 release concern

No new blocking concern. Existing Task 27 operational concerns remain unchanged: the provider is synthetic and disabled by default, the protected processor must remain scheduled, and delivery uncertainty requires explicit operator reconciliation rather than automatic retry.
