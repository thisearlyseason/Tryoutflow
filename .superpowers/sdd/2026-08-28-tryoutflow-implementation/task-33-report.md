# Task 33 report — production-readiness verification gate

## Status

DONE

Base: `204aafc4198c3879d3362de79128646c91b8a76c`

Commit message: `chore: add production readiness verification gate`

## Delivered

- One local-only, noninteractive, fail-fast release command: `bash scripts/verify-production-readiness.sh`.
- A 28-stage gate covering the repository-pinned Node/npm/Supabase identities, clean dependency installation, formatting, lint, types, an unseeded migration replay and full pgTAP suite, twice-reproducible generated database types, deterministic seeded unit/integration/contract suites, production builds, the Task 28 production marketing artifact/origin gate, strict zero-retry browser coverage in all five Playwright projects, dependency audit, tracked-secret boundaries, Git-state preservation, a final unseeded reset, and exact process/database/auth/fixture residue.
- A kernel-backed repository lock and local Supabase database identity proof before destructive database work. Concurrent release runs fail instead of sharing mutable state.
- An exit trap that preserves the owning failure code and, after database work begins, performs the canonical unseeded reset plus residue audit. It never prints environment values or secrets.
- `npm ci` evidence protection: the gate records and checks `package-lock.json`, generated database types, and the complete tracked/untracked Git status rather than silently accepting changed tools or destroyed evidence.
- A release-state helper that rejects a mismatched `SUPABASE_DB_URL` and proves zero integration databases, roles, schemas, sessions, triggers, auth users, organizations, registration counters, and listeners on port 3112.
- A coverage checklist mapping all 21 approved specification areas and all 17 acceptance criteria to exact automated evidence or an honest manual boundary.
- A concise README covering architecture, the pinned toolchain, local setup, the single release command, and the distinction between a green local gate and production approval.
- CI now invokes the canonical release command and installs Chromium, Firefox, and WebKit rather than maintaining a divergent partial gate.
- Deterministic test hardening for streamed Next Server Action completion, known browser navigation cancellation, subprocess test budgets, and exact support-elevation time boundaries.

No deployment, push, provider call, credential mutation, or production mutation was performed.

## Hardened-interface ruling

The Task 33 brief's literal `npm`/`npx` snippet predates later hardened repository interfaces. The implemented gate therefore preserves the later canonical behavior:

- Corepack-pinned npm 11.12.1 and repository-pinned Supabase CLI 2.116.0;
- Task 20 supervisor identity, isolation, kernel locking, and exact residue contracts;
- an unseeded reset for full pgTAP, a seeded reset for application suites, and two supervised integration passes;
- Task 28's explicit HTTPS public origin and production marketing artifact gate;
- the canonical five-project Playwright suite with retries forced to zero;
- deterministic test ordering/seeding and a final unseeded cleanup.

This ruling is also recorded in `docs/operations/release-checklist.md`.

## TDD evidence

The release-script/checklist contract began RED with seven missing-contract failures, then passed 7/7 after the initial implementation. A final source audit added an eighth regression proving that a failure after database work must invoke canonical cleanup; it failed before the exit trap existed and passed after the implementation.

The first exit-trap implementation exposed its own focused RED: declaring all trap locals in one command replaced the original `$?` with zero. Capturing `local original_status=$?` before the remaining declarations preserved the owning failure code. The focused production-readiness contract finished at 8/8 GREEN and is included in the 79-file/1,021-test unit gate.

## Release RED ledger and owning fixes

Every owning fix was followed by focused verification and a restart of the exact release command from stage 1.

