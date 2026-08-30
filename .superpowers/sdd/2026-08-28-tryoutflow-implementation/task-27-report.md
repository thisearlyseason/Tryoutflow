# Task 27 report — durable integration sync and retry UI

## Status

Complete. Implementation commit: `07e396c` (`feat: add idempotent mock roster export`).

The implementation persists actor-scoped integration connections, exact export previews, sync jobs/items, stable external mappings, and leased outbox attempts. It also adds the disabled-by-default The Squad demo/mock connection page, finalized-roster review/confirmation flow, partial-result history, and failed/reviewable-item retry UI.

## Requirements and design gate

The approved Task 27 brief plus design specification sections 14 and 15 were used as the brainstorming/approval gate. Task 26's provider contract and Task 20's finalized-roster snapshot remained authoritative. The binding collision ruling was followed: the only new migration is `202608280077_integrations.sql` and the only new pgTAP file is `059_integration_integrity.test.sql`; no historical migration was edited.

The durable model has six tenant-scoped tables:

- `integration_connections` — one stable actor/provider connection per organization.
- `integration_export_previews` — short-lived, actor-owned, exact destination/approved-fields/roster/provider-token snapshots and payload digest.
- `integration_sync_jobs` — top-level business idempotency, immutable confirmed request snapshot, terminal/partial truth, and normalized last error.
- `integration_sync_items` — item attempts and pending/processing/completed/failed/skipped/requires-review state.
- `external_entity_mappings` — unique internal and external keys for athlete/team/roster-version entity classes.
- `integration_outbox_jobs` — bounded claim ordering, available time, maximum attempts, lease owner/token/generation/expiry, provider-handoff marker, backoff, completion, dead-letter, and needs-attention truth.

Every table includes `organization_id`, has RLS enabled, and uses tenant-composite foreign keys where it has tenant-owned parents. Direct authenticated writes and all direct outbox access are revoked. Owner/administrator reads are RLS-filtered, previews additionally require the exact creator, and privileged state changes are exposed only through strict RPC boundaries.

Confirmation serializes on organization plus provider preview, verifies the exact creator, organization, connected actor-owned connection, unexpired/unconsumed preview, provider confirmation token, finalized roster ID/version, destination snapshot, approved fields, and persisted payload digest. Reusing the same business idempotency key and request digest returns the same job; changing the bound request returns conflict. An empty finalized roster creates an immediately completed and replayable durable job without provider work, preserving Task 26's empty-export no-op behavior.

The protected scheduled processor now claims integration work under the existing cron-secret boundary. Claims are limited to 1–50 rows, use `FOR UPDATE SKIP LOCKED`, and increment a fencing generation with a unique lease token. Provider handoff is authorized immediately before submission. A pre-handoff normalized retryable failure schedules exponential backoff with bounded deterministic jitter; expired post-handoff work and post-handoff errors become `needs_attention` instead of being blindly resent. Explicit user retry creates a new provider idempotency attempt for failed/reviewable keys only and leaves completed/skipped items unchanged.

Task 26 remains process-local contract machinery. Durable jobs rehydrate only the exact The Squad mock connection after a process restart, using a `.invalid` callback URL and exact organization/actor/connection identity. `ENABLE_MOCK_THE_SQUAD_PROVIDER` remains false by default, every surface says demo/mock, and no live endpoint, credential, or credential name was added.

## TDD evidence

### RED

- The first focused application/unit run failed because `preview-roster-export`, `start-roster-export`, `retry-sync-job`, durable gateway, worker dispatch, and UI modules did not exist.
- The first focused pgTAP run failed because the six integration tables, tenant constraints, RLS policies, indexes, and RPCs did not exist.
- The first real-database integration path failed before the migration and durable confirmation/claim/completion/retry transitions existed.
- The protected-processor test failed with `claimIntegrations` called zero times, proving the integration outbox was not wired into the authenticated worker boundary.
- The organization navigation test could not find the `Integrations` link before the route was made discoverable.
- The empty-roster real-database test exposed a concrete defect after fixture setup: PostgreSQL `array_agg` returned `NULL`, and confirmation attempted to insert a null `item_keys` outbox value. Production SQL was then changed to persist an immediately completed no-op job and omit outbox work.

### GREEN

