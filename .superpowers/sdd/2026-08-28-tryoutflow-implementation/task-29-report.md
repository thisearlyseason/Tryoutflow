# Task 29 report — reports, onboarding progress, and deterministic demo data

## Status

Round-four follow-up: migration 086 closes the remaining duplicate-registration-history work below the tryout athlete cap.  It is additive, preserves all pre-existing finalized, published, withdrawn, and cancelled history, and keeps latest registration status live after the naturally unique athlete population is bounded.

## Round-four evidence

- RED pgTAP 068 inserted 12,000 registrations for the lexically first athlete plus two later athletes. `EXPLAIN ANALYZE` proved the migration-085 `DISTINCT ON ... LIMIT 3` plan still read 12,002 registration leaf rows even though it used the intended index and performed no sort.
- Migration 086 adds private `report_tryout_athlete_population`, naturally keyed by `(organization_id,tryout_id,athlete_id)`. The exact primary-key scan reads only `maxRows + 1` memberships; one lateral latest-registration probe per already bounded athlete uses `(organization_id,tryout_id,athlete_id,created_at DESC,id DESC)`. The post-migration plan read three population rows and three registration rows, with no `Sort` or `Seq Scan`.
- A locked idempotent recount backfills existing history and repairs derived membership. An exact `registration_count` witness serializes insert/delete maintenance on each natural key, while `ENABLE ALWAYS` triggers cover insert, delete, and truncate paths. Two genuinely concurrent registration sessions converged on witness/history counts of `2 / 2`; two transactional migration replays retained the same count.
- Registration organization, tryout, and athlete identity are now immutable, including under replica-role writes. Status and other supported corrections remain mutable; deleting a duplicate falls back to the previous latest registration, deleting the last registration removes membership, and tenant/tryout parent foreign keys cascade without orphans.
- The population table has no client or service-role privileges, enables defense-in-depth RLS, uses tenant-safe cascading foreign keys, and is consumed only through fixed-search-path security-definer boundaries. pgTAP 068 covers backfill, replay, same-athlete multi-tryout history, cross-tenant isolation, replica behavior, latest-ID ties, nullable organization latest registration, withdrawn/cancelled population, max-row boundaries, and summary/export parity.

## Round-three evidence

- The U15 Converged Demo current lineage uses tryout `...201`, active exact evaluator assignments `...218`/`...219`, and verified final roster `...283`. Its independent published 90/10 rubric and two complete evaluator vectors now report Avery as `92.0000`, completed once, and never invalid. The preserved older lineage remains preservation evidence only.
- Seed convergence also retains deterministic legacy finalized roster `...285` without a snapshot. Manager and authorized reviewer summary responses therefore return the newest verified downloadable roster alongside `unavailableFinalizedRosterCount=1`; the UI presents both the download link and an accessible migration-unavailable warning. No-snapshot-only behavior remains unchanged.
- Migration 085 adds the exact `(organization_id, tryout_id, athlete_id, created_at DESC, id DESC)` registration index. Tryout candidates are selected directly from that relation with deterministic latest-per-athlete `DISTINCT ON` and `maxRows + 1` before joins, grouping, or final athlete sorting. pgTAP 067 injects 1,200 additional registrations, forces the exact-index plan, and rejects sort/seq-scan candidate work.
- A shared count contract treats any lifecycle/scored count over 10,000 as an overflow sentinel that requires `truncated=true`. The gateway rejects false sentinels before data is exposed, the application maps every truthful or explicit truncation case to `too_large`/413, and 1,000/1,001/10,000 remain valid.
- The seed and browser fixtures consume the canonical tryout/roster identifiers deliberately. Replay proves active exact assignments, stable canonical weighted scores, no duplicate canonical current lineage, and preservation of the legacy immutable facts.

## Round-two evidence

- Count decoding accepts the database's `10,001` overflow sentinel only when `truncated=true`; the application maps it to `too_large`/HTTP 413 instead of treating a truthful projection as a parser failure/503. Focused unit coverage exercises 1,000, 1,001, 10,000, and the 10,001 overflow boundary.
- Route → application → gateway now carries the request abort signal. A pre-aborted request avoids projection RPC work, an in-flight abort stops the mocked projection and returns 499 before a CSV body, and the gateway attaches the same signal to Supabase's query builder.
- Migration 084 adds exact index-backed candidate keys, preserves stable tenant ordering, and keeps `maxRows + 1` candidate materialization ahead of report joins/grouping. pgTAP 066 records the composite indexes, bounded cardinality, and EXPLAIN acceptance.
- Summary evaluation counts now join the submitted registration population used by evaluation CSV candidates. Final roster discovery selects only verified immutable snapshots, exposes unavailable legacy finals explicitly, and never emits a broken roster-download link.
- Completed and failed Badlands mock jobs retain completed/failed state, durable item outcome, external mapping, and result evidence while approved projection, provider preview, confirmation token, and raw roster fields are redacted. Migration 084 upgrades the pre-existing fixture to the same redacted fixed point; replay preserves it.
- Seed replay now adds a fixed, append-only U15 Converged Demo lineage beside pre-084 history: its own published 90/10 rubric, sessions, registrations, evaluations, and final roster snapshot. It does not touch old finalized/published records, and the canonical lineage is stable across replay. The convergence integration assertion snapshots legacy published rubric bytes and finalized roster facts before replay, then proves exact one-rubric/two-evaluation/one-roster canonical cardinalities afterwards.

