# Task 30 cross-browser critical-flow report

## Independent review fix round 2 (2026-08-31)

Baseline `fb6bcf7432f11d25bd7af2c6d824900458b5162a`; implementation commit `11fdd54`. Both remaining monitor findings were reproduced against the reviewed code before editing.

| Finding | Genuine RED | GREEN boundary |
| --- | --- | --- |
| Authentication lifecycle | `signInAs` completed its first navigation, credential action, redirect, and network-idle wait before `openAuthenticatedContext` attached a monitor. Two owning tests proved that a first-navigation console error was therefore hidden. | `signInAs` now attaches the monitor before `/sign-in`, declares the exact sign-in Server Action before clicking, returns that same monitor, and `openAuthenticatedContext` preserves it. Chromium's generated home RSC request is declared before the sign-in action with exact method, `rsc: 1` header, application URL, error contract, and count. |
| RSC request failures | An unconditional URL-substring branch ignored every `GET` containing `_rsc=` with `net::ERR_ABORTED`. Owning tests proved an undeclared RSC failure and an extra identical failure both passed silently. | The blanket branch is gone. Required RSC cancellations are declared against one exact application URL, method, header, error, and count; the monitor captures the concrete generated full URL on `request` and binds the later failure to that same `Request`. Missing, extra, mismatched, non-RSC, and differently failed requests remain fatal. Cancellable sign-in RSC work is likewise counted at initiation and bound to its exact request. |

Focused TDD began at 4 failures / 7 passes: two authentication lifecycle failures, the undeclared RSC cancellation, and the extra RSC cancellation. Generated-token binding and strict cancellable-request coverage were then added RED-first. The final owning gate is 2 files / 16 tests. A five-engine ranking probe initially produced only Chromium-family fixture RED because speculative Next.js link prefetches were being superseded. Volatile wizard, athlete, overview, roster, ranking, comparison, and marketing links now opt out of speculative prefetch; the actual comparison navigation declares its one exact Chromium-family cancellation. No product assertion, skip, retry, or generic allowance was introduced.

Exact final round-two evidence:

| Command | Result |
| --- | --- |
| `corepack npm@11.12.1 exec -- playwright test tests/e2e/critical-lifecycle.spec.ts tests/e2e/role-denials.spec.ts tests/e2e/concurrency-and-replay.spec.ts tests/e2e/responsive-and-accessibility.spec.ts --retries=0 --reporter=line,json` | 70/70, 14 per project, 0 skips/retries/flakes, 5.0 min. |
| `corepack npm@11.12.1 exec -- playwright test tests/e2e/critical-lifecycle.spec.ts tests/e2e/concurrency-and-replay.spec.ts --project=firefox --project=webkit --project='Mobile Safari' --grep='scenario 5\|two director tabs\|scenarios 10–11' --repeat-each=3 --retries=0 --reporter=line,json` | 27/27, 9 per project, 0 skips/retries/flakes, 2.3 min. |
| `corepack npm@11.12.1 run verify` | Format, ESLint, TypeScript, 71 unit files / 977 tests, and the Task 28 production artifact gate passed. |
| `NEXT_PUBLIC_APP_URL=https://tryoutflow.example.test corepack npm@11.12.1 run build` | Standalone production build passed. |
| `corepack npm@11.12.1 audit --audit-level=high` | 0 vulnerabilities. |

Fresh sanitized evidence is `task-30-evidence/final-matrix.json` (70 entries, SHA-256 `de4603b24092712c349d7951fbe348698a2ebcf6e29a3cf70b2b4fd8b237b938`) and `task-30-evidence/repeat-gate.json` (27 entries, SHA-256 `1a0901f54751bea3ec703edd707e7de24a139ba8a160c441bd17f683258c21c3`). Both retain project, file, line, title, result, duration, retry index, and start time while excluding configuration, environment, stdout/stderr, annotations, secrets, and synthetic fixture identifiers.

No schema, migration, database contract, provider integration, or job supervisor changed in this narrow round. The round-one clean migration/pgTAP and twice-supervised integration evidence below remains the owning evidence for those unchanged boundaries; rerunning them would not exercise the browser-monitor or `Link` prefetch changes.

The final round-two residue audit found zero Task 30 users/organizations, integration databases/roles/schemas/sessions, port 3112 listeners, or Task 30-owned runners. Thirty-nine generic registration limiter rows were created later by the full unit verification gate and were left intact because they are not browser-suite residue. A long-lived headed Playwright daemon was traced to a different worktree and likewise left untouched.

