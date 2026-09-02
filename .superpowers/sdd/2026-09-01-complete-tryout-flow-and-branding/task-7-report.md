# Task 7 report: complete branded browser journey

## Commit

- Exact base: `f09c25ff09277a2fbf4c27801478b49a094818e5`
- Implementation commit: `3b3bb8e534022c533f5243cb53bd8e3c0661ca7b`
- Implementation range: `f09c25ff09277a2fbf4c27801478b49a094818e5..3b3bb8e534022c533f5243cb53bd8e3c0661ca7b`

## Acceptance coverage

- Added one production-build, zero-retry Playwright acceptance test to the canonical `testMatch` and all five configured projects.
- Uses a real 64×64 RGBA PNG (`b5b4ed9c638b69a16c0e94cb52c6dca4039743b603fee3e3701928ac1e917bb7`) through the production multipart Server Action and logo RPC/route boundary.
- Proves branded desktop and mobile staff chrome, a 320px branded public registration page, and no horizontal document overflow.
- Authors a new cycle-backed tryout through every setup screen, verifies the guided examples are non-submitting placeholders, reloads persisted basics, publishes, and verifies the exact cycle relationship plus zero optional groups/positions.
- Submits a real anonymous public participant and proves the participant appears in the authenticated staff registration workspace.
- Traverses the production journey through check-in, live operations, rankings/decision evidence, rosters, messages, and reports, then separately proves the evaluator workspace, scoring session, and assigned-participant view.
- Replaces and removes the logo, verifies three exact audit events across upload/replace/remove, verifies no remaining brand row, and proves desktop/mobile `TF` fallback.
- Uses the Task 30 strict console/request monitor in owner, public, and evaluator contexts. Server Actions, clicked RSC navigations, and Firefox's exact versioned responsive-logo requests are URL/header/count bound; there are no blanket or optional allowances.

## Exact cleanup

- Added a `brandedJourney` fixture whose `finally` path explicitly deletes the isolated organizations' brand rows before the canonical organization-scoped teardown.
- Deletes both test organizations, all eleven created auth identities and profiles, and every dependent organization row even after assertion failure.
- Tracks the authored public slug's exact registration transaction/request rate keys in addition to the seeded slug's keys.
- Teardown asserts `0|0|0|0` for brand rows, organizations, profiles, and auth users, and separately asserts zero exact tracked registration-rate keys after deletion.
- Post-matrix database evidence was `0|0|0` for Task 30 brand rows, organizations, and auth users. The shared registration counter table retained unrelated pre-existing rows, so only the task-owned hashes were deleted and asserted.

## RED findings and classification

1. **Product defect — Next 16 route tree collision.** The production build rejected `/api/organizations/[organizationSlug]/logo` beside existing `[organizationId]` routes because one dynamic path level used two parameter names. The route now uses `[organizationId]` while preserving the public slug URL and service RPC contract; route unit/integration imports were updated.
2. **Test-environment boundary gap — approved alternate origin.** Port 3112 was already owned by user-visible PID 54263. The default remains 3112; `TRYOUTFLOW_PLAYWRIGHT_PORT` accepts only a validated integer port, and `TASK30_LOCAL_REQUEST_ORIGIN` is accepted only as an exact HTTP loopback origin with explicit port and no credentials/path/query/hash. Unit RED/GREEN covers rejection of unsafe variants.
3. **Product defect — mobile settings overflow.** The native logo file input exceeded the 390px settings viewport. The upload wrapper, form, label, and input now have bounded/min-width-safe sizing.
4. **Product defect — completed Run stage lost check-in.** A completed Run stage duplicated live-dashboard guidance and omitted check-in. A unit RED now requires `Open check-in` and `Review sessions` as secondary actions while retaining live operations as primary.
5. **Product defect — stale staff branding after mutation.** Upload/removal refreshed the settings preview but not the enclosing staff navigation. Successful logo mutations now invalidate the organization layout with the documented Next 16 `revalidatePath(..., 'layout')` behavior.
6. **Product/browser integration defect — speculative RSC aborts.** Evaluator links, finalized-roster export, and the participant header's duplicate overview link prefetched routes the flow did not select. Those exact links now disable speculative prefetch. Clicked journey RSCs remain exact monitored production navigations.
7. **Strict-monitor fixture gap — cross-engine cancellation vocabulary.** Cancellable RSC monitoring now uses the canonical browser cancellation set (`ERR_ABORTED`, Firefox aborts, WebKit cancellation) while retaining exact method, generated-RSC normalization, headers, URL, and count. Firefox's two responsive logo requests are declared only for Firefox and only against the exact versioned image URL and image Accept header; all other projects retain zero image-request allowances.

