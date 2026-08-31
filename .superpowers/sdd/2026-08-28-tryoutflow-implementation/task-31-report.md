# Task 31 accessibility, viewport, and error-state gate report

## Outcome

Task 31 is implemented from baseline `8f6c8831d4a937d59797bdb5404006f53214f4a2`.
The new Playwright release gate exercises production routes with Task 30's real local
GoTrue/PostgREST/PostgreSQL fixtures and its counted console, page-error, request-failure, Server
Action, and RSC monitor. No fixture-only page is used for a production claim.

The gate covers registration, sign-in, tryout wizard, check-in, mobile evaluation, rankings,
roster, messages, billing, and integration review. Every screen is checked at 375×812, 390×844,
430×932, 768×1024 tablet, 1366×768 laptop, and 1920×1080 large-desktop viewports. Error-state
coverage proves local offline evaluation persistence and one reconnect mutation, delayed check-in
loading and repeat-submit disabling, exact failed-checkout copy and focus recovery, double-click
suppression, successful retry, and integration review behavior through back, forward, and refresh.

## Existing Task 30 contracts preserved

- The new specs import `tests/e2e/helpers/fixtures.ts`, `helpers/auth.ts`, and
  `helpers/network.ts` directly. They retain per-test tenant/user/scenario identity, exact public
  rate-key cleanup, execution-time authorization, and global teardown.
- No broad console, page-error, request-failure, RSC, or browser-noise allowance was added.
  The one deliberate checkout abort is declared once with exact method, absolute organization URL,
  browser-observed error, and Chromium console diagnostic.
- Server Action navigation cancellations remain exact, counted, header-bound declarations.
- All quality and regression runs used retries `0`; there were no skips, retries, or flakes.
- No migration, schema, tenant boundary, privacy boundary, authorization rule, idempotency contract,
  provider execution contract, or fixture cleanup implementation changed.

## TDD and RED classification

The first required Chromium invocation reported `No tests found`. This was fixture/configuration
RED: Task 30 deliberately allowlisted four spec filenames in `playwright.config.ts`, so the three
new Task 31 files were not discoverable even when named on the CLI. The allowlist was extended with
only `accessibility.spec.ts`, `viewports.spec.ts`, and `error-states.spec.ts`; workers, retries,
fixtures, web server, projects, and strict monitors were not weakened.

The first executable Chromium run produced 13 passes and one genuine product RED. A deliberately
failed Team checkout displayed the exact recovery copy and re-enabled the button, but the active
element was lost. Root-cause inspection confirmed that disabling the focused button during the
request causes the browser to drop focus, while re-enabling it does not restore focus automatically.

The owning `PlanCard` now keeps a ref to its semantic `Button` and restores focus after either the
`error` or `conflict` recovery state commits. No focus is forced during success navigation. The
focused regression then passed 1/1, followed by the complete Chromium gate at 14/14.

## Accessibility and responsive implementation

- `expectNoCriticalAccessibilityViolations(page)` runs unmodified Axe 4.13.0 analysis and reports
  every critical violation with rule, help URL, target, HTML, and failure summary. It has no rule
  exclusions, selector exclusions, or result suppression.
- Accessibility tests verify named headings, native labels/autocomplete, live statuses, explicit
  integration field approval, disabled confirmation before review, semantic score controls,
  keyboard roster movement, dialog initial focus, and trigger focus restoration.
- Viewport tests read `document.documentElement.scrollWidth` and `clientWidth` after every resize
  and require document-level overflow to be absent on every named critical screen at all six
  viewports. At 375 px, evaluator save and completion actions must remain in the viewport.
- Error-state tests assert observable application behavior and exact durable/database outcomes;
  they do not assert on mocks or fixture-only controls.

## Deterministic CI gate

The existing CI job now uses repository-pinned npm 11.12.1 explicitly, installs the repository's
Playwright 1.62.1 Chromium and WebKit browser engines, starts local Supabase, and runs the three
Task 31 specs on Chromium, desktop WebKit, and Mobile Safari with retries disabled. The existing
repository verification remains ahead of the browser gate. The job has a 30-minute bound.

## Verification evidence

| Gate | Result |
| --- | --- |
| Existing Task 30 responsive baseline, Chromium | 3/3 passed before Task 31 changes. |
| Initial Task 31 discovery run | Fixture/configuration RED: no tests discovered by the Task 30 allowlist. |
| First executable Task 31 Chromium run | 13/14 passed; one genuine failed-checkout focus RED. |
| Focused failed-checkout regression, Chromium | 1/1 passed after the owning fix. |
| Full Task 31 Chromium gate | 14/14 passed, retries 0. |
| Required Task 31 engine matrix | 42/42 passed: 14 each on Chromium, WebKit, and Mobile Safari; retries/skips/flakes 0. |
| Affected Task 30 regression | 12/12 passed: real Stripe lifecycle, 375 px evaluator, narrow roster keyboard/focus, and marketing/auth across the same three engines; retries 0. |
| `corepack npm@11.12.1 run verify` | Prettier, ESLint, TypeScript, 71 unit files / 977 tests, and production marketing artifact verification passed. |
| Standalone production build | `NEXT_PUBLIC_APP_URL=https://tryoutflow.example.test corepack npm@11.12.1 run build` compiled, typed, collected, and optimized all routes. |
| Dependency audit | `corepack npm@11.12.1 audit --audit-level=high`: 0 vulnerabilities. |
| Diff gates | `git diff --check` passed; changed files were reviewed against the Task 31 file and ownership boundaries. |

The browser runs rebuilt and started the production Next application through the shared Playwright
web-server contract. The Supabase CLI deprecation notice for `[inbucket]` and Node's inherited
`NO_COLOR`/`FORCE_COLOR` warning were environment chatter already present at baseline; neither
masked a test, browser, build, or monitor failure.

## Residue and scope audit

The final read-only residue audit found zero Task 30/31 browser users, organizations, integration
fixture databases, runner roles, harness schemas, fixture sessions, port 3112 listeners, or
worktree-owned Playwright/Next runners. `registration_rate_counters` contained 78 generic unit
verification rows: 39 documented at the Task 30 baseline plus 39 from this task's full unit gate.
Task 31's browser cases do not submit a public registration, and the fixture still removes its
exact scenario-derived keys; these unrelated unit-harness rows were intentionally left intact.

No global package, browser, database, Docker, or user configuration was mutated. The repository
continues to pin npm 11.12.1, Playwright 1.62.1, and Axe Playwright 4.13.0.

## Remaining concerns

No product blocker remains for Task 31. CI cold starts must download Playwright system dependencies
and local Supabase images on a fresh runner; the explicit 30-minute job timeout bounds that external
setup cost without weakening the gate.