## Independent review fix round 1 (2026-08-31)

Baseline `e7dfd6271719b1cc71612994c335fd6fe1d12187`; implementation commit `21b6ab2`. All five Important findings were reproduced before their owning fix.

| Finding | Genuine RED | GREEN boundary |
| --- | --- | --- |
| Wizard timestamps | Three owning unit cases failed because `datetime-local` strings reached the RPC unchanged; pgTAP 071 failed 3/5 because PostgreSQL cast them in the server zone. | The application now validates the selected IANA zone and converts registration/session wall times to UTC. Additive migration 089 repeats the conversion and DST round-trip validation at the database boundary. Unit 3/3, pgTAP 070+071 8/8, and scenario 1 prove Edmonton instants `2026-09-01T14:00:00Z`, `2026-10-01T02:00:00Z`, `2026-10-01T22:00:00Z`, and `2026-10-02T00:00:00Z`. |
| Roster lifecycle | The reviewed scenario opened a SQL-seeded roster and therefore could not prove creation or frozen-state behavior through the application. | Scenario 8 creates `UI Blue`/`UI Gold` through the real UI, moves the exact athlete, records a decision, finalizes, verifies immutable audit evidence, then attempts a stale mutation. A digest of the roster/assignment/decision rows and the audit count remain byte-for-byte unchanged before revision. The focused lifecycle passed all five projects. |
| Export replay | After the deliberately lost response, the test reloaded and observed the job but issued only one confirmation request. | The same still-mounted confirmation form replays the identical command before reload. The second response is successful, the durable `id`, business idempotency key, and preview identity are unchanged, and job/outbox/items remain exactly `1:1:2`; scenario 11's failed-item retry remains separate. |
| Strict monitor | Three of four new owning unit cases failed against URL-only allowances; monitoring also began after some product navigation. | The monitor now requires exact count, method, full URL, error, and optional header predicates. Server Actions are counted on the exact `Request`, only their explicit browser cancellation codes are accepted, missing/extra requests fail, and all unrelated console/request/page errors remain fatal. Round two subsequently removed the remaining sign-in setup exception and the blanket RSC branch. |
| Evidence | The report referenced a stale 30-run HTML report rather than the final matrix. | Sanitized machine-readable Playwright evidence now preserves every final result, duration, retry index, project, title, file, and start time: `task-30-evidence/final-matrix.json` (70 entries, SHA-256 `4fe45ec8b6875ac751f6a9dac6435e6123c17f9842635529a9910f7028e06b4b`) and `task-30-evidence/repeat-gate.json` (27 entries, SHA-256 `118be15187bcfa37dff00684ba982b339129da9f48875ffc1cc1008acdfdc3ba`). Reporter configuration/environment and stdout were stripped so no local keys, secrets, or PII are retained. |

Additional genuine browser RED found during closure: redundant roster `revalidatePath` calls superseded successful Server Action streams under saturation. The owning page already receives authoritative action state, so those revalidations were removed; draft creation now allows two animation frames for the action response to settle before its deliberate full reload. Exact Server Action declarations—not broad ignores—cover the engine-level completed-navigation cancellation. Chromium scenario 8 repeated 3/3, then all five projects passed.

Fixture/environment RED remained distinct:

- Firefox completes attachment downloads and renders main-document 404s without the Chromium/WebKit failure/console events. WebKit reports deliberate route aborts as exact `Blocked by Web Inspector` and completed downloads as exact `Frame load interrupted`. Engine-specific predicates model those observed contracts while the download and 404 response assertions remain unchanged.
- Explicit pgTAP path arguments were truncated by the Supabase CLI inside the hidden worktree and produced `NOTESTS`; the supported full runner exercised 070 and 071 successfully. Running full pgTAP against the deterministic demo seed correctly exposed seed/test isolation conflicts; `db reset --no-seed` followed by the same full runner passed 71/71 files and 1,880 assertions.
- The first supervised integration attempt inherited the deliberately unseeded pgTAP database, so the demo-seed contract was absent (201/203) and cleanup met immutable test rows. A clean deterministic seeded reset restored the documented precondition; both required supervised runs then passed 27 files / 203 tests. The exact failed-run state files were moved recoverably to Trash after the reset proved their database role/schema/session objects absent; no current-round manifest remains. Nine older manifests from prior work remain untouched.