1. A direct focused Prettier invocation on the shell script had no shell parser. The owning checks remained `bash -n`, the unit contract, and the repository's canonical format gate; no formatter exclusion or weakened check was added.
2. Mobile Chrome failed at 154/155 because the idempotent export replay Server Action could still be streaming when a later reload canceled it. The first `Response.finished()` experiment hung the streamed action and was removed. The final test awaits exact UI/database completion and network idle at action boundaries, while its monitor permits only the declared method, URL, `next-action` header, count, and known browser cancellation errors.
3. Mobile Chrome guardian/check-in failed at 154/155 for the same later-navigation cancellation class. The test now waits for the check-in search action to become network-idle before the consequential action.
4. WebKit critical lifecycle failed at 154/155 when confirmation assets were canceled by later navigation. The public confirmation handoff now reaches network-idle before advancing.
5. Full-unit stage 17 exposed two existing child-process assertions that inherited Vitest's five-second outer timeout while their subprocess contract already allowed 30 seconds. Only those two outer test budgets were aligned to 30 seconds; assertions and subprocess limits were unchanged. The focused combined set passed, then the full 79-file suite passed repeatedly.
6. Mobile Chrome ranking navigation required a generated RSC request but could legitimately complete or cancel depending on prefetch timing. The monitor now requires exactly one generated RSC request for the exact application URL/header and permits only the known Chromium abort if cancellation occurs; missing, duplicate, mismatched, and unrelated requests still fail.
7. The confirmation run reproduced an export-page `POST .../export net::ERR_ABORTED` after the durable job had reached `2 completed · 0 failed`. Stress diagnosis showed the initial preview action rendered its state while its streamed response could remain open until a later reload. A first attempt to declare that action cancellable correctly failed because the next deliberately lost action shares the same URL. The owning fix instead waits for the exact successful preview response and network-idle before advancing. The exact Mobile Chrome replay scenario then passed 10/10 with zero retries.
8. The fresh confirmation run failed pgTAP assertion 50 in file 072: the exact five-minute fixture used volatile `clock_timestamp()` twice in one update, and PostgreSQL does not define expression evaluation order. That could create a duration a few microseconds short; the exact four-hour fixture had the symmetric risk. Both fixtures now use one statement-stable `statement_timestamp()`. The owning pgTAP file passed 20/20 repeats before the full gate restarted.

The release failure trap was exercised by the browser, unit, and pgTAP REDs. Each exercise completed the canonical unseeded reset and reported zero release residue with port 3112 closed.

## Final automated evidence

The exact release command passed twice consecutively from stage 1 on the final code:

```text
bash scripts/verify-production-readiness.sh                  PASS #1 (28/28 stages)
  pgTAP                                                     72 files / 1,936 tests
  unit                                                      79 files / 1,021 tests
  supervised integration pass 1                            30 files / 212 tests
  supervised integration pass 2                            30 files / 212 tests
  provider contracts                                        4 files / 145 tests
  Playwright: 5 projects, retries=0                        155/155 (9.5 minutes)
  build, marketing artifact, audit, secret, diff, types    PASS
  final unseeded reset and exact residue                    PASS (all zero; port closed)

bash scripts/verify-production-readiness.sh                  PASS #2 (28/28 stages)
  pgTAP                                                     72 files / 1,936 tests
  unit                                                      79 files / 1,021 tests
  supervised integration pass 1                            30 files / 212 tests
  supervised integration pass 2                            30 files / 212 tests
  provider contracts                                        4 files / 145 tests
  Playwright: 5 projects, retries=0                        155/155 (9.6 minutes)
  build, marketing artifact, audit, secret, diff, types    PASS
  final unseeded reset and exact residue                    PASS (all zero; port closed)
```

The exact boundary-focused pgTAP file also passed 20/20 consecutive runs, and the exact Mobile Chrome replay scenario passed 10/10 consecutive zero-retry runs before the two final complete gates.

## Outstanding manual prerequisites

These remain incomplete; no local automated result is evidence for them:

- legal/privacy approval;
- production domains, DNS, and TLS;
- Stripe live credentials, delivery, and certification;
- Resend credentials, domain delivery, and certification;
- The Squad credentials, delivery, and certification;
- a hosted backup/restore drill;
- production monitoring and alert ownership;
- a deployed authenticated smoke test.

The checklist also calls out production migration approval, Vercel environment/cron configuration, secret-owner sign-off, and synthetic-only preview-data evidence as operator requirements.