## Review closure

- Migration 083 adds immutable private roster-report headers/items captured in the same finalization transaction. Every CSV field now comes from that snapshot; unverifiable legacy finals return `snapshot_unavailable`. Live identity/number changes and rejected decision/team mutations leave the original export unchanged, while a correction revision captures a distinct snapshot.
- Evaluation reporting now calculates each completed/locked evaluator vector with Task 18's scale normalization and exact decimal weights before aggregating evaluators to four decimal places. Draft, reopened, locked, completed, and invalid counts remain distinct; incomplete or missing-category vectors never become zero. The seed includes two independent 90/10 evaluator vectors that each produce `92.0000`.
- Candidate registrations and registration/session pairs are limited with stable indexed `maxRows + 1` helpers before joins, score aggregation, correlated lookups, and sorts. Evaluation/category/score cardinality and encoded bytes are separately capped; overflow fails with 413 and no partial download.
- Organization athlete summary/export now share the all-tenant-athletes population. Latest registration state is nullable for unregistered athletes and deterministic when multiple registrations exist; tryout scope includes only registrations for that tryout.
- Reviewers receive an exact tryout Reports affordance and only an immutable final-roster link. Server summary/export calls reauthorize the finalized roster and reviewer grant at execution; no athlete/evaluation/organization summaries are exposed.
- The seed no longer returns early when the organization exists. Mutable fixtures converge independently, mock success/failure jobs have approved projections plus consistent items/mapping/outcomes, and replay/corruption tests restore stable facts.
- CSV responses now use bounded UTF-8 chunks with pull/backpressure behavior, cancellation and request-abort handling. The handler awaits execution inside its private error boundary, so asynchronous failures become typed 503 responses before headers are committed.

## TDD evidence

- The first focused report/onboarding run was RED because the CSV commands, server projection gateway, route, report UI, and durable onboarding projection did not exist.
- RED cases were added for RFC 4180 quoting, Unicode/null/newline handling, prefixed spreadsheet formulas, immutable finalized-roster exports, private-field omission, evaluator/general-member denial, execution-time reauthorization, invalid IDs, empty reports, durable checklist derivation, strict projection parsing, route response contracts, row/byte overflow, and server truncation.
- The initial pgTAP report suite was RED before migration 082. It is now GREEN with 19 assertions covering ACLs, empty `search_path`, exact scope, offboarding, non-oracular denial, allow-listed fields, maximum-row enforcement, and `maxRows + 1` database work bounds.
- A final audit found the original projection counted every candidate row before reporting truncation. Behavioral pgTAP coverage now proves the additive bounded helpers inspect only `maxRows + 1` candidates before expensive evaluation work; roster rows come from the already bounded immutable snapshot.

## Delivered

- Added server-authorized athlete, evaluation, and finalized-roster snapshot RPCs. Every call rechecks active membership and exact tryout/division capability at execution time; invalid, cross-tenant, evaluator, general-member, and offboarded calls fail closed without a resource-existence oracle.
- Added a strict application/gateway boundary that rejects unexpected projection fields. General CSVs contain only explicit allow-listed fields and omit guardian/contact/emergency/eligibility data, private notes, evaluator identity, and provider material. Reviewers can request only an exact finalized roster within their existing approved division scope.
- Added stable CSV ordering, CRLF/RFC 4180 quoting, UTF-8, null/newline/Unicode support, spreadsheet-formula defense through whitespace/control prefixes, safe filenames, 5,000-row and 4 MiB limits, and truthful 409/413/503 states. The route returns a chunked `ReadableStream`, exact CSV content/disposition headers, private no-store caching, and no-sniff protection.
- Added organization and tryout report pages with accessible empty/summary/final-roster states and navigation. Roster downloads come only from an immutable finalized snapshot.
- Added an SSR-safe onboarding checklist derived exclusively from durable organization settings, published registration/rubric records, active staff, sessions, completed evaluations, and finalized rosters. No caller completion flags or browser storage are used.
- Added an idempotent, deterministic Badlands Hockey Academy seed using fixed synthetic UUIDs/timestamps and `example.test` identities without passwords or provider credentials. It contains three positions, two sessions, two evaluators, five athletes, a formula-like name, one incomplete evaluation, an exact complete score-vector tie, four decision kinds, finalized plus correction-draft rosters, and successful plus failed mock sync jobs.
- Added regenerated Supabase types, report/onboarding unit tests, live seeded integration assertions, pgTAP 064, and authenticated Chromium/Mobile Safari coverage for the real route/PostgREST/RPC/download path, axe, 320 px layout, and anonymous no-leak behavior.

