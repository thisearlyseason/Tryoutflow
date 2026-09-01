# Release checklist

This checklist separates repository-verifiable software readiness from production evidence owned by operators, legal reviewers, and providers. The only canonical automated command is:

```sh
bash scripts/verify-production-readiness.sh
```

The command is local-only: it validates the Docker/Supabase database identity before destructive resets, runs noninteractively under a kernel lock, and never deploys or calls live providers. It finishes with an unseeded local database and zero transient release fixtures; after any failure once database work begins, an exit trap performs the same unseeded reset and residue proof while preserving the owning failure code.

## Hardened-interface ruling

The Task 33 plan's literal `npm`/`npx` sequence predates hardened repository interfaces. This gate therefore uses Corepack-pinned npm 11.12.1, the repository-pinned Supabase CLI 2.116.0, an unseeded reset for full pgTAP, a seeded reset followed by two Task 20 supervised integration passes, the Task 28 production marketing artifact/origin gate, and the canonical zero-retry five-project Playwright command. These later interfaces control whenever they conflict with the earlier snippet.

## Automated gate stages

The script preserves the starting Git status, `package-lock.json`, and generated database-type bytes across `npm ci`; regenerates database types twice; and fails if any tracked/untracked state changes during testing. Stage output names the boundary and exit code without printing environment values. High-confidence tracked-secret patterns and unexpected tracked credential files fail the gate with filenames only.

| Evidence                 | Exact command in the release gate                                                                                                                  |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Toolchain and install    | `node --version`; `corepack npm@11.12.1 --version`; `corepack npm@11.12.1 ci`; local Supabase must be exactly 2.116.0                              |
| Static quality           | `corepack npm@11.12.1 run format:check`; `run lint`; `run typecheck`                                                                               |
| Database                 | unseeded `supabase db reset --local --no-seed`; `run test:db`; two `run db:types` byte comparisons                                                 |
| Application tests        | seeded `supabase db reset --local`; `run test:unit`; two `run test:integration`; `run test:contract`                                               |
| Production artifacts     | explicit-HTTPS-origin `run build`; `run test:marketing:production`                                                                                 |
| Browser                  | `corepack npm@11.12.1 run test:e2e -- --retries=0` across Chromium, Firefox, WebKit, Mobile Chrome, and Mobile Safari                              |
| Security/reproducibility | `npm audit --audit-level=high`; tracked-secret scan; `git diff --check`; exact Git-state comparison                                                |
| Cleanup                  | final unseeded reset; zero integration databases/roles/schemas/triggers/sessions, auth users, organizations, rate counters, and port 3112 listener |

## Specification coverage

Each row maps the implementation plan's specification coverage area to release evidence. “Full gate” means the command above plus the named focused evidence already included by that command.

| ID  | Specification area                                                                   | Automated command/evidence or limitation                                                                                                                |
| --- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S01 | Purpose, principles, scope, and exclusions                                           | Full gate; marketing/product unit and browser assertions; source/diff review.                                                                           |
| S02 | Modular architecture and domain boundaries                                           | Typecheck, lint, unit/contract suites, and production build.                                                                                            |
| S03 | Authentication                                                                       | Unit, supervised integration, pgTAP authorization tests, and critical browser lifecycle.                                                                |
| S04 | Roles, scoped authorization, support elevation, and RLS                              | Full pgTAP; integration authorization; role-denial and platform-administration browser specs.                                                           |
| S05 | Organizations, invitations, onboarding, and settings                                 | Organization unit/integration coverage and critical lifecycle browser scenarios.                                                                        |
| S06 | Database conventions, audit foundation, and tenant integrity                         | Empty-state migration replay, full pgTAP, generated types, integration, and concurrency browser coverage.                                               |
| S07 | Tryout wizard, configuration, publication, URL, and QR                               | Tryout tests and critical lifecycle browser scenario.                                                                                                   |
| S08 | Athletes, registration, duplicates, CSV, directory, and check-in                     | Unit/integration suites plus lifecycle, accessibility, and error-state browser specs.                                                                   |
| S09 | Evaluator staffing, blind projections, evaluations, notes, tags, and flags           | Staffing/evaluation unit and integration suites plus critical browser flows.                                                                            |
| S10 | Weak-connection outbox and idempotent synchronization                                | Evaluation outbox/synchronizer units, integration, and offline browser scenario.                                                                        |
| S11 | Deterministic scoring, ties, rankings, dashboard, and comparison                     | Scoring/ranking units, database/integration checks, and exact aggregate/tie browser scenario.                                                           |
| S12 | Teams, decisions, roster versions, finalization, revision, and concurrency           | Roster units, pgTAP/integration, and stale two-tab/finalization browser coverage.                                                                       |
| S13 | Email templates, batches, delivery state, preferences, and durable jobs              | Communication units, integration, contract suite, and decision/message browser assertions.                                                              |
| S14 | Stripe accounts, webhooks, entitlements, checkout, and portal                        | Subscription units/integration/contracts and fake-provider browser lifecycle; live provider remains manual.                                             |
| S15 | Team-management provider contract, mock, mappings, jobs, and retries                 | Provider contract suite, integration, and idempotent partial-failure browser scenarios; live provider remains manual.                                   |
| S16 | Route map, marketing, pricing, demo, privacy, and terms                              | Production marketing artifact gate plus five-project browser coverage. Legal effect remains manual.                                                     |
| S17 | Design system, responsive behavior, accessibility, and motion                        | Unit checks and strict accessibility/viewports/error-state browser specs.                                                                               |
| S18 | Reports, CSV exports, onboarding progress, and demo edge cases                       | Unit/integration suites and critical reporting/onboarding browser flows.                                                                                |
| S19 | Error taxonomy, structured logs, analytics, health, audit UI, and operations         | Observability/privacy unit/integration/contracts and platform browser coverage. Live monitoring remains manual.                                         |
| S20 | Security, privacy, performance, and concurrency                                      | Full pgTAP, denial/concurrency browser coverage, dependency/secret/diff audits; legal and hosted performance evidence remain manual where listed below. |
| S21 | Unit, integration, database, contract, browser, deployment, and production readiness | Every automated stage above; hosted deployment evidence remains explicitly incomplete below.                                                            |