No assertion was weakened, no route/RPC was bypassed, and no skip, retry, blanket console allowance, blanket request allowance, schema change, or business-rule relaxation was introduced.

## TDD evidence

### RED

- The first production Chromium start failed at the Next 16 dynamic-route collision before browser execution.
- After the route fix, alternate-origin sign-in failed the exact production browser-origin boundary until the loopback override was validated and covered by unit RED.
- Successive real-browser REDs exposed, in order: 390px settings overflow; missing Run-stage check-in; evaluator and roster/participant speculative RSC aborts; stale staff fallback after removal; cross-engine responsive-logo cancellation behavior; and missing exact teardown assertions.
- Every RED was closed at the owning product or fixture boundary. Failure screenshots/videos/error contexts were inspected during debugging and were cleared by the final successful run.

### GREEN

- Focused Chromium from the final implementation candidate:
  - `TRYOUTFLOW_PLAYWRIGHT_PORT=3217 corepack npm exec -- playwright test tests/e2e/complete-branded-journey.spec.ts --project=chromium --retries=0`
  - 1 passed in 16.8s.
- Exact five-project gate from the final tree after the cleanup invariant:
  - `TRYOUTFLOW_PLAYWRIGHT_PORT=3217 corepack npm exec -- playwright test tests/e2e/complete-branded-journey.spec.ts --project=chromium --project=firefox --project=webkit --project='Mobile Chrome' --project='Mobile Safari' --retries=0`
  - 5 passed in 1.1m; zero retries, zero skips.
- Full unit suite:
  - `corepack npm run test:unit`
  - 111 files passed, 1,228 tests passed.
- Focused real PostgreSQL logo integration:
  - `corepack npm exec -- vitest run --config vitest.integration.config.ts tests/integration/organizations/organization-logo.test.ts`
  - 1 file passed, 1 test passed.

## Verification

- `corepack npm run format:check`: passed.
- `corepack npm run lint`: passed with no diagnostics.
- `corepack npm run typecheck`: passed with no diagnostics, including immediately before the final five-project gate.
- `git diff --check`: passed before the implementation commit.
- Production `next build` passed on every Playwright invocation before the production server started.
- Final artifacts: `playwright-report/index.html`, `output/playwright/test-results/.last-run.json`, and the committed PNG fixture. No final failure-only screenshot, video, trace, or error-context artifact remains.
- Final listener evidence: nothing listened on 3217 after Playwright teardown; PID 54263 remained untouched and listening on 127.0.0.1:3112.

## Alternate-port ruling and Task 8 requirement

- The canonical default was not changed: without `TRYOUTFLOW_PLAYWRIGHT_PORT`, Playwright still owns 3112 and refuses reuse.
- The approved Task 7 run used only `http://127.0.0.1:3217`, passed through the same production build/start, real routes, real Server Actions/RPCs, strict monitor, local Supabase, and cleanup lifecycle.
- This is not a release-gate substitution. Task 8 must run the canonical release verification on default port 3112 after the user-visible PID 54263 server is intentionally stopped by its owner. Task 8 must not infer canonical-port proof from Task 7's alternate-origin evidence.

## Concerns

- Firefox issues two exact requests for the desktop/mobile responsive shell logo and may cancel one; Chromium can reuse the already-versioned representation without a new request. The test records only Firefox's observed exact versioned URL/count and otherwise leaves the monitor strict.
- The Supabase CLI repeatedly reports its existing deprecated `inbucket` configuration and stopped optional imgproxy/edge-runtime/pooler services. These warnings did not affect the local database, authentication, logo conversion, or browser outcomes.
- No subagent or reviewer was spawned, per the Task 7 controller constraint.