Exact final commands and results:

| Command | Result |
| --- | --- |
| `corepack npm@11.12.1 exec -- playwright test tests/e2e/critical-lifecycle.spec.ts tests/e2e/role-denials.spec.ts tests/e2e/concurrency-and-replay.spec.ts tests/e2e/responsive-and-accessibility.spec.ts --retries=0 --reporter=line,json` | 70/70, 14 per project, 0 skips/retries/flakes, 4.7 min. |
| `corepack npm@11.12.1 exec -- playwright test tests/e2e/critical-lifecycle.spec.ts tests/e2e/concurrency-and-replay.spec.ts --project=firefox --project=webkit --project='Mobile Safari' --grep='scenario 5\|two director tabs\|scenarios 10–11' --repeat-each=3 --retries=0 --reporter=line,json` | 27/27, 0 skips/retries/flakes, 2.2 min. |
| `corepack npm@11.12.1 exec -- supabase db reset --local --no-seed && corepack npm@11.12.1 run test:db` | Migrations 001–089 replayed; 71 files / 1,880 assertions passed. |
| `corepack npm@11.12.1 exec -- supabase db reset --local && corepack npm@11.12.1 run test:integration && corepack npm@11.12.1 run test:integration` | Both supervised runs: 27 files / 203 tests; 38.49 s and 38.36 s. |
| `corepack npm@11.12.1 run verify` | Format, ESLint, TypeScript, 70 unit files / 968 tests, and Task 28 production gate passed; 103.40 s unit duration. |
| `NEXT_PUBLIC_APP_URL=https://tryoutflow.example.test corepack npm@11.12.1 run build` | Standalone production build passed. |
| `corepack npm@11.12.1 audit --audit-level=high` | 0 vulnerabilities. |

Self-review found no skipped assertions, retry masking, generic error allowance, live provider claim, secret/PII artifact, or historical migration edit. There is no automatic RSC ignore: every permitted RSC request or cancellation is exact, structured, counted, and bound to its initiating request; every undeclared or differently failed request is fatal. Because all projects share one deliberately local Next/Postgres lifecycle, the canonical suite uses one worker; every test still owns isolated users, organizations, rate keys, and rows.

## Outcome and configuration

The release-gate suite contains 14 independently seeded browser tests mapping all 13 requested scenarios plus the supporting ranking/concurrency gate. It uses real local GoTrue, PostgREST, application, and PostgreSQL boundaries. Every seeded test annotates the exact role, organization slug, tryout name/ID, roster, and provider where relevant. Scenario keys include project, title, repetition, and retry identity, so cross-project parallelism never shares users or product records.

Playwright runs Chromium, Firefox, WebKit, Mobile Chrome (Pixel 7), and Mobile Safari (iPhone 15), with en-CA/en-US/en-GB/fr-CA locales and Edmonton/Toronto/UTC/Vancouver/Halifax timezones. The suite performs a production build and starts the resulting server on deterministic loopback port 3112. Traces are retained on first retry; screenshots are captured only on failure and video is retained only on failure. The final matrix had no retry or failure, so it produced no failure-only media or retry trace.

Task 30 database/auth cleanup runs once before and after the suite, when no test owns a lifecycle transaction. Each scenario also removes its exact static registration keys and any dynamic confirmation/reissue/consume bucket-and-target keys it records in memory. This avoids disabling immutable triggers concurrently with product writes while retaining deterministic cleanup after failures. The final audit found zero Task 30 users, organizations, rate counters, integration databases, roles, schemas, sessions, listeners, or runner processes.

The host `npm` is 11.6.2 while `packageManager` pins `npm@11.12.1`. Verification used `corepack npm@11.12.1` or repository-local binaries. No global installation changed. The repository-pinned Playwright 1.62.1 browsers were already installed; no browser version was downloaded or drifted.

## Scenario matrix

