# Complete branded flow — Task 8 release evidence

Date: 2026-09-02 (America/Edmonton)

## Scope and immutable identities

- Exact Task 8 base: `2ba38dcf858328ca14416252436c1698aad3c143`.
- Task 8 owning fix commit: `f06bd02944eda8543fc0cf3e3891f165b4cb153b`.
- Reviewed implementation lineage for the complete design: `059fa76..f06bd02944eda8543fc0cf3e3891f165b4cb153b`.
- Task 8 changed browser fixtures, strict-monitor declarations, visual navigation assertions, and intentional visual baselines only. It did not change production source, migrations, generated types, or dependencies.
- Generated database types SHA-256: `7e2ed5fbaa222ccee678e90eb5f48e0bda85ee28d61d833368d7f784c2808572`.
- Migration 099 SHA-256: `39560425468294037d508328d5d63e16bf36d7de1118242b9a15841fdf8e2fff`.
- Migration 100 SHA-256: `c0a1316566ab1b863bb9881d98553f7a1b929032f75f5b1f0eeb1f51b584b42e`.
- Initial/replacement logo fixture SHA-256: `b5b4ed9c638b69a16c0e94cb52c6dca4039743b603fee3e3701928ac1e917bb7` / `cd336d6b3a5cb236103ea7ff2370c6e7d910b91a6579b9c9dbd4f232df9e8a0d`.

## Default-port ownership

The pre-existing listener on `127.0.0.1:3112` was revalidated immediately before termination as PID `54263`, command `next-server (v16.3.3)`, with cwd `/Users/tylerans/Documents/ChatGPT/TryoutFlow` (the main worktree). It still exactly matched the ledger ruling. A `TERM` stopped it within the bounded checks; `KILL` was not needed. No unrelated process was signalled, and Task 8 did not restart localhost. Every final browser gate used canonical port 3112. Final residue checks proved the port closed.

## RED evidence and owning corrections

| RED gate | Count | Root cause | Owning correction |
| --- | ---: | --- | --- |
| First canonical visual gate | 7 failed, 3 passed | Tasks 1–6 intentionally changed branded shells, journey actions, and layout; five screenshots plus two link selectors still described the prior UI. | Re-recorded 18 reviewed baselines and navigated via the current `Open tryout` action and `Tryout journey` heading. |
| First canonical functional-browser attempt | 1 failure before bounded interruption | Legacy owner onboarding left newly required timezone empty. | Filled `America/Edmonton` in both legacy onboarding fixtures. |
| Focused critical lifecycle | 1 pass, 1 fail; then 1 fail | The legacy wizard omitted the newly required session-to-division and rubric-to-session associations. | Selected the created `U15` division and `Skills session`. |
| Later canonical functional-browser attempt | 1 failure before bounded interruption | A populated journey now truthfully renders `Manage participants`, while the legacy assertion expected the empty-state `Add participant` anchor. | Asserted the populated-state action and exact registration workspace URL. |
| Firefox branded journey | 1 failure | The test reconstructed `updated_at` with a forced trailing fractional zero, so it could not match the exact rendered versioned logo URL. | Bound the strict cancellation expectation to the exact application-rendered logo `src`. |
| Later Firefox branded journey | 1 failure | Firefox optionally superseded one generated favicon request during rapid settings navigation. | Added one Firefox-only, exact-URL, `NS_BINDING_ABORTED` optional allowance; no global suppression. |
| Chromium response-loss scenario | 1 failure | This Chromium build reported the deliberately lost post-commit response as `net::ERR_ABORTED`; the exact browser-variant allowlist only named `net::ERR_FAILED`. | Added `net::ERR_ABORTED` to the two tests using the same intentional response-loss boundary. |

Explicit interruptions produced secondary `supabase status`, `psql`, or interrupted-test errors after the owning failure was already captured. They are interruption artifacts, not independent product failures. Every interruption was followed by an unseeded reset and zero-residue proof.

