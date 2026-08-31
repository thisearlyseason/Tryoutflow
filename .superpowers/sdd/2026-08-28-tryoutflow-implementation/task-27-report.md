# Task 27 report — durable integration sync and retry UI

## Status

Complete after review fix round 2/5.

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
