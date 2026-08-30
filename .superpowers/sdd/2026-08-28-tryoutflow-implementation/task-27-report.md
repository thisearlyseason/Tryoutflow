# Task 27 report — durable integration sync and retry UI

## Status

Complete after review fix round 1/5.

- Original implementation: `07e396c` (`feat: add idempotent mock roster export`)
- Review hardening: `7054702` (`fix(integrations): harden durable export execution`)

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