## Acceptance criteria coverage

| ID   | Approved acceptance criterion                                                                 | Automated evidence or honest boundary                                                                  |
| ---- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| AC01 | Owner account, organization, and onboarding                                                   | Critical lifecycle browser scenario plus organization integration tests.                               |
| AC02 | Director configures and explicitly publishes a complete tryout                                | Critical lifecycle browser scenario; tryout unit/integration/pgTAP.                                    |
| AC03 | Guardian registration without athlete account; no automatic duplicate merge                   | Public lifecycle browser scenario and registration tests.                                              |
| AC04 | Concurrent check-in/number assignment without rankings access                                 | Database/integration concurrency plus lifecycle and role-denial browser scenarios.                     |
| AC05 | Independent evaluators without peer-score influence                                           | Authorization pgTAP/integration and three-evaluator browser scenario.                                  |
| AC06 | Weak-network drafts synchronize once without overwriting newer data                           | Outbox/synchronizer tests and offline/replay browser scenarios.                                        |
| AC07 | Exact weighted results, no missing-as-zero, genuine ties                                      | Deterministic scoring units/integration and exact aggregate/tie browser scenario.                      |
| AC08 | Completion context, comparison, teams, decisions, immutable final roster                      | Ranking/roster suites and lifecycle browser scenario.                                                  |
| AC09 | Audited finalization and history-preserving revision                                          | Roster pgTAP/integration and browser audit evidence.                                                   |
| AC10 | Communication delivery separate from decisions with failure/retry                             | Communication unit/integration/contracts and browser scenario.                                         |
| AC11 | CSV import/export validation and row issues                                                   | Registration/report unit/integration and browser download flow.                                        |
| AC12 | Stripe test subscriptions use verified idempotent webhook state                               | Subscription unit/integration/contracts and fake-provider browser scenario; live Stripe is manual.     |
| AC13 | Mock roster export is idempotent, mapped, partial-failure aware, and retry-safe               | Integration contract and browser replay scenarios; live The Squad is manual.                           |
| AC14 | RLS/server authorization denies cross-tenant and role escalation                              | Full pgTAP, supervised integration, and role-denial browser specs.                                     |
| AC15 | Critical workflows span 375 px to large desktop without evaluator overflow                    | Viewport/browser matrix across all five projects.                                                      |
| AC16 | No severe accessibility, console/network, build, required-test, or known cross-tenant failure | Axe and strict monitors in the five-project zero-retry gate; production builds; full automated suites. |
| AC17 | Purposeful loading, empty, error, denied, offline, and recovery states                        | Component units plus accessibility and error-state browser specs.                                      |

## Outstanding production prerequisites

These remain incomplete until a named owner attaches dated external evidence. A local green gate must never change these boxes.

- [ ] legal/privacy approval for minor-athlete data, notices, terms, retention, correction, deletion, export, residency, and breach procedures
- [ ] production domains, DNS, and TLS for Vercel and Supabase, with environment separation and rotation ownership
- [ ] Stripe live credentials, delivery, and certification for products/prices, signed webhook reachability, tax/legal review, cancellation, and portal behavior
- [ ] Resend credentials, domain delivery, and certification for SPF/DKIM/DMARC, signed callbacks, bounce/suppression behavior, and support ownership
- [ ] The Squad credentials, delivery, and certification against a documented authenticated API; keep the mock disabled until then
- [ ] hosted backup and restore drill on a paid non-pausing Supabase production plan, with recovery evidence and approved region
- [ ] production monitoring and alert ownership for database, jobs, webhooks, communication, synchronization, analytics, and incident escalation
- [ ] deployed authenticated smoke test after migrations and deployment, covering sign-in, organization audit, platform health/list access, scheduler, and privacy-safe logs

Also obtain production migration approval, Vercel environment/cron configuration, secret-owner sign-off, and evidence that preview environments use only synthetic data. See `environment.md`, `deployment.md`, `privacy-and-retention.md`, and `incidents.md` for the operator procedures.