## Verification

```text
supabase db reset --no-seed && npm run test:db
  PASS — migrations 001–086; 68 files / 1,822 assertions

supabase db reset
  PASS — migrations 001–086 plus deterministic Badlands seed

npx supabase test db supabase/tests/068_report_duplicate_history_bounds.test.sql
  PASS on clean and seeded databases — 1 file / 55 assertions; old/new actual registration leaf reads 12,002/3

two concurrent psql registration transactions + two `psql -1` migration 086 replays
  PASS — membership witness and registration history both remained exactly 2

npm run test:integration
  PASS twice under the Task 20 supervisor — 27 files / 201 tests on each run (43.42s and 42.97s)

npx vitest run --config vitest.integration.config.ts tests/integration/demo-seed.test.ts
  PASS — 1 file / 9 tests, including replay digest, legacy immutable-byte preservation, active canonical evaluator assignments, mixed verified/unavailable snapshot discovery, exact canonical lineage cardinalities, convergence, immutable/revision snapshots, population parity, and canonical weighted totals

npm run db:types (twice)
  PASS — identical SHA-256 cbcb54c829d573df0e991e6d426f8044ae57fc8f6289cc96b2358d8ccf352824 on both runs; generated nullable provider_preview_id types updated for migration 084

npx vitest run --config vitest.config.ts tests/unit/reports
  PASS — 4 files / 31 tests

npx vitest run --config vitest.config.ts tests/unit/organizations/organization-route-context.test.tsx
  PASS — 1 file / 5 tests

npm run format:check && npm run lint && npm run typecheck
  PASS

npm run verify
  PASS — formatting, lint, typecheck, 67 unit files / 949 tests, and the Task 28 production marketing build (unit duration 109.15s)

production environment variables + npm run build
  PASS — optimized production build and route collection

local Supabase environment + npx playwright test tests/e2e/onboarding-and-reports.spec.ts --project=chromium --project='Mobile Safari'
  PASS — 6 authenticated/anonymous tests, including canonical Avery 92.0000 reports, manager/reviewer mixed-snapshot warning and download, reviewer/evaluator/member/disabled/cross-tenant role matrix, axe, downloads, and 320 px layout

npm audit --audit-level=high
  PASS — 0 vulnerabilities

git diff --check
  PASS
```

## Audit notes

- The authenticated browser command must bind the Playwright web server to the same local Supabase runtime used by its setup. A diagnostic run with the config's intentionally fake fallback URL correctly failed sign-in; direct local GoTrue authentication passed, and the same suite passed 6/6 after supplying the local URL and keys.
- Source/CSV contract scans found only the intentional `example.test` synthetic identities and explanatory privacy copy. Browser downloads additionally assert the absence of guardian, email, phone, birth, emergency, eligibility, private-note, and evaluator fields.
- `next-env.d.ts` was temporarily rewritten by the development server and restored to its tracked `.next/types` references. No generated dev-path change is included.
- The integration supervisor initially rejected the local database before acquiring a lock because a direct Homebrew Supabase CLI `2.72.7` reset had recreated the database container without `com.supabase.cli.workdir`. The repository pins CLI `2.116.0`; recreating the disposable stack through `npm run supabase:start` and `npm run supabase:reset` restored the exact worktree label. Task 20 then validated the endpoint/container PostgreSQL identity, and both full supervised runs exited cleanly with zero residual runner sessions, isolated databases, harness schemas, or run roles.
- The earlier full-verify pause was not a deadlock or a failing test. The unit suite's integration-supervisor recovery tests intentionally exercise bounded process timeouts and are quiet while running. With no competing process in this worktree, the fresh suite completed normally in 107 seconds before the production gate ran.

## Concerns

- The original initial-organization branch remains for pristine setup. Existing pre-085 Badlands data is preserved as history; report/demo assertions deliberately use the U15 Converged Demo lineage when a former immutable fixture is unverifiable. Legacy no-snapshot finals remain explicitly unavailable rather than being retroactively fabricated.

- Oversized snapshots are intentionally rejected rather than partially downloaded. Organization owners can narrow athlete exports to a tryout; additional filter-specific exports remain future product work.
- The seeded identities deliberately have no passwords. Authenticated browser coverage creates and removes ephemeral local users instead of adding reusable credentials to the repository.
- The canonical full pgTAP suite is intentionally run after an unseeded reset because older suites own empty-global fixtures. Seed verification is separate: seeded pgTAP 064/065 and the supervised demo-seed integration suite both pass.
