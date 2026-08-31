# Task 29 report — reports, onboarding progress, and deterministic demo data

## Status

Implemented and verified locally.

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
npx supabase db reset --local --no-seed && npx supabase test db --local
  PASS — 64 files / 1,734 assertions

npx supabase db reset --local
  PASS — migrations 001–082 plus deterministic Badlands seed

npm run test:unit
  PASS — 67 files / 924 tests

npm run test:integration
  PASS twice — 27 files / 194 tests on each run

npm run test:integration -- tests/integration/demo-seed.test.ts
  PASS — 1 file / 2 tests, including replay digest stability

npm run db:types && cmp regenerated types with the pre-run copy
  PASS — byte-identical

npm run verify
  PASS — Prettier, ESLint, strict TypeScript, 924 unit tests, and production artifact build

local Supabase environment + npx playwright test tests/e2e/onboarding-and-reports.spec.ts --project=chromium --project='Mobile Safari'
  PASS — 4 tests

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