## GREEN automated evidence

The repository production-readiness controller was used for the canonical stages. After each RED correction, the owning gate was rerun; the final affected-gate reruns below are all against the bytes in `f06bd02944eda8543fc0cf3e3891f165b4cb153b`.

| Boundary | Final evidence |
| --- | --- |
| Toolchain/install | Node `v24.12.0`, npm `11.12.1`, Supabase CLI `2.116.0`; `npm ci` installed 641 packages; npm audit found 0 vulnerabilities. |
| Static quality | `format:check`, full `lint`, and full `typecheck` all exited 0 after the fix commit. |
| Clean database | Unseeded reset replayed migrations 001–100. Full pgTAP: 80 files, 2,166 tests, all successful. |
| Generated types | Two generations matched tracked bytes and each other; final hash is recorded above. |
| Unit | 111 files, 1,228 tests passed in the bounded full run. |
| Integration | Supervised pass 1 and pass 2 each passed 35 files / 221 tests; expected immutable-roster rejection messages were exercised. |
| Provider contracts | 4 files, 145 tests passed. |
| Production artifacts | Canonical Next.js 16.3.3 build and marketing production artifact gate each generated 36 static pages and exited 0. |
| Visual | Desktop Chromium canonical visual suite: 10/10 passed, zero retries. Representative desktop/mobile results and all 18 changed baselines were visually inspected as intentional. |
| Full browser | `corepack npm@11.12.1 run test:e2e -- --retries=0`: 170/170 passed in 11.5 minutes. Projects: Chromium, Firefox, WebKit, Mobile Chrome, Mobile Safari. |
| Focused Task 7 | `complete-branded-journey.spec.ts`: 5/5 passed in 1.3 minutes on the same five projects, zero retries. Firefox also passed twice consecutively during focused diagnosis; both response-loss scenarios passed twice consecutively in Chromium. |
| Security/diff | High-severity audit: 0 vulnerabilities. Tracked production-secret pattern scan and tracked credential/config-file scan: clean. `git diff --check`: clean. |
| Cleanup | Final unseeded reset succeeded. Release residue counts are zero, including integration databases/roles/schemas/sessions, auth/application fixtures, abuse/bot counters, and port 3112. |

Non-failing tool warnings were the repository's documented TypeScript 7 / `typescript-eslint` peer-range warning, the deprecated local Supabase `[inbucket]` notice, stopped optional local Supabase services, and test-asserted immutable-roster rejection messages.

## Honest production boundary

This local evidence does **not** prove deployed logo-byte delivery. Production readiness still requires dated owner evidence for:

- deployed anonymous and authenticated smoke tests after migration/deployment, including actual logo byte delivery, upload/replace/remove/fallback behavior, ETag/cache behavior, tenant isolation, and public branding;
- legal/privacy approval for minor-athlete data, notices, terms, retention, correction, deletion, export, residency, and breach procedures;
- production Vercel/Supabase domains, DNS, TLS, environment separation, migration approval, cron configuration, and secret rotation ownership;
- hosted Supabase Auth signup/confirmation, SMTP delivery/templates/rate limits, redirects, bounces, and support ownership;
- production Turnstile site/secret/hostname/action configuration and hosted success/failure evidence;
- live Stripe, Resend, and The Squad credentials plus webhook/delivery/API certification; the mock provider must remain disabled until The Squad is certified;
- paid Supabase backup/restore drill and approved region;
- production monitoring, alerts, incident escalation, durable analytics outbox/consumer/retention ownership, and privacy-safe log smoke evidence;
- production-like performance/load evidence for evaluator payload/latency, query plans/index use, approved volumes and concurrency, marketing JS/image/Web Vitals budgets, and score persistence while analytics is slow or unavailable;
- preview-environment synthetic-data proof and operator/secret-owner sign-off.

The controller/integrator must restore the final merged application on localhost only after integration. Task 8 intentionally leaves the main-worktree server stopped and does not merge this branch.
