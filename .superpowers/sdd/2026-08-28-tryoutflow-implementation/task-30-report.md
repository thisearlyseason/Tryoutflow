# Task 30 cross-browser critical-flow report

## Outcome and configuration

The release-gate suite contains 14 independently seeded browser tests mapping all 13 requested scenarios plus the supporting ranking/concurrency gate. It uses real local GoTrue, PostgREST, application, and PostgreSQL boundaries. Every seeded test annotates the exact role, organization slug, tryout name/ID, roster, and provider where relevant. Scenario keys include project, title, repetition, and retry identity, so cross-project parallelism never shares users or product records.

Playwright runs Chromium, Firefox, WebKit, Mobile Chrome (Pixel 7), and Mobile Safari (iPhone 15), with en-CA/en-US/en-GB/fr-CA locales and Edmonton/Toronto/UTC/Vancouver/Halifax timezones. The suite performs a production build and starts the resulting server on deterministic loopback port 3112. Traces are retained on first retry; screenshots are captured only on failure and video is retained only on failure. The final matrix had no retry or failure, so it produced no failure-only media or retry trace.

Task 30 database/auth cleanup runs once before and after the suite, when no test owns a lifecycle transaction. Each scenario also removes its exact static registration keys and any dynamic confirmation/reissue/consume bucket-and-target keys it records in memory. This avoids disabling immutable triggers concurrently with product writes while retaining deterministic cleanup after failures. The final audit found zero Task 30 users, organizations, rate counters, integration databases, roles, schemas, sessions, listeners, or runner processes.

The host `npm` is 11.6.2 while `packageManager` pins `npm@11.12.1`. Verification used `corepack npm@11.12.1` or repository-local binaries. No global installation changed. The repository-pinned Playwright 1.62.1 browsers were already installed; no browser version was downloaded or drifted.

## Scenario matrix

| Scenarios | Exact browser evidence |
| --- | --- |
| 1 | A new owner signs in through local GoTrue, creates an organization, enters organization-local tryout dates, completes every setup step, and publishes. |
| 2–3 | A public guardian registers from a deterministic reserved TEST-NET address, receives/uses the real confirmation token, the administrator sees the athlete, and check-in double-clicking assigns exactly one number. |
| 4 | Three independent evaluator browser contexts save private notes and scores; no peer note leaks; the director sees the aggregate and PostgreSQL proves exact `84.0000`. |
| 5 | The evaluator saves while offline, IndexedDB survives reload and a deliberately lost first response, the real online event drains the outbox, exactly one successful mutation reaches the server, and exactly one evaluation exists. |
| 6–7 | Other-tenant owner, check-in staff, evaluator, reviewer, member, and anonymous users are denied direct organization/tryout URLs without an existence oracle. |
| 8–9 | A director moves a draft athlete, changes decisions without sending, finalizes, revises with an audit reason, previews one exact recipient, and creates one separate durable message batch/status. |
| 10–11 | The explicit demo/mock integration connects, previews a finalized roster, loses a response after the real app commit, retains one job, records a 1/1 partial result, retries only the failed item to 2/2, and never duplicates jobs or mappings on replay. |
| 12 | The exact server-test-only fake checkout/portal contract returns Stripe-owned test URLs. A signed raw `Buffer` reaches the real webhook route, active/replay/cancel events cross the real DB boundary, checkout intent truth is expired/redacted, account/provider IDs and two events are exact, and the downloaded roster CSV is sanitized. |
| 13 | Evaluator at 375 px, roster at 320 px, and marketing/auth at 430 px prove keyboard/focus behavior, 44 px targets, no horizontal overflow, axe, computed reduced motion, icon 200/SVG, and hydration-clean rendering. |
| Supporting ranking/concurrency | Exact ranking tie/compare completion evidence and two already-mounted director tabs rejecting the stale second roster write. |

The responsive monitor has no broad error allowance: it fails every page error, unexpected console error, non-RSC abort, and RSC failure other than exact browser-cancelled `_rsc` `net::ERR_ABORTED`. Other lifecycle tests allow only their exact intentional offline/lost-response failures and exact Next server-action navigation cancellations, matched by method, `next-action` header, target URL, and browser cancellation code.

## RED classification and fixes

Genuine product failures found by the browser gates:

- Organization-local `datetime-local` values were interpreted in the server timezone. Parsing now uses the organization IANA zone with DST-safe validation.
- Wizard session save referenced an ambiguous division identifier. Additive migration 088 and pgTAP 070 repair and prove the RPC without editing migration history.
- Active scoped staff could not read their organization shell; the capability boundary was repaired and regression-tested.
- Evaluation and billing same-origin checks compared the internal Next URL instead of the trusted external host/protocol.
- Ranking timestamps hydrated differently across locale/timezone projects, and compare/back links resolved relative to the wrong route.
- Demo-provider connection state did not cross Next route bundles, while fixed mock athlete IDs broke isolated partial-result cases.
- Subscription timestamp schemas rejected valid PostgREST offsets, and route modules exported non-route test helpers that broke production build.
- Reduced-motion CSS still retained 0.01 ms motion, auth controls were below 44 px, and controlled roster dialogs did not restore focus.
- Authenticated `/app` had no owning landing route and returned 404 before redirecting to the active organization.
- Organization navigation, report-download links, and evaluator athlete pager links prefetched dynamic RSC/download routes. This caused avoidable 404/cancellation noise and WebKit internal errors while offline; those boundaries no longer prefetch.
- Roster revalidation cleared a successful operation status nondeterministically. Same-roster revalidation now preserves the status, while roster identity changes remount the builder and clear it.
- The fake billing provider was selectable with one flag. A failing boundary test now proves it is reachable only when the exact Task 30 mode, public origin, loopback origin, port, and fake flag all match.

