# Task 32 privacy-safe operations and runbooks report

## Review closure — fix round 2

The remaining adversarial privacy-boundary finding against
`bdadd85710f7a8f2aa167b30053cec5d3c3bfb46` is closed.

- Log context and analytics input now cross one shared nonthrowing snapshot boundary. It accepts
  only non-array records, reads each allow-listed own field exactly once, normalizes only primitive
  safe values into a frozen null-prototype record, and never reads the original object again.
- Inherited fields, symbol metadata, extra analytics keys, arrays, functions, alternating proxies,
  mutating getters, and throwing getters/proxy traps all produce closed safe output or a closed
  invalid outcome. Getter and proxy exception messages are never logged, serialized, or returned.
- `AppError` instances carry module-private runtime authenticity. Their own code is snapshotted once
  and checked with an own-key closed enum before category derivation; prototype forgeries, wrapped
  proxies, throwing accessors, and `toString`/`constructor` values normalize to `unexpected_error`.
- Platform route handling derives denial and recovery exclusively from the normalized closed code,
  never from a mutable raw category, and reconstructs a safe error rather than rethrowing an
  untrusted object. Failures from a trusted logger/output boundary still propagate after safe record
  construction instead of being silently swallowed.

## Review closure — fix round 1

The four first-review findings against `709409f9579f880e9c974355fd5ef48431e2226b` are closed.

- Structured errors now accept only closed error codes. Category and recovery message are derived
  from that code, `toJSON` emits only closed code/category fields, and invalid constructor casts,
  object-shaped values, prototype forgeries, and accessor failures collapse to
  `unexpected_error`. Logging re-normalizes module-issued application errors before emission.
- Correlation/request IDs are opaque server-issued UUIDv4 objects backed by module-private runtime
  authenticity. Raw strings, copied objects, branded casts, email/phone/token/score/note/secret
  values, and extra metadata cannot cross log or analytics boundaries. Analytics event names and
  workflows are closed enums and the fake stores only a newly constructed serialized allow-list.
- Additive migration 091 locks the support relation, revokes malformed, expired, or future-created
  open legacy rows without rewriting/deleting their evidence, appends one immutable invalidation
  audit event per row using closed reason codes, validates the complete constraints, and makes the
  authorization helper recheck reason, creation, duration, expiry, revocation, actor, and platform
  authority. Exact five-minute and four-hour current rows remain active.
- The canonical `test:e2e` script, repository config, CI gate, and documented release command now
  all run with retries disabled. A behavioral unit fixture intentionally fails and proves the npm
  release command produces exactly one Playwright attempt even when its fixture config requests a
  retry.
- Organization audit wording is corrected to the authoritative owner/administrator capability and
  RLS contract. Director authorization was not broadened.

## Outcome

Task 32 is implemented from baseline `7f6963e8b8349fe392fccfe79e2643b35c88b30f`.
TryoutFlow now has a durable platform-administration boundary, privacy-safe structured errors and
analytics, coarse public health with authorized operational detail, organization and platform audit
views, transactionally bounded support elevation, and actionable operations runbooks.

The production surfaces are `/platform/organizations`, `/platform/subscriptions`,
`/platform/health`, `/platform/support`, `/platform/audit`, and the owner/administrator organization
audit page. Anonymous and non-platform callers receive non-oracular denials. Platform operational
failures reach a generic platform error boundary without exposing provider messages.

## Authorization and durable evidence

Migrations `202608310090_observability_and_platform_administration.sql` and
`202608310091_validate_support_elevation_history.sql` are additive and own the security-critical
platform boundary:

- `platform_administrators` is a durable, RLS-protected authority table with no direct client-table
  privileges. Every platform function checks current administrator state at execution time.
- Existing support-elevation rows are constrained for new writes to a mandatory 10–500 character
  reason and an expiry between five minutes and four hours. Beginning elevation is self-only and
  serialized, rechecks current platform authority and the target organization under lock, and
  writes the elevation and immutable audit evidence in one transaction. It never impersonates
  another user or silently grants a tenant role. Tenant membership and platform/support authority
  continue to be evaluated at execution time by their respective authorization helpers.
