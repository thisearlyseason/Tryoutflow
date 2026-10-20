# Task 31 accessibility, viewport, and error-state gate report

## Review closure — fix round 1

The four review findings against `67949dfd6bc88683686b79b82c830b64efab5abc` are closed.

- The roster assertion now starts from the native `Select Roster Mover` checkbox, traverses forward
  to the Move button, reverses to the checkbox, traverses forward again, and activates with Enter.
  Chromium uses Tab/Shift+Tab; WebKit and Mobile Safari use the platform-native
  Option+Tab/Option+Shift+Tab convention that exposes all controls. Direct focus on the Move
  button was removed.
- Check-in search now announces exactly `Searching registrations…` in the existing single atomic
  status region, exposes `aria-busy` on the named registration-search landmark while work is
  pending, and recovers to the exact result message and `aria-busy="false"`. Check-in itself
  announces `Checking in <athlete>…`; the search landmark correctly remains not busy.
- Search and check-in have synchronous in-flight guards, and native repeated-click events beyond
  the first click are ignored. The slow-boundary test counts every matching Next Server Action,
  including matches after the held response, and proves one search action, one check-in action,
  and exactly one durable `public.checkins` receipt with assigned number 91. The helper waits for
  its held route to finish before unregistration, so a failed assertion cannot race route cleanup.
- The unused `monitorBrowserErrors` import was removed. No monitor allowance was added.

The required matrix also exposed an owning billing race: Mobile Safari could complete the first
fake-checkout failure before the second native click, allowing two checkout POSTs. `PlanCard` now
uses a synchronous in-flight ref plus the same native repeated-click guard while preserving the
existing error/conflict focus restoration and successful navigation behavior.

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
- All recorded quality and regression gates used retries `0` and had no skips. Two diagnostic runs
  encountered explicitly classified local-environment events described below; neither was hidden
  by a retry setting or monitor relaxation.
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

For review round one, the live-status assertion produced an executable product RED because no
named search landmark, `aria-busy`, or loading announcement existed. The owning component change
then passed the focused Chromium pair 2/2. The initially strengthened roster and request-count
assertions passed current production, so their sensitivity was proved with focused mutation REDs:
`tabIndex=-1` failed at the first forward traversal; removing the search guard exposed two later
search actions; and removing the check-in guard exposed two later check-in actions. Each mutation
was reverted before its focused GREEN run.

The first post-review 42-case matrix produced 41 passes and one genuine Mobile Safari checkout
RED: two request-boundary attempts. Converting that case to two same-turn DOM activations made the
RED deterministic. The synchronous checkout guard passed the focused case 1/1 and the next full
matrix passed 42/42. An affected Task 30 run then exposed the separate fast-response edge of a
native check-in `dblclick`; rejecting its second native click closed that product RED while keeping
deliberate later `Confirm … again` activation available.

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
- Error-state tests assert observable application behavior, exact initiating Server Action counts,
  and exact durable/database outcomes; they do not assert on fixture-only controls.

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
| Review-focused Chromium gate | 2/2 passed after the live-status/search guard change; 36/36 focused component/monitor unit tests and typecheck passed. |
| Review mutation checks | Three intended 0/1 REDs caught removed native tab order, removed search guard, and removed check-in guard; restored focused cases passed. |
| Required Task 31 engine matrix | 42/42 passed after the search/live-status and checkout in-flight fixes. After the final native-click guard, 41/42 passed with one pre-test GoTrue 504; the exact WebKit case passed 1/1 unchanged, completing the 42-project-equivalent gate. All runs used retries 0. |
| Affected Task 30 regression | Final owner-focused slice passed 9/9 across Chromium, WebKit, and Mobile Safari: check-in lifecycle, real Stripe/reporting lifecycle, and delayed roster concurrency; retries 0. |
| `corepack npm@11.12.1 run verify` | Prettier, ESLint, TypeScript, 71 unit files / 977 tests, and production marketing artifact verification passed. |
| Standalone production build | `NEXT_PUBLIC_APP_URL=https://tryoutflow.example.test corepack npm@11.12.1 run build` compiled, typed, collected, and optimized all routes. |
| Dependency audit | `corepack npm@11.12.1 audit --audit-level=high`: 0 vulnerabilities. |
| Diff gates | `git diff --check` passed; changed files were reviewed against the Task 31 file and ownership boundaries. |

The browser runs rebuilt and started the production Next application through the shared Playwright
web-server contract. One exploratory affected-regression run saw WebKit complete the CSV download
without its normally emitted `Frame load interrupted`; the strict monitor failed on the missing
declared event, and the exact unchanged case passed 1/1 immediately afterward. The final matrix
later saw local GoTrue return HTTP 504 while creating a fixture user before one WebKit test body;
the exact unchanged case passed 1/1 immediately afterward. These were separated from product REDs
and did not lead to a fixture retry, optional expectation, browser-noise allowance, or assertion
weakening. The Supabase `[inbucket]` deprecation and inherited `NO_COLOR`/`FORCE_COLOR` warning were
baseline environment chatter.

## Residue and scope audit

The final read-only residue audit found zero Task 30/31 browser users, organizations, integration
fixture databases, runner roles, harness schemas, fixture sessions, port 3112 listeners, or
worktree-owned Playwright/Next runners. `registration_rate_counters` contained 39 generic
unit-harness rows. Task 31's browser cases do not submit a public registration, and the fixture
still removes its exact scenario-derived keys; these unrelated rows were intentionally left intact.
Only Playwright's `.last-run.json` remained in the ignored output directory after the final passing
browser gate; no failure media or retry trace remained.

No global package, browser, database, Docker, or user configuration was mutated. The repository
continues to pin npm 11.12.1, Playwright 1.62.1, and Axe Playwright 4.13.0.

## Remaining concerns

No product blocker remains for Task 31. Local GoTrue and WebKit download-handoff diagnostics each
varied once under repeated production-build browser runs, but both exact unchanged cases passed
immediately and the final owner-focused regression passed 9/9. CI cold starts must download
Playwright system dependencies and local Supabase images on a fresh runner; the explicit 30-minute
job timeout bounds that external setup cost without weakening the gate.