Fixture/environment failures were kept separate from product RED:

- Invalid underscore-bearing Stripe fixture IDs, drifting timestamps, title-case CSV expectations, and an incorrect expectation that a completed checkout intent remained active were corrected to the provider/database contracts.
- Local public registration initially had no trusted forwarded address. The fixture now uses a deterministic RFC 5737 address and deletes its three exact registration counters plus token-derived confirmation counters.
- WebKit does not reliably emit the native online event when Playwright lifts offline emulation. The fixture dispatches the real application `online` boundary and waits for the first intercepted POST before reload.
- Authentication helpers raced intermediate `/app` navigation; they now wait for the exact organization home and network idle. WebKit keyboard traversal uses its Alt+Tab convention.
- Per-test immutable-trigger cleanup deadlocked parallel seed/product work. Trigger-safe cleanup moved to suite setup/teardown, outside all test lifecycles.
- Expected download cancellation, deliberate offline/lost-response errors, and browser-specific completed server-action navigation cancellations received narrow method/header/URL/error classifiers. Assertions were not removed or weakened.
- The first post-fix full matrix reported 68/70: WebKit-family scenario 5 exposed the pager-prefetch product defect and the missing explicit online-event fixture control. After the owning fixes, six repeated WebKit/Mobile Safari cases, the full matrix, and the high-risk repetition gate all passed with retries disabled where specified.
- The first pinned verification stopped at Prettier on the newly changed offline fixture. Formatting was fixed mechanically before the entire command was rerun; no product assertion changed.
- A post-matrix residue audit found ten confirmation limiter rows: two token-derived keys for each project. This was a fixture cleanup defect, not product RED. The fixture now tracks exact rate bucket/target keys, the focused public flow passed 5/5, the subsequent 70-test matrix left zero browser-owned limiter rows, and the final reset cleared verification-harness rows without a broad suite-time delete.
- One attempted focused command used `npm exec` without an argument separator, so npm consumed the Playwright grep/reporter flags and launched 30 lifecycle cases. That non-gating run reported one Firefox icon `NS_BINDING_ABORTED` retry and 29 direct passes; the monitor correctly failed the non-RSC abort and no allowance was added. The corrected repository-binary invocation passed the intended 5/5 public cases, and the exact final matrix passed without retries or flakes.

## Final verification evidence

| Gate | Result |
| --- | --- |
| Focused billing scenario 12, Chromium | 1/1 passed after the exact-environment guard and raw signed-body fix; retries 0 (final focused run 11.5 s). |
| Billing environment boundary unit test | RED on the absent guard; GREEN 1 file / 7 tests. |
| Evaluation component unit regression | 1 file / 53 tests passed (4.84 s). |
| Responsive/accessibility focused projects | 12/12 across Chromium, WebKit, Mobile Chrome, and Mobile Safari; retries 0. |
| Public registration/confirmation cleanup gate | 5/5 across all configured projects; retries 0 (13.2 s), with zero browser-owned limiter rows afterward. |
| Chromium exact four-spec gate | 14/14; retries/skips 0 (24.6 s). |
| Five-project exact matrix | Final-source run 70/70, exactly 14 per project; retries/skips/flakes 0 (1.3 min). |
| Firefox/WebKit/Mobile Safari high-risk repeats | 27/27: offline, stale two-tab concurrency, and integration partial retry/replay, each repeated three times; retries 0 (45.2 s). |
| Clean migration replay | Migrations 001–088 plus deterministic seed passed. |
| Focused pgTAP 070 | 1 file / 3 assertions passed. |
| Full pgTAP after unseeded reset | 70 files / 1,875 assertions passed (13 s). |
| Supervised integration, twice | 27 files / 203 tests both runs; 41.11 s and 40.99 s; zero supervisor/database/process residue. |
| `corepack npm@11.12.1 run verify` | Formatting, ESLint, TypeScript, 68 unit files / 958 tests (109.33 s), and the Task 28 production artifact gate passed. |
| Standalone production build | All routes compiled, typed, collected, and optimized with an explicit HTTPS public origin. |
| Dependency/security/diff audit | `npm audit --audit-level=high`: 0 vulnerabilities; secret scan and `git diff --check`: clean. |
| Final state | Task 30 users/orgs/rate counters 0; integration DBs/roles/schemas/sessions 0; port 3112 listener and owned test processes 0. |

## Honest release gaps

No local result claims real Stripe checkout, live Resend delivery, or certification against a live team-management provider. Billing uses Stripe's maintained signing implementation and Stripe-owned fake URL contract; communications and integration use explicit fake/demo provider contracts while exercising the real application, authorization, idempotency, and database boundaries. Production credentials, provider sandbox certification, webhook reachability, and actual external delivery remain release gates.

The final HTML report is under `playwright-report`; Playwright result metadata is under `output/playwright/test-results`. Clean runs leave no failure-only screenshot/video artifact, and a no-retry matrix correctly leaves no first-retry trace.