- Focused integration unit and processor suites: 7 files / 24 tests passed.
- Navigation boundary: 1 file / 4 tests passed.
- Focused pgTAP: 1 file / 56 assertions passed.
- Focused real database export: 1 file / 1 end-to-end test passed, including repeat confirmation, partial completion, mapping stability, retry subset preservation, and empty-roster no-op.
- Task 26 provider contracts: 3 files / 142 tests passed.
- Chromium and Mobile Chrome: 4 tests passed, covering destination/field review, confirmation, retry, 375 px overflow, 44 px targets, and axe accessibility.

## Files

### Database and generated types

- `supabase/migrations/202608280077_integrations.sql`
- `supabase/tests/059_integration_integrity.test.sql`
- `src/infrastructure/supabase/database.types.ts`

### Application, persistence, and worker

- `src/modules/integrations/application/connect-demo-provider.ts`
- `src/modules/integrations/application/preview-roster-export.ts`
- `src/modules/integrations/application/start-roster-export.ts`
- `src/modules/integrations/application/retry-sync-job.ts`
- `src/modules/integrations/infrastructure/supabase-integration-gateway.ts`
- `src/infrastructure/integrations/dispatch-integration-job.ts`
- `src/infrastructure/integrations/integration-outbox.ts`
- `src/infrastructure/integrations/ensure-demo-mock-connection.ts`
- `src/infrastructure/integrations/server-provider-registry.ts`
- `src/app/api/jobs/process/route.ts`
- `src/infrastructure/integrations/mock-the-squad-provider.ts` — fail-once item identity was made stable across durable retry attempt keys.

### Authorization, routes, and UI

- `src/modules/organizations/application/capabilities.ts`
- `src/modules/organizations/components/organization-navigation.tsx`
- `src/modules/integrations/ui/integration-card.tsx`
- `src/modules/integrations/ui/roster-export-wizard.tsx`
- `src/app/(app)/app/[organizationSlug]/organization/integrations/page.tsx`
- `src/app/(app)/app/[organizationSlug]/tryouts/[tryoutId]/rosters/[rosterVersionId]/export/page.tsx`

### Tests and browser fixture

- `tests/unit/integrations/*`
- `tests/unit/communications/process-jobs-route.test.ts`
- `tests/unit/organizations/organization-route-context.test.tsx`
- `tests/integration/integrations/roster-export.test.ts`
- `tests/e2e/mock-roster-export.spec.ts`
- `tests/fixtures/integrations/*`
- `playwright.integrations.config.ts`

## Release gates

- Clean schema application: `npm run supabase:reset` passed and applied migrations 001–077 in order.
- Full database suite: `npm run test:db` passed 59 files / 1,618 assertions.
- Full isolated-database integration suite: `npm run test:integration` passed 26 files / 192 tests.
- Task 26 contracts: `npm run test:contract` passed 3 files / 142 tests.
- Full application verification: `npm run verify` passed formatting, ESLint, strict TypeScript, 58 unit files / 753 tests, and the production Next.js build.
- Browser: `npx playwright test --config=playwright.integrations.config.ts --project=chromium --project='Mobile Chrome'` passed 4 tests.
- Dependency audit: `npm audit --audit-level=high` reported 0 vulnerabilities.
- Database type reproducibility: two consecutive `npm run db:types` runs retained SHA-256 `13da20fd258bc61d8aa09cbe1726133fb41a9721e0cf512f7bda95f19586fb52`.
- `git diff --check` passed.
- Strictness/secret audit found no broad TypeScript `any`, suppression directives, live provider URL, API key, client secret, access token, refresh token, or password in the Task 27 implementation. The only provider callback literal uses the reserved `.invalid` domain.

## Self-review

- Selection, roster decisions, finalization, preview, confirmation, and synchronization remain separate operations. Finalization still performs no export.
- Provider submission cannot begin until the current lease token/generation is fenced in the database.
- Provider results are schema-validated, item keys are restricted to the claimed subset, job state is derived from durable items, stable mapping uniqueness rejects conflicting identity, and persistence stores normalized error code/retryability only.
- Completed/skipped items are never reset by retry or by later result handling.
- Previewing is read-only with respect to the provider; only explicit reviewed confirmation creates durable work.
- The shared processor's response contains counters only and cannot echo payloads, recipients, roster fields, provider tokens, or errors.
- The integration worker and pages use the existing server-authenticated Supabase boundaries; no browser-held service credentials or provider credential surfaces were introduced.

## Release concerns

No blocking concern. The Squad remains intentionally synthetic and disabled unless `ENABLE_MOCK_THE_SQUAD_PROVIDER=true`. Production must keep the existing protected job-processor schedule and environment configured; enabling this mock flag demonstrates the workflow but does not authorize or imply a live provider transfer.
