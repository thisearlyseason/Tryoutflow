# Task 6 report: authoritative tryout journey

## Commit

- Exact base: `2412af87bf0eacf60e910c8ac3d0ae06d6f9e596`
- Implementation commit: `c8e8f621ce9fe1ee6a62bf14ef2ded079c97179a`
- Implementation range: `2412af87bf0eacf60e910c8ac3d0ae06d6f9e596..c8e8f621ce9fe1ee6a62bf14ef2ded079c97179a`

## Implementation

- Added `loadTryoutJourney(client, scope)`, an authoritative five-stage projection for Prepare, Participants, Run tryout, Make decisions, and Complete.
- Strictly parses route scope, the root tryout, setup progress, roster existence, staffing existence, live-dashboard results, and every exact count. The root lookup and every stage authorize the required capability and tenant/tryout scope before reading.
- Uses exact head counts for participants, sessions, and communication messages; limit-one reads for setup/roster states; the existing authorized live-dashboard RPC for eligible check-in/evaluation evidence; and the existing authorized staffing RPC with `.limit(1)` for evaluator-assignment existence.
- Isolates stage dependency failures as `unavailable`. Known stages remain intact, a known finalized roster is retained if only communication loading fails, and no failed dependency is converted to a zero count.
- Implements the required exact recommendations: draft → `Continue setup`, published-empty → `Add first participant`, participants-ready → `Open check-in`, evaluations-ready → `Review rankings`, and roster-finalized → `Review communication`.
- Replaced the static overview action plan with one recommended-next banner and five evidence-backed stage cards, including counts, blockers, primary actions, and specialist links.
- Added compact `Back to overview` / `Next:` navigation to participants, sessions, check-in, live, rankings, rosters, messages, and reports while leaving each specialist workspace and its controls in place.
- Added `not-started` to the shared status badge vocabulary and responsive journey styling.
- No business-rule, database-schema, migration, or generated database-type change was required.

## TDD evidence

### Baseline

- `corepack npm exec -- vitest run --config vitest.config.ts tests/unit/tryouts tests/unit/registration --maxWorkers=2`
  - 22 files passed, 97 tests passed on the exact base.

### RED

- Ran the Task 6 focused command before either production module existed:
  - `corepack npm exec -- vitest run --config vitest.config.ts tests/unit/tryouts/load-tryout-journey.test.ts tests/unit/tryouts/tryout-journey.test.tsx`
  - Exit 1: two suites failed because the journey projection and UI modules were missing.
- Added dependency-isolation regressions before their fixes:
  - A communication-only failure RED showed a generic completion failure and lost the already-known finalized roster/action.
  - A missing-evaluator RED incorrectly reported the Run stage ready with `Open check-in`.
- The fresh PostgreSQL test then exposed that live-dashboard `activeEvaluators` is enrollment-relative: with a real evaluator assignment but no enrollment yet, the projection incorrectly recommended `Review staff`.
  - Added a unit regression separating durable evaluator assignment from enrollment-relative dashboard coverage.
  - RED: 3 failed and 9 passed, including the exact incorrect `Review staff` recommendation and absence of a bounded staffing read.

### GREEN

- Final focused unit command:
  - `corepack npm exec -- vitest run --config vitest.config.ts tests/unit/tryouts/load-tryout-journey.test.ts tests/unit/tryouts/tryout-journey.test.tsx tests/unit/tryouts/tryout-overview-loader.test.tsx tests/unit/registration/participant-workspace-header.test.tsx --maxWorkers=2`
  - 4 files passed, 17 tests passed.
- Final projection unit file after the staffing regression:
  - 1 file passed, 12 tests passed.
- Real PostgreSQL/RLS integration:
  - `corepack npm run test:integration -- tests/integration/tryouts/tryout-journey.test.ts`
  - 1 file passed, 1 test passed.
  - The authenticated client advanced through all five durable states, and a forged other-tenant scope returned the same non-oracular not-found outcome.
  - Post-test residue checks found 0 task-owned organizations and 0 task-owned auth users.

## Verification

- Full unit suite: 110 files passed, 1,207 tests passed.
- `corepack npm run format:check`: passed.
- `corepack npm run lint`: passed with no diagnostics.
- `corepack npm run typecheck`: passed with no diagnostics.
- Production build with non-secret synthetic public app/Supabase values: passed; all 36 static pages generated and every journey route was present.
- `git diff --check`: passed before the implementation commit.

## Files

Created:

- `src/modules/tryouts/application/load-tryout-journey.ts`
- `src/modules/tryouts/ui/tryout-journey.tsx`
- `tests/integration/tryouts/tryout-journey.test.ts`
- `tests/unit/tryouts/load-tryout-journey.test.ts`
- `tests/unit/tryouts/tryout-journey.test.tsx`

Modified:

- `src/app/(app)/app/[organizationSlug]/tryouts/[tryoutId]/overview/page.tsx`
- `src/app/(app)/app/[organizationSlug]/tryouts/[tryoutId]/sessions/page.tsx`
- `src/app/(app)/app/[organizationSlug]/tryouts/[tryoutId]/check-in/page.tsx`
- `src/app/(app)/app/[organizationSlug]/tryouts/[tryoutId]/live/page.tsx`
- `src/app/(app)/app/[organizationSlug]/tryouts/[tryoutId]/rankings/page.tsx`
- `src/app/(app)/app/[organizationSlug]/tryouts/[tryoutId]/rosters/page.tsx`
- `src/app/(app)/app/[organizationSlug]/tryouts/[tryoutId]/messages/page.tsx`
- `src/app/(app)/app/[organizationSlug]/tryouts/[tryoutId]/reports/page.tsx`
- `src/app/globals.css`
- `src/components/ui/status-badge.tsx`
- `src/modules/registration/ui/participant-workspace-header.tsx`
- `tests/unit/tryouts/tryout-overview-loader.test.tsx`

## Concerns

- The live-dashboard `activeEvaluators` value counts expected evaluator coverage only for enrolled participants; it is not an evaluator-staffing existence signal. The loader therefore uses the existing scope-authorized staffing projection with a one-row bound for the prerequisite and keeps the live dashboard authoritative for operational counts.
- The integration fixture seeds a completed evaluation under `session_replication_role=replica` because production deliberately rejects direct privileged evaluation writes outside its trusted command. The journey itself is loaded through a real authenticated Supabase client with PostgreSQL RLS and production RPC authorization active; cleanup is explicit, transactional, and residue-checked.
- The production build still requires deployment-owned public environment values, so verification used the same non-secret synthetic configuration documented by prior task reports.
- No subagent or reviewer was spawned because the controller explicitly prohibited delegation and reviewers. Local requirement, privacy, authorization, accessibility, and diff reviews found no remaining Task 6 gap.
