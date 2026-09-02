# Complete branded flow — final whole-branch fix evidence

Date: 2026-09-02 (America/Edmonton)

## Scope and immutable identities

- Exact authorized base: `387a3646cb6c11e0963ca14e1dc50dd58cad5ecf`.
- Migration 099 was not edited; SHA-256 remains `39560425468294037d508328d5d63e16bf36d7de1118242b9a15841fdf8e2fff`.
- Migration 100 was not edited; SHA-256 remains `c0a1316566ab1b863bb9881d98553f7a1b929032f75f5b1f0eeb1f51b584b42e`.
- Additive migration 101 SHA-256: `2fd87048310b88918cce055be32e6d5b03af426f814bded76b08b48a3e45d372`.
- Reproducible generated database types SHA-256: `8d8db9a897f0e639d1d23b33943d8003ff4e5b7ad15e8ab37a7eda83d74c701d` on the tracked bytes and both fresh generations.

## Six findings closed

1. Authenticated clients no longer have `EXECUTE` on the legacy raw-logo upsert. Additive migration 101 exposes `upsert_organization_logo_service(uuid,uuid,text,text)` only to `service_role`; the command independently verifies and locks the live owner/administrator actor, bounds and validates base64/WebP/digest data, writes the exact actor to immutable audit evidence, and retains zero direct table grants. The application obtains the actor from its authenticated authorization context, normalizes with Sharp, and sends only normalized bytes through the server-only service client. Authenticated removal remains on its separately guarded authenticated RPC.
2. Run completes only when strict live-dashboard evidence has `expectedEvaluations > 0` and `completedEvaluations >= expectedEvaluations`. Partial coverage stays in progress, shows exact completed/expected counts, and remains the recommended actionable stage.
3. Decide and Complete share one exact bounded projection of every configured tryout division and every bounded roster revision, derive the latest revision per division without `limit(1)` or response-order trust, reject malformed/tied/foreign evidence, and require all divisions to be finalized. Communication reads all latest finalized roster IDs in one exact bounded query and completes only when every roster has evidence and every matching message is delivered. Missing, queued, failed, bounced, and mixed evidence remain actionable; reports/audit actions and capability isolation remain intact.
4. The authored evaluator workflow now executes immediately after check-in/live evidence and before rankings, decision, roster, messaging, or reports. Rankings assert the authored participant, the maximum-rubric-derived `100.0` score, and `1 of 1 evaluations complete` before roster construction.
5. `OrganizationMark` is decorative by default: adjacent desktop/mobile/public uses render empty image alt text plus `aria-hidden`, and fallback marks are hidden without a role or implementation-detail accessible name. The standalone settings preview opts into the explicit accessible API and retains the stable organization-logo name for both image and TF fallback.
6. Settings no longer issues a second lossy metadata read or constructs an unversioned URL. It consumes only `requireCurrentOrganization`'s digest-validated, `updated_at`-versioned `logoUrl`; component state naturally clears an old failed URL when a replacement version arrives and returns to accessible fallback after removal.

## RED and focused GREEN evidence

| Boundary | RED evidence | Final focused evidence |
| --- | --- | --- |
| Logo normalization boundary | Logo unit: 3/18 failed because actor identity was absent. Brand pgTAP: 10/40 failed because the service command was absent and authenticated legacy execution/storage still succeeded. | Logo unit 18/18; focused pgTAP 117/117; real PostgreSQL logo integration 1/1, including normalized upload and stale administrator denial. |
| Journey completion | The initial expanded matrix failed 13/25 against one-completion and single-roster shortcuts; a later focused RED proved partial coverage still incorrectly recommended Decide. | Journey unit 26/26; PostgreSQL journey integration 1/1. Matrices cover strict expected counts, newer draft over older finalized state, two divisions with one incomplete, mixed delivery, missing per-roster evidence, and all-delivered completion. |
| Accessibility/versioned preview | 9/19 focused assertions failed against repeated adjacent accessible names, fallback implementation labels, boolean/unversioned preview props, and non-resetting preview expectations. | 19/19 focused organization navigation, public registration, settings preview, and authoritative metadata tests. |
| Branded browser acceptance | The prior source sequence opened rankings/rosters before authored evaluation. After reordering and adding ranking evidence, the first five-project run passed all desktops but RED on both mobile engines because the assertion selected the intentionally hidden desktop mark. | Focused mobile correction 2/2, then exact five-project matrix 5/5 in 1.3 minutes with `--retries=0`. |

## Full automated evidence

| Gate | Evidence |
| --- | --- |
| Static | `format:check`, full `lint`, and full `typecheck` exited 0. |
| Unit | 111 files / 1,234 tests passed. |
| Database | Clean unseeded migration replay through additive 101; full pgTAP 80 files / 2,179 tests passed. |
| Generated types | Two fresh `db:types` generations matched the tracked bytes and each other at the hash above. |
| Integration | After restoring the required deterministic seeded baseline, supervised pass 1 and pass 2 each passed 35 files / 221 tests. The first attempt immediately after pgTAP honestly failed two demo-seed assertions because the database was still intentionally unseeded; no production assertion was implicated. |
| Contracts | 4 files / 145 tests passed. |
| Production artifacts | Next.js 16.3.3 production build passed with the documented canonical-origin environment; marketing production artifact gate passed and generated 36 static pages. |
| Browser | `complete-branded-journey.spec.ts` passed Chromium, Firefox, WebKit, Mobile Chrome, and Mobile Safari: 5/5, zero retries. |
| Security/release | `npm audit --audit-level=high`: 0 vulnerabilities. Tracked production-secret patterns and tracked credential/config files: clean. `git diff --check`: clean. |
| Cleanup | Final clean unseeded reset succeeded. Release residue counts are zero, port 3112 is closed, and the isolated browser port 3217 has no listener. |

Expected non-failing output was limited to the repository's local Supabase `[inbucket]` deprecation/stopped-optional-service notices, `NO_COLOR`/`FORCE_COLOR` warnings from browser workers, and test-asserted immutable-roster rejection messages during deterministic seed replay.

## Honest boundary

This evidence is local. Deployed migration approval, hosted Supabase/Auth/SMTP behavior, production secret rotation and ownership, real provider/webhook certification, backup/restore evidence, production monitoring, legal/privacy approval, and post-deployment anonymous/authenticated logo smoke evidence remain the production owner's responsibilities recorded in the main release report.