- Active support authorization now also requires that the actor remains an active platform
  administrator and that the preserved row has an exact safe reason, non-future creation, current
  expiry, and five-minute-to-four-hour creation-relative duration. Disabling the administrator
  immediately invalidates an otherwise unexpired elevation.
- Privileged functions use `SECURITY DEFINER` with an explicitly empty `search_path`. Direct grants
  are exact; internal authorization helpers are revoked from `public`, `anon`, `authenticated`,
  and `service_role`. Public health alone is executable anonymously and returns only a coarse
  status. Detailed health, platform listings, audit, subscriptions, and support require current
  platform authority.
- Audit history is append-only, immutable evidence. Organization audit reads require a current
  owner/administrator capability; platform audit requires current platform authority. Cross-tenant
  and unauthorized identifiers do not become existence oracles.

The generated Supabase types include the new durable table and RPC contracts. Application
gateways convert database failures to the closed `AppError` taxonomy and never retain a raw
provider error as a cause.

## Privacy-safe observability and analytics

`logError` and analytics events are constructed from explicit allowlists. Correlation IDs are
opaque, server-issued UUIDv4 values with runtime authenticity; operation names, workflows, event
names, and error codes are closed enums. Unsafe or forged errors become `unexpected_error`, and raw
exceptions or caller messages are never serialized. Untrusted containers are reduced once to
own-field, primitive-only, immutable null-prototype snapshots inside a nonthrowing boundary before
closed validation or transformation.

The boundary does not accept scores, notes, guardian/contact data, credentials, provider secrets,
tokens, raw payloads, or arbitrary tenant content. The analytics contract is server-only and
schema-validated, and its fake provider records deterministic immutable copies for tests. The
public health route returns only `status`, sets `Cache-Control: no-store` and `Vary: Cookie`, and
does not reveal dependency counts or tenant state. Authorized platform health exposes bounded
operational counts only.

## User-facing and operational coverage

Platform navigation and pages provide organization, subscription, health, support, and audit
workflows with responsive layouts, semantic controls, bounded support inputs, explicit success and
error states, and safe empty states. Organization owners/administrators can inspect their safe audit
history; ordinary members cannot. The shared Task 30 fixtures now provision a real durable
platform administrator and clean all associated rows.

The runbooks document:

- environment ownership, secret placement, and local versus hosted limitations;
- forward-only migrations, unseeded pgTAP reset, seeded integration reset, deployment verification,
  and rollback/forward-fix decisions;
- job diagnosis and recovery without duplicate execution;
- privacy review, data classification, retention decisions, deletion evidence, and analytics
  approval;
- incident severity, containment, evidence preservation, communication, recovery, and review;
- external release gates for hosted backups/restore drills, Vercel, Stripe, Resend, analytics, and
  privacy/retention approval.

## TDD and debugging evidence

The initial focused tests failed because the error taxonomy, redaction rules, analytics adapter,
health boundary, platform gateways, pages, support command, and runbooks did not exist. Each was
implemented behind the failing contract before the broader gate ran.

Focused REDs additionally proved that:

- unsafe application error codes originally reached structured logs; the logger now normalizes
  them to `unexpected_error`;
- revoking a platform administrator originally left an unexpired support elevation effective;
  the live helper now requires both current platform administration and bounded elevation;
- `CREATE OR REPLACE` restored default helper execution grants; two ACL assertions failed against
  the pre-reset catalog, and the migration now explicitly revokes every direct role;
- the first deployment runbook ordering seeded shared fixtures before pgTAP; the static runbook
  contract and final commands now use an unseeded reset for pgTAP and a separate seeded reset for
  supervised integration;
- raw Supabase errors originally crossed the platform gateway and every route error was converted
  to not-found; permission denials now remain non-oracular while operational failures are safely
  normalized and rendered by the generic platform error boundary;
