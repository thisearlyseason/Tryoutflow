# Task 29 report — reports, onboarding progress, and deterministic demo data

## Status

Round-one review findings implemented and verified locally.

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
- A final audit found the original projection counted every candidate row before reporting truncation. A new pgTAP assertion failed `0 != 3`; each query now inspects at most 5,001 rows and the assertion passes for all three projections.

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
  PASS — migrations 001–083; 65 files / 1,750 assertions

supabase db reset
  PASS — migrations 001–083 plus deterministic Badlands seed

npm run test:unit
  PASS — 67 files / 924 tests

npm run test:integration
  PASS twice — 27 files / 194 tests on each run

npx vitest run --config vitest.integration.config.ts tests/integration/demo-seed.test.ts
  PASS — 1 file / 7 tests, including convergence, immutable/revision snapshots, population parity, and canonical weighted totals

npm run db:types && cmp regenerated types with the pre-run copy
  PASS — byte-identical

npx vitest run --config vitest.config.ts tests/unit/reports
  PASS — 4 files / 31 tests

npx vitest run --config vitest.config.ts tests/unit/organizations/organization-route-context.test.tsx
  PASS — 1 file / 5 tests

npm run format:check && npm run lint && npm run typecheck
  PASS

production environment variables + npm run build
  PASS — optimized production build and route collection

local Supabase environment + npx playwright test tests/e2e/onboarding-and-reports.spec.ts --project=chromium --project='Mobile Safari' --workers=1
  PASS — 6 authenticated/anonymous tests, including reviewer/evaluator/member/disabled/cross-tenant role matrix, axe, downloads, and 320 px layout

npm audit --audit-level=high
  PASS — 0 vulnerabilities

git diff --check
  PASS
```

## Audit notes

- The authenticated browser command must bind the Playwright web server to the same local Supabase runtime used by its setup. A diagnostic run with the config's intentionally fake fallback URL correctly failed sign-in; direct local GoTrue authentication passed, and the same suite passed 4/4 after supplying the local URL and keys.
- Source/CSV contract scans found only the intentional `example.test` synthetic identities and explanatory privacy copy. Browser downloads additionally assert the absence of guardian, email, phone, birth, emergency, eligibility, private-note, and evaluator fields.
- `next-env.d.ts` was temporarily rewritten by the development server and restored to its tracked `.next/types` references. No generated dev-path change is included.

## Concerns

- Oversized snapshots are intentionally rejected rather than partially downloaded. Organization owners can narrow athlete exports to a tryout; additional filter-specific exports remain future product work.
- The seeded identities deliberately have no passwords. Authenticated browser coverage creates and removes ephemeral local users instead of adding reusable credentials to the repository.
- The repository's supervised integration runner refuses the locally installed Supabase CLI database container because that older CLI omitted its expected `com.supabase.cli.workdir` label. Focused Task 29 integration is green; a direct unsupervised full-suite diagnostic is not a valid substitute because several suites require supervisor isolation. The clean unseeded full pgTAP suite is authoritative for schema verification. Running the full integration suite twice remains an environment/tooling concern until the local Supabase CLI/container label is refreshed.
- Full pgTAP on a seeded database is not fixture-isolated: older tests intentionally assume empty global tables and collide with the Badlands slug/counts. The complete suite passes after the required unseeded reset; pgTAP 064/065 pass on the seeded database.