| Scenarios | Exact browser evidence |
| --- | --- |
| 1 | A new owner signs in through local GoTrue, creates an organization, enters organization-local tryout dates, completes every setup step, and publishes; browser and PostgreSQL assertions prove their exact Edmonton-to-UTC instants. |
| 2–3 | A public guardian registers from a deterministic reserved TEST-NET address, receives/uses the real confirmation token, the administrator sees the athlete, and check-in double-clicking assigns exactly one number. |
| 4 | Three independent evaluator browser contexts save private notes and scores; no peer note leaks; the director sees the aggregate and PostgreSQL proves exact `84.0000`. |
| 5 | The evaluator saves while offline, IndexedDB survives reload and a deliberately lost first response, the real online event drains the outbox, exactly one successful mutation reaches the server, and exactly one evaluation exists. |
| 6–7 | Other-tenant owner, check-in staff, evaluator, reviewer, member, and anonymous users are denied direct organization/tryout URLs without an existence oracle. |
| 8–9 | A director creates two draft teams through the real UI, moves an athlete, changes decisions without sending, finalizes, proves a post-finalization mutation leaves the row digest and audit count unchanged, then revises with an audit reason and creates one separate durable message batch/status. |
| 10–11 | The explicit demo/mock integration connects, previews a finalized roster, loses a response after the real app commit, replays the identical confirmation intent before reload, proves the same job/idempotency/preview identity and one mapping set, records a 1/1 partial result, retries only the failed item to 2/2, and never duplicates. |
| 12 | The exact server-test-only fake checkout/portal contract returns Stripe-owned test URLs. A signed raw `Buffer` reaches the real webhook route, active/replay/cancel events cross the real DB boundary, checkout intent truth is expired/redacted, account/provider IDs and two events are exact, and the downloaded roster CSV is sanitized. |
| 13 | Evaluator at 375 px, roster at 320 px, and marketing/auth at 430 px prove keyboard/focus behavior, 44 px targets, no horizontal overflow, axe, computed reduced motion, icon 200/SVG, and hydration-clean rendering. |
| Supporting ranking/concurrency | Exact ranking tie/compare completion evidence and two already-mounted director tabs rejecting the stale second roster write. |

The responsive monitor has no broad error allowance: it fails every page error, unexpected console error, undeclared request failure, and mismatched RSC cancellation. Other lifecycle tests allow only their exact intentional offline/lost-response failures and exact Next server-action/RSC navigation cancellations, matched by count, method, required header, target URL, and browser cancellation code.

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
| Five-project exact matrix | Round-two final-source run 70/70, exactly 14 per project; retries/skips/flakes 0 (5.0 min). Fresh sanitized exact JSON evidence is committed. |
| Firefox/WebKit/Mobile Safari high-risk repeats | Round-two 27/27: offline, stale two-tab concurrency, and integration partial retry/replay, each repeated three times; retries 0 (2.3 min). Fresh sanitized exact JSON evidence is committed. |
| Clean migration replay | Migrations 001–089 plus deterministic seed passed. |
| Focused pgTAP 070+071 | 2 files / 8 assertions passed in the owning gate; both are also present in the full result. |
| Full pgTAP after unseeded reset | 71 files / 1,880 assertions passed (12 s). |
| Supervised integration, twice | 27 files / 203 tests both runs; 38.49 s and 38.36 s; zero current-round supervisor/database/process residue. |
| `corepack npm@11.12.1 run verify` | Formatting, ESLint, TypeScript, 71 unit files / 977 tests (107.98 s), and the Task 28 production artifact gate passed. |
| Standalone production build | All routes compiled, typed, collected, and optimized with an explicit HTTPS public origin. |
| Dependency/security/diff audit | `npm audit --audit-level=high`: 0 vulnerabilities; secret scan and `git diff --check`: clean. |
| Final state | Task 30 users/orgs/browser-owned rate counters 0; 39 unrelated unit-harness rate rows remain; integration DBs/roles/schemas/sessions 0; port 3112 listener and owned test processes 0. |

## Honest release gaps

No local result claims real Stripe checkout, live Resend delivery, or certification against a live team-management provider. Billing uses Stripe's maintained signing implementation and Stripe-owned fake URL contract; communications and integration use explicit fake/demo provider contracts while exercising the real application, authorization, idempotency, and database boundaries. Production credentials, provider sandbox certification, webhook reachability, and actual external delivery remain release gates.

The review evidence of record is `task-30-evidence/final-matrix.json` and `task-30-evidence/repeat-gate.json`, not the mutable HTML report. Clean runs leave no failure-only screenshot/video artifact, and a no-retry matrix correctly leaves no first-retry trace; configuration still retains a trace on the first retry when a non-final diagnostic run permits retries.
