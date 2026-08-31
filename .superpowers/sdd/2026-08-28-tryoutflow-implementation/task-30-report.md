# Task 30 cross-browser critical-flow report

## Scope and configuration

The Task 30 suite contains 14 independently seeded tests mapping the specification's 13 scenarios. Every seeded case records the exact role, organization slug, tryout name/ID, and relevant roster/provider in the Playwright annotation. Fixtures create real local GoTrue users and PostgREST/Postgres records, use per-project/title deterministic identities, and remove auth/database state after each test.

Projects: Chromium, Firefox, WebKit, Mobile Chrome (Pixel 7), and Mobile Safari (iPhone 15), with en-CA/en-US/en-GB/fr-CA locales and Edmonton/Toronto/UTC/Vancouver/Halifax timezones. Trace is retained on first retry; screenshot and video are retained only on failure. The suite uses a production build/server on deterministic port 3112.

Host npm is 11.6.2, while `packageManager` pins npm 11.12.1. Commands used `corepack npm` or repository binaries; no global installation was changed. Playwright 1.62.1 and its repository-pinned browsers were already present.

## Scenario matrix

| Spec scenarios | Evidence |
| --- | --- |
| 1 | Owner onboarding, organization creation, local-time tryout dates, full setup wizard, publication |
| 2–3 | Public guardian registration, confirmation visible to admin, double-click check-in assigns exactly one number |
| 4 | Three isolated evaluator sessions; UI aggregate plus exact DB `84.0000`; peer notes absent |
| 5 | Mutation-boundary offline failure, IndexedDB draft after reload, real reconnect, one server mutation |
| 6–7 | Other-tenant and anonymous/member/check-in/evaluator/reviewer direct-URL denials without existence oracle |
| 8–9 | Draft move, decisions with no send, immutable finalize, audited revision, exact recipient preview, one durable message batch/status |
| 10–11 | Explicit demo/mock connection, exact preview, response loss after commit, one durable job, 1/1 partial result, retry to 2/2, replay/mapping idempotency |
| 12 | Official fake billing-provider contract to Stripe-owned URL, signed Stripe test webhook and replay, DB-derived active/canceled states, portal URL, sanitized roster CSV download |
| 13 | 375/390/430px evaluator/roster/marketing/auth flows, keyboard and focus, 44px targets, no overflow, axe, reduced motion |
| Supporting concurrency | Exact ranking tie/compare completion evidence and two-tab stale roster rejection |

## RED evidence and fixes

Genuine product REDs:

- `datetime-local` values were interpreted in the server timezone. Local date-time parsing now honors the organization IANA zone with DST-safe validation.
- Wizard session save referenced an ambiguous division identifier. Additive migration 088 and pgTAP 070 repair and prove the RPC.
- Active scoped staff could not read their organization shell. Capability regression added.
- Evaluation and billing same-origin checks compared the internal Next URL instead of the trusted external host/protocol. Owning boundary regressions added.
- Ranking timestamps hydrated differently by browser locale, and compare/back links resolved to the wrong relative routes.
- Demo-provider connection state could not cross Next route bundles, and fixed fixture athlete IDs made isolated cases all reviewable. The mock contract now reconstructs only its exact deterministic scoped connection and has an explicit local dynamic partial fixture.
- PostgREST timestamptz offsets were rejected by subscription schemas.
- Next route modules exported non-route test helpers and failed the production build. Handlers now live in owning boundary modules.
- Reduced-motion CSS retained 0.01ms motion, auth targets were below 44px, and controlled roster dialogs did not return focus. All three were corrected.

Fixture/environment REDs were separately corrected: Supabase schema parsing, registration source column and form selection, auth landing, immutable-audit cleanup triggers, rubric weights, score formatting, exact status-node spacing, offline response-loss timing, expected denied-route console noise, finalized-roster selection, provider mapping table name, raw signed webhook bytes, and production-build public/request-origin separation for the local fake boundary.

## Evidence and release gaps

Focused Chromium flows passed individually for scenarios 1–5, 6–7, rankings/compare, stale two-tab concurrency, 8–9 through durable queueing, and 10–11 through retry/replay. Owning tests passed for capabilities (10), evaluation boundary (9), rankings (2), subscription timestamp/request boundary, demo-provider contract, and pgTAP 070 (3).

Real Stripe checkout, live Resend delivery, and a live team-management provider are not claimed. Local evidence uses the maintained Stripe signing/URL contract or explicit demo/fake provider while preserving the real application, authorization, idempotency, and database boundaries. Production delivery credentials and live-provider certification remain external release gates.

Failure artifacts are under `output/playwright/test-results`; HTML output is under `playwright-report`. The suite treats hydration/page errors and non-navigation request failures as failures; only browser-cancelled Next RSC prefetches with `net::ERR_ABORTED` are classified as expected navigation cancellation.