- narrow support reasons could overflow; the rendered reason now wraps safely.

The first full browser run found a Firefox-specific checkout cancellation string. The expectation
was made exact per engine. The second run found two undeclared, cancellable preview Server Actions
during history navigation; both were declared with their exact URL and action header using Task
31's existing counted helper. No console, page-error, request-failure, Server Action, RSC, retry,
or browser-noise monitor was weakened. The final complete matrix passed without retries.

## Verification evidence

| Gate                                 | Result                                                                                                                                                                       |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Clean unseeded local reset           | All 91 additive migrations applied from scratch, including migrations 090–091.                                                                                               |
| Generated database types             | Regenerated successfully after the clean reset; formatting/post-processing passed.                                                                                           |
| Full pgTAP                           | 72 files / 1,936 assertions passed; Task 32 contributes 56 assertions.                                                                                                       |
| True 090→091 upgrade fixture         | 1/1 passed: 9/9 rows and original audit/core fields preserved, 7 invalid/expired/future rows revoked with 7 appended audits, exact 5m/4h rows active, constraints validated. |
| Seeded supervised integration, run 1 | 30 files / 212 tests passed.                                                                                                                                                 |
| Seeded supervised integration, run 2 | 30 files / 212 tests passed.                                                                                                                                                 |
| Round 2 adversarial privacy gate     | 2 files / 18 tests passed for one-read snapshots, accessors, proxies, inherited/symbol keys, mutation, non-records, and closed route errors.                                 |
| Final repository verification        | Prettier, ESLint, TypeScript, 78 unit files / 1,010 tests, and production marketing verification passed.                                                                     |
| Contract suite                       | 4 files / 145 tests passed, including the deterministic analytics fake and server-only import enforcement.                                                                   |
| Full browser release matrix          | 155/155 passed across Chromium, Firefox, WebKit, Mobile Chrome, and Mobile Safari with `--retries=0`.                                                                        |
| Final focused platform browser gate  | 6/6 passed on Chromium and Mobile Safari with `--retries=0`.                                                                                                                 |
| Review platform + Task 31 regression | 35/35 platform/error-state cases passed across all five projects through canonical `test:e2e`, retries 0.                                                                    |
| Round 2 platform browser gate        | 15/15 platform administration cases passed across all five projects through canonical `test:e2e`, retries 0.                                                                 |
| Standalone production build          | Compiled, typed, generated 33 static pages, and finalized all platform/API routes.                                                                                           |
| Dependency audit                     | `npm audit --audit-level=high`: 0 vulnerabilities.                                                                                                                           |
| Diff gates                           | `git diff --check` passed; baseline remained the requested commit before the Task 32 commit.                                                                                 |

The database's expected immutable-roster error messages appeared while integration tests asserted
rejected writes; all corresponding assertions passed. Supabase's inherited `[inbucket]`
deprecation and `NO_COLOR`/`FORCE_COLOR` messages are baseline local-tool warnings.

## Residue and scope audit

The final read-only audit found zero Task 30/32 browser users, organizations, platform
administrators, support elevations, integration fixture databases, runner roles, or harness
schemas. No Playwright, integration runner, worktree-owned Next server, or port 3112 listener
remained. Only Playwright's ignored `.last-run.json` remained; there was no failure media or retry
trace.

A production-source privacy scan found only the intentional platform-organizations copy explaining
that athlete, guardian, evaluation, and roster content is not loaded. No private field entered
observability, analytics, health, or platform operational payloads. No global package, browser,
database, Docker, or user configuration was changed.

## Remaining concerns and external release gates

No Task 32 product blocker remains. Hosted release still requires the operator-owned approvals and
evidence called out by the runbooks: paid Supabase backup/restore validation, production migration
approval, Vercel configuration, Stripe and Resend live credentials/webhooks, privacy and retention
sign-off, live analytics-provider approval, and any live team-provider enablement. Those external
decisions are intentionally not represented as completed by local tests.
