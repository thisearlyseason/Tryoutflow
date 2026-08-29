# TryoutFlow Product and Architecture Design

**Status:** Approved design, pending written-spec review

**Date:** 2026-08-28

**Product:** TryoutFlow
**Positioning:** Better tryouts. Better decisions.

## 1. Purpose

TryoutFlow is a commercial, multi-tenant SaaS for running structured sports tryouts. It replaces spreadsheets, clipboards, paper scorecards, scattered forms, and opaque roster discussions with one operational workflow:

1. Create and publish a tryout.
2. Register athletes, usually through a guardian.
3. Check athletes in and assign tryout numbers.
4. Assign evaluators to defined scopes.
5. Capture independent evaluations, including under weak connectivity.
6. Aggregate and compare results transparently.
7. Build, review, and finalize rosters.
8. Notify participants.
9. Export data or explicitly send a finalized roster to a team-management provider.

The product informs coaching decisions. It does not automatically select athletes or pretend that roster construction is purely mathematical.

## 2. Product principles

- **Independent product:** TryoutFlow owns its repository, identity, database, billing, organizations, users, branding, analytics, and operations.
- **Tenant safety:** Organization data isolation is enforced in the application, PostgreSQL Row Level Security (RLS), and relational constraints.
- **Operational trust:** Saved, locally saved, syncing, failed, and completed states are technically accurate and visible.
- **Evaluator independence:** Evaluators do not see peer scores during live evaluation by default.
- **Human responsibility:** Rankings expose evidence and confidence context; directors make and confirm decisions.
- **Mobile-first evaluation:** The primary evaluator flow works one-handed beside a rink, court, field, track, or gym.
- **Privacy by design:** Minor-athlete information is collected sparingly, scoped by role, excluded from third-party analytics, and never exposed casually to platform staff.
- **Explicit side effects:** Publishing, finalizing, notifying, exporting, and synchronizing are separate confirmed operations.
- **MVP discipline:** Future sports-management, recruiting, AI, and social features do not enter the initial product.

## 3. MVP scope

### Included

- Public marketing, pricing, product walkthrough, privacy, and terms pages.
- Supabase authentication and invitation flows.
- Organization onboarding, membership, roles, permissions, and subscription entitlements.
- Tryout wizard, cycles/seasons, divisions, sessions, groups, positions, registration forms, rubrics, and publishing.
- Guardian-led public registration without athlete accounts.
- Manual registration, returning-athlete selection, CSV import, and duplicate review.
- Check-in, group/session placement, QR-assisted lookup, and automatic or manual number assignment.
- Evaluator invitations and scoped assignments.
- Blind evaluation, mobile scoring, notes, flags, local drafts, retry, and synchronization.
- Weighted scoring, completion context, rankings, filtering, and athlete comparison.
- Draft teams, roster builder, decisions, finalization, revisions, and audit history.
- Transactional email and delivery tracking.
- Basic reports and CSV exports.
- Stripe subscription foundation for TryoutFlow plans.
- Provider-neutral team-management integration contracts and a mock The Squad provider.
- Audit logs, privacy-safe product events, structured error reporting, and operational health indicators.
- Automated unit, integration, database, authorization, browser, accessibility, and responsive tests.

### Excluded

- Guardian registration fees, Stripe Connect, refunds, or payment reconciliation.
- A live The Squad connection without documented and authenticated API contracts.
- Full offline application behavior or a native mobile app.
- Athlete and guardian accounts or portals.
- Team scheduling, calendars, chat, league or tournament management, game scoring, fundraising, recruiting, social networking, video scouting, athlete-development tracking, and AI athlete selection.
- SSO, white labeling, custom domains, multiple languages, public APIs, and third-party webhooks.

## 4. Architecture

### 4.1 Recommended approach

Build a modular Next.js monolith deployed on Vercel, backed by Supabase PostgreSQL, Auth, and private object storage. Stripe, Resend, analytics, and team-management systems are reached only through narrow adapters.

This approach minimizes operational cost while preserving clear extraction points. Email, integration, and analytics workloads can move to a dedicated worker later without changing domain contracts.

### 4.2 Application layers

1. **Web layer**
   - Next.js App Router route groups, layouts, Server Components, and accessible client interactions.
   - No authorization decision relies on navigation or button visibility.
2. **Application layer**
   - Typed commands and queries.
   - Input parsing, authorization, idempotency, transaction boundaries, and result mapping.
3. **Domain layer**
   - Tryout lifecycle, assignment rules, rubric versioning, scoring, roster versioning, communication, entitlements, and synchronization.
   - Domain modules do not import framework request objects or provider SDKs.
4. **Infrastructure layer**
   - Supabase repositories, object storage, Stripe, Resend, database outbox, analytics, and integration-provider adapters.

### 4.3 Domain modules

- `identity`
- `organizations`
- `subscriptions`
- `tryouts`
- `registration`
- `athletes`
- `checkin`
- `staffing`
- `rubrics`
- `evaluations`
- `scoring`
- `rankings`
- `rosters`
- `communications`
- `reports`
- `integrations`
- `audit`
- `observability`

Each module exposes a small public API and owns its policies, commands, queries, validation, and tests. Shared code is limited to stable primitives such as identifiers, clocks, money, result types, pagination, and organization context.

### 4.4 Server and client responsibilities

- Server Components load authorized, tenant-scoped views.
- Server actions or route handlers invoke application commands; they do not contain business logic directly.
- Client components handle interaction-heavy experiences such as score controls, filters, comparison selection, roster dragging, and the offline outbox.
- PostgreSQL remains the source of truth. IndexedDB is temporary evaluator-side persistence, not a second authoritative database.
- Most operational dashboards use targeted refresh or polling. Realtime subscriptions are added only where they measurably improve live operations.

## 5. Authentication and authorization

### 5.1 Authentication

- Supabase Auth owns credentials and sessions.
- MVP supports email/password, account recovery, email verification, and invitation links.
- Social login is excluded initially.
- Athletes and guardians are organization-owned records and do not require authenticated accounts.
- Public registration confirmations use high-entropy, expiring, purpose-limited tokens rather than exposing athlete identifiers.

### 5.2 Role model

Organization membership grants broad organization authority. Resource assignments further scope directors, evaluators, check-in staff, and reviewers to a tryout, division, session, group, or athlete set.

| Role | Scope | Core authority | Explicit denial |
|---|---|---|---|
| Platform administrator | Platform metadata | Organizations, subscriptions, configuration, system health, support and audit tools | Casual athlete browsing; unaudited organization actions |
| Organization owner | Organization | Billing, ownership, members, all tryouts, reports, integrations, exports | Other organizations |
| Organization administrator | Organization | Members, athletes, tryouts, evaluators, reports, rosters, communication, permitted integrations | Owner-only billing and ownership transfer |
| Tryout director | Assigned tryouts | Setup, registration, sessions, staff, live progress, rankings, rosters, decisions | Unassigned tryouts and organization billing |
| Evaluator | Assigned tryout/session/group/athletes | Own drafts, evaluations, notes, and flags | Peer scores, rankings, rosters, unrelated athletes, administration |
| Check-in staff | Assigned tryout/session | Registration lookup, check-in, number and group assignment | Scores, notes, rankings, and roster decisions |
| Reviewer | Explicit grants | Approved final reports and finalized rosters | Mutations and live scores by default |
| Guardian/public | Published registration token | Submit allow-listed registration fields; view token-bound confirmation | Direct table access, athlete search, evaluation and roster data |

Users may hold an organization role and one or more tryout-scoped roles. Effective permission is the union of valid grants within the requested organization and resource; a grant never crosses tenants.

### 5.3 Authorization layers

Every protected operation applies all applicable layers:

1. Session and route boundary.
2. Current organization membership lookup.
3. Typed capability policy, including assignment scope.
4. Tenant-scoped repository query.
5. PostgreSQL RLS.
6. Composite tenant foreign keys and database constraints.
7. Audit event for sensitive mutations.

JWT metadata is not the source of truth for mutable roles. Commands check current membership and assignment records. Service-role credentials are limited to narrow server-only webhook, job, support, and administrative handlers.

Platform support elevation must be time-bound, reason-required, visible, and audited.

## 6. Domain and database relationship plan

### 6.1 Conventions

- UUID primary keys.
- `organization_id` on every tenant-bound table, including descendants.
- `created_at` and `updated_at` timestamps on mutable business records.
- Actor and finalization timestamps on meaningful state transitions.
- Composite unique keys such as `(organization_id, id)` support tenant-safe composite foreign keys.
- Controlled text values use check constraints or lookup tables when PostgreSQL enums would make future migrations risky.
- Soft deletion is used only where recovery or historical references require it. Immutable history is preserved through versions and audit records.
- Personally identifying fields are never copied into generic audit metadata.

### 6.2 Identity, tenancy, and billing

- `profiles`: one-to-one extension of `auth.users`; global display and preference data only.
- `organizations`: tenant root, slug, defaults, terminology, timezone, and status.
- `organization_members`: unique organization/user membership and organization role.
- `organization_invitations`: expiring role invitation with normalized email and lifecycle state.
- `tryout_staff_assignments`: scoped role grants for directors, evaluators, check-in staff, and reviewers.
- `subscription_accounts`: one organization entitlement account with Stripe mapping and verified state.
- `subscription_events`: deduplicated Stripe event history used for diagnosis and replay safety.

### 6.3 Tryout configuration

- `seasons`: lightweight organization cycles; no scheduling behavior.
- `tryouts`: lifecycle root with sport, timezone, registration window, blind mode, score visibility, terminology, and publish/finalization state.
- `tryout_divisions`: age, level, or organization-defined divisions.
- `tryout_positions`: sport preset or custom labels.
- `tryout_sessions`: dated operational sessions assigned to a division.
- `session_groups`: groups within a session.
- `registration_form_versions`: immutable published form schema versions.
- `rubrics`: named rubric identity.
- `rubric_versions`: immutable category and scoring configuration once used.
- `rubric_categories`: ordered category definitions with descriptions, weights, scale, guidance, and optional priority status.
- `session_rubrics`: assigns the exact rubric version used by a session or division context.

The product validates registration windows, session time ranges, and weighted-rubric totals before publishing. A rubric used by any evaluation is not edited in place; a revision creates a new version.

### 6.4 Athletes, guardians, and registration

- `athletes`: organization-owned person record with minimal identity and eligibility fields.
- `guardians`: organization-owned contact record.
- `athlete_guardians`: many-to-many relationship with relationship label, primary-contact flag, and communication permissions.
- `tryout_registrations`: athlete enrollment in one tryout, including division, source, status, form version, and versioned answers.
- `registration_duplicate_candidates`: reviewable similarity findings; never performs automatic merges.
- `session_enrollments`: registration placement in sessions and groups.
- `checkins`: idempotent session check-in event and status.
- `tryout_numbers`: number assignment with scope and active interval.

Registration-form answers use validated JSONB tied to an immutable form version. Frequently queried fields remain normalized columns. Duplicate detection produces candidate links using normalized name, birth date, guardian email, and existing organization athlete ID; an administrator decides whether records match.

An active-number partial unique index prevents duplicates within the configured tryout or division scope. Number assignment runs transactionally so concurrent check-in staff cannot claim the same number.

### 6.5 Evaluations

- `evaluator_assignments`: evaluator access and expected-work definition.
- `evaluations`: one evaluator's evaluation of one registration in one session using one rubric version.
- `evaluation_scores`: one score per evaluation and rubric category.
- `evaluation_notes`: evaluator-owned private text notes.
- `evaluation_note_tags`: normalized quick-tag links.
- `athlete_flags`: evaluator or director flags such as “needs another look.”
- `evaluation_mutations`: idempotency receipt for device submissions when required beyond request-level records.

The natural uniqueness rule for an evaluation is `(organization_id, tryout_registration_id, tryout_session_id, evaluator_user_id)`. An evaluation includes a monotonic `version`, draft/completed/locked/reopened state, completion timestamps, and the exact rubric version.

Completed evaluations may be locked by policy. A director can reopen one only through an authorized command that records the actor, reason, previous state, and audit event.

### 6.6 Rankings and rosters

- Aggregate rankings are computed from completed source evaluations, not treated as opaque manually editable scores.
- Materialized or cached aggregates may be introduced for performance but are always reproducible from source records.
- `tryout_teams`: named destination teams and optional roster/position targets.
- `roster_versions`: draft, finalized, superseded, or revised snapshots.
- `roster_assignments`: athlete-to-team placement within a roster version.
- `roster_decisions`: undecided, callback, selected, waitlisted, released, or withdrawn; independent from team placement.
- `decision_history`: actor-attributed decision transitions.

A roster athlete, team, and version must share the same organization and tryout. Finalization transactionally locks the version, records the actor and timestamp, and appends an audit event. Reopening creates a new draft revision based on the finalized snapshot; it never mutates history.

### 6.7 Communication, integration, and audit

- `communication_templates`: organization-editable content around protected system facts.
- `communication_batches`: confirmed bulk action and audience snapshot.
- `communication_messages`: recipient-specific rendered-content snapshot and provider state.
- `integration_connections`: encrypted provider connection metadata and state.
- `external_entity_mappings`: unique internal/provider/entity mapping.
- `sync_jobs`: top-level import or export attempt.
- `sync_items`: item-level status, mapping, normalized error, and retry information.
- `outbox_jobs`: durable scheduled side effects with lease, attempt count, and availability time.
- `webhook_events`: provider event deduplication and processing status.
- `audit_logs`: append-only high-value administrative and security events.
- `notification_preferences`: optional communication preferences, not suppression of required operational notices.

## 7. Tenant isolation and RLS

RLS is enabled on every exposed tenant table. Policies use current authenticated identity plus active membership and scoped assignments.

Required policy behavior includes:

- Owners and administrators access only their organization.
- Directors access only assigned tryouts.
- Evaluators access assigned sessions/athletes and only their own evaluation records.
- Check-in staff can update assigned check-in and number workflows but cannot select evaluation-score rows.
- Reviewers access only explicitly granted finalized data.
- Anonymous users cannot read private athlete tables or mutate evaluation data.
- Public registration writes through a controlled server path with allow-listed fields, validation, throttling, and transactional duplicate review.

Database tests cover both allowed and denied operations. Tests use direct IDs from another organization to prove insecure direct object references fail even when URLs or request payloads are manipulated.

## 8. Tryout and registration workflows

### 8.1 Tryout wizard

The wizard is resumable and stores a draft after each step:

1. Basics: name, sport, cycle, description, registration window, dates, timezone.
2. Divisions.
3. Positions, disciplines, roles, or custom evaluation groups.
4. Sessions, locations, capacity, divisions, and groups.
5. Rubric selection or customization.
6. Registration form.
7. Review and explicit publication confirmation.

Publishing validates the complete configuration, creates immutable form/rubric versions, records the actor, and creates an audit event. Published tryouts expose a public URL and QR code. Locking or finalization requires a separate confirmation.

### 8.2 Registration

Public registration presents only published, active tryout information and configured fields. It supports new athletes and server-assisted recognition of returning records without revealing search results publicly.

Successful submission:

1. Validates the published form version and registration window.
2. Creates or links reviewed organization-owned athlete and guardian records.
3. Creates the tryout registration and duplicate candidates transactionally.
4. Enqueues confirmation email.
5. Returns a token-bound confirmation page without exposing private identifiers.

CSV import uses preview, column mapping, row validation, duplicate candidates, and explicit confirmation. Invalid rows are downloadable and do not silently disappear. The MVP CSV flow imports organization athletes, not tryout registrations, so it does not accept or fabricate tryout position assignments; positions are persisted only by registration workflows that carry an exact tryout context.

### 8.3 Check-in

Check-in staff can search assigned tryouts by athlete, guardian, registration ID, phone when permitted, or tryout number. They can assign session/group placement and manual or sequential numbers. Repeated check-in submissions are idempotent. Conflicting number assignments return a recoverable message and next available option.

## 9. Evaluation model and scoring specification

### 9.1 Evaluation lifecycle

Valid states are draft, completed, locked, and reopened. Completion requires every required category to contain a valid score. Incomplete work is never converted into zero.

Evaluators see athlete number, assigned group, position/context, rubric guidance, own notes, and own save state. Blind mode hides full names where operationally practical. By default, peer scores and aggregate rankings remain private until a director explicitly unlocks visibility.

### 9.2 Supported scales

MVP supports inclusive integer scales 1–5 and 1–10. Architecture may later support custom bounds, but the initial UI and validation expose only these scales.

### 9.3 Normalization

For a category score `s` on a scale with maximum `m`:

```text
normalized_category_score = (s / m) × 100
```

Individual evaluator inputs are integers. Therefore 4/5 and 8/10 both represent 80. Derived category averages may be fractional; a displayed average of 4.2/5 represents 84. On an integer 1–5 scale, 1 represents 20 rather than zero.

### 9.4 Evaluator total

For categories `c` with normalized score `n_c` and weight percentage `w_c`:

```text
evaluator_total = Σ(n_c × (w_c / 100))
```

Weighted category percentages must sum exactly to 100 before rubric publication. PostgreSQL numeric arithmetic or an equivalently deterministic decimal representation avoids binary floating-point drift.

### 9.5 Athlete aggregate

Within the selected division/session/filter scope:

```text
athlete_aggregate = mean(valid completed evaluator totals)
```

Excluded values:

- Draft or incomplete evaluations.
- Assignments with no evaluation.
- Removed or invalidated evaluator assignments.
- Reopened evaluations that are not completed again.
- Evaluations outside the selected session/division scope.

Zero completed evaluations yields no score, never `0`, `NaN`, or infinity.

### 9.6 Display and rounding

- Calculations retain full stored precision.
- Overall scores display to one decimal by default.
- Category averages use scale-appropriate precision.
- Sorting and tie detection use canonical fixed-precision decimal aggregates. Equality at that stored precision is a genuine numerical tie.
- The UI always displays completed evaluator count, expected evaluator count, completion percentage, score range, and useful category averages.

### 9.7 Ranking and ties

Ranking precedence is:

1. Aggregate score descending.
2. Explicitly configured priority category, if present.
3. Shared rank for a genuine tie.
4. Director review.

Alphabetical order, record creation time, or hidden precision never breaks a displayed tie. A stable technical ordering may keep equal rows from visually jumping but does not change their rank. No numerical rank automatically creates a selection decision.

## 10. Weak-connection evaluation resilience

Offline resilience is limited to evaluation scoring.

### 10.1 Device outbox

IndexedDB stores:

- The minimal assigned-athlete and rubric context required for the active session.
- Draft score values, notes, and flags.
- Pending mutations with `evaluation_id`, `client_mutation_id`, expected server `version`, and timestamps.
- Prior synchronization receipts required to render accurate state.

### 10.2 Save states

- **Saving locally:** IndexedDB transaction in progress.
- **Saved on device:** local transaction committed; server has not confirmed.
- **Syncing:** queued mutation is in flight.
- **Synced:** server committed or recognized the same idempotent mutation.
- **Needs attention:** conflict, lost authorization, invalid rubric state, or retry exhaustion requires action.

The UI never says “saved” without specifying device or server persistence when the distinction matters.

### 10.3 Synchronization

1. Save the draft locally before attempting network submission.
2. Submit mutations in order when connectivity is available.
3. Replaying a `client_mutation_id` returns the original result without another write.
4. The server verifies tenant, assignment, rubric, lock state, and expected version.
5. A matching version updates transactionally and increments the version.
6. A stale version never overwrites the server. The device retains its draft and presents a review/reload path.
7. Successful receipts remove or compact completed outbox entries.

For the MVP, a synchronization conflict fails closed. The newest local draft remains available in
IndexedDB and the browser-session recovery view, completion stays disabled, and the evaluator can
copy or download the exact local work. Automatic keep-local rebasing and chained conflict
successors are deferred. The only destructive recovery is an explicit **Use server** confirmation
after an online, fresh-server comparison bound to the exact local input. If the local draft changes
after confirmation opens, confirmation must restart. To retain local work, the evaluator exports
it, accepts the server draft, then deliberately pastes or re-enters it as a new ordinary online
save. Existing keep-local terminal artifacts from earlier development builds remain readable and
exportable but fail closed: they are never replayed, extended, or used to allocate queue sequence.

Evaluator A can never address Evaluator B's evaluation record. Sync requests load only the minimal assigned dataset.

## 11. Rankings, comparison, and roster workflow

The desktop rankings workspace supports division, position, session, group, evaluator-count, and completion filters; search; category comparison; flags; notes; and decision state. Visualizations are limited to useful distributions and comparisons.

Athlete comparison shows overall score, category differences, normalized position, authorized session performance, evaluator count, range, and director-created operational flags. Private evaluator notes and evaluator identities remain excluded from peer comparison. It does not imply certainty when evaluation coverage is low.

Roster workflow:

1. Create teams and optional roster/position targets.
2. Build a draft through accessible drag-and-drop plus keyboard and explicit move controls.
3. Review roster size, position balance, scores, flags, and decision state.
4. Confirm decisions independently from placement.
5. Explicitly finalize a version.
6. Prepare—but do not automatically send—messages and exports.
7. Reopen only through an audited revision that preserves the prior finalized snapshot.

Concurrent roster edits include expected version numbers. Stale writes fail with a refresh-and-review path rather than overwriting newer work.

## 12. Communication architecture

MVP email templates include registration confirmation, evaluator invitation, reminder, callback, selected, waitlist, release, and roster finalized.

Commands create communication records and outbox jobs in the same database transaction. Each message snapshots recipient, template version, protected system facts, editable content, and rendered subject/body. Private evaluation notes and rankings are never included in guardian messages.

Message state is independent of decision state:

```text
queued → submitted → delivered
                  ↘ failed / bounced
```

Provider submission does not equal delivery. Resend callbacks update delivery state when available. Retry uses stable idempotency keys. Bulk release and selection sends require recipient preview and confirmation.

## 13. Stripe subscription architecture

- One Stripe customer/subscription mapping per organization subscription account.
- Internal entitlement keys are `trial`, `team`, `club`, and `association`.
- Product and price IDs are environment-backed configuration.
- Checkout and portal sessions are created server-side for authorized owners.
- Webhook signatures are verified against the raw body.
- Provider event IDs are stored before processing to guarantee idempotency.
- Verified webhook state is authoritative for active, trialing, past-due, canceled, and entitlement transitions.
- Client-return URLs never grant plan access by themselves.

Launch prices may be seeded as Team $49/month, Club $129/month, and Association $249/month, but marketing copy reads centralized plan configuration. Prices are not hard-coded across components.

## 14. Team-management integration contract

TryoutFlow never reads another product's database. A provider adapter receives an explicit organization context, actor, connection, and idempotency key.

The provider-neutral contract is responsible for:

- Beginning or completing connection authorization.
- Verifying and disconnecting a connection.
- Listing permitted external organizations, seasons, divisions, and teams.
- Previewing athlete imports.
- Executing a confirmed athlete import.
- Previewing one finalized roster export.
- Exporting one confirmed finalized roster version.
- Returning job and item status.
- Normalizing provider errors.

Conceptual contract shape:

```ts
interface TeamManagementProvider {
  readonly providerKey: string;
  beginConnection(input: ConnectionRequest): Promise<ConnectionChallenge>;
  completeConnection(input: ConnectionCallback): Promise<ConnectionResult>;
  verifyConnection(context: ProviderContext): Promise<ConnectionHealth>;
  disconnect(context: ProviderContext): Promise<void>;
  listOrganizations(context: ProviderContext): Promise<ExternalOrganization[]>;
  listDestinations(
    context: ProviderContext,
    organization: ExternalEntityRef,
  ): Promise<ExternalRosterDestination[]>;
  previewAthleteImport(
    context: ProviderContext,
    request: AthleteImportRequest,
  ): Promise<AthleteImportPreview>;
  importAthletes(
    context: ProviderContext,
    request: ConfirmedAthleteImport,
  ): Promise<SyncJobResult>;
  previewRosterExport(
    context: ProviderContext,
    request: FinalizedRosterExportRequest,
  ): Promise<RosterExportPreview>;
  exportFinalizedRoster(
    context: ProviderContext,
    request: ConfirmedRosterExport,
  ): Promise<SyncJobResult>;
  getSyncStatus(
    context: ProviderContext,
    externalJobId: string,
  ): Promise<ProviderSyncStatus>;
}
```

`ProviderContext` contains the TryoutFlow organization, authorized actor, connection identifier, correlation identifier, and idempotency key. Request types contain reviewed internal snapshots and explicit external destinations. Provider result types return stable external references, item-level outcomes, and normalized error codes rather than provider SDK objects.

Export payloads contain a finalized roster snapshot and explicitly approved fields, not arbitrary database access.

### 14.1 Idempotency and recovery

- A unique provider/job/idempotency key prevents repeated top-level work.
- External entity mappings prevent duplicate athletes, teams, and roster versions.
- Each sync item records pending, processing, completed, failed, skipped, or requires-review state.
- Completed items remain completed during retries.
- A job derives completed, partially completed, or failed state from its items.
- User-facing errors are actionable and contain no provider secrets or stack traces.

### 14.2 The Squad MVP

`TheSquadProvider` is a disabled-by-default mock provider until an authenticated API is documented. Contract fixtures cover successful export, repeated export, duplicate candidate, partial failure, total failure, and retry. The UI labels the connection as a demo/mock and never implies live transfer.

## 15. Background jobs and concurrency

A PostgreSQL outbox schedules email, integration, analytics dispatch, and webhook follow-up. Jobs have:

- Type and versioned payload.
- Idempotency key.
- Available time.
- Attempt count and maximum attempts.
- Lease owner and expiration.
- Last normalized error.
- Completed or terminal-failure timestamp.

A protected scheduled Vercel handler claims small batches using transactional row locking, processes them, and records results. Exponential backoff includes jitter. Long-running needs can move behind the same job contract to a worker later.

Database uniqueness, transactions, optimistic versions, and provider idempotency protect evaluation writes, check-ins, numbers, roster edits, email sends, exports, and Stripe events under concurrency.

## 16. Route and page map

### 16.1 Public routes

- `/`
- `/features`
- `/for/teams`
- `/for/clubs`
- `/for/associations`
- `/pricing`
- `/demo`
- `/privacy`
- `/terms`
- `/sign-in`
- `/start`
- `/auth/callback`
- `/invite/[token]`
- `/register/[tryoutSlug]`
- `/register/[tryoutSlug]/confirmation`

### 16.2 Organization application

Root: `/app/[organizationSlug]`

- `/home`
- `/tryouts`
- `/tryouts/new`
- `/tryouts/[tryoutId]/overview`
- `/tryouts/[tryoutId]/setup/*`
- `/tryouts/[tryoutId]/registration`
- `/tryouts/[tryoutId]/check-in`
- `/tryouts/[tryoutId]/sessions`
- `/tryouts/[tryoutId]/staff`
- `/tryouts/[tryoutId]/live`
- `/tryouts/[tryoutId]/rankings`
- `/tryouts/[tryoutId]/compare`
- `/tryouts/[tryoutId]/rosters`
- `/tryouts/[tryoutId]/messages`
- `/tryouts/[tryoutId]/reports`
- `/athletes`
- `/athletes/[athleteId]`
- `/athletes/import`
- `/athletes/duplicates`
- `/evaluators`
- `/reports`
- `/organization/members`
- `/organization/settings`
- `/organization/billing`
- `/organization/integrations`
- `/organization/audit`

### 16.3 Evaluator focus

Root: `/app/[organizationSlug]/evaluate`

- `/session/[sessionId]`
- `/session/[sessionId]/athletes`
- `/session/[sessionId]/athletes/[registrationId]`
- `/session/[sessionId]/progress`
- `/profile`

The route hierarchy does not grant access. Every loader and mutation independently authorizes the resource.

## 17. Design system

### 17.1 Visual direction

TryoutFlow uses a bright athletic-editorial identity:

- Warm off-white canvas and white work surfaces.
- Strong charcoal typography.
- Electric blue for primary interaction and focus.
- Vivid lime for positive progress and performance accents with dark foreground.
- Coral for selections, callbacks, and editorial emphasis; destructive states use a separate accessible red.
- Bold bib numbers, tabular score figures, ruled performance lines, and subtle field/court/rink motifs.
- Rounded tactile controls and selected bounded surfaces, balanced by open layouts to avoid card-heavy screens.
- Minimal gradients, no glassmorphism, no dark sports-dashboard default, and sparse marketing-only photography.

Exact token values and current licensed typefaces are confirmed during the foundation phase with automated contrast checks. Token roles—not raw colors—are used throughout the product.

### 17.2 Responsive behavior

- Phone layouts from 375–430 px use single-column flows, minimum 44 px touch targets, bottom navigation, and no horizontally compressed desktop tables.
- Evaluator score controls remain large and reachable; save state and next-athlete navigation remain visible.
- Tablet uses split context only where it reduces navigation without shrinking controls.
- Desktop uses sidebar navigation, readable data density, filters, comparison, roster workspace, and reporting views.
- Tables transform into summaries or disclosure rows on mobile unless genuine horizontal comparison requires a contained scroll region.

### 17.3 Accessibility and motion

- WCAG AA color contrast.
- Semantic headings, landmarks, labels, status messages, and errors.
- Complete keyboard support, including roster movement alternatives.
- Visible focus states and non-color state indicators.
- Reduced-motion support.
- Motion is short and purposeful: score selection, synchronization, ranking movement, and roster placement.
- Loading, empty, error, denied, offline, and retry states are designed components, not afterthoughts.

## 18. Error handling and observability

Application results distinguish validation, permission, conflict, network, integration, and unexpected errors. User messages explain recovery without leaking internals.

Structured operational logs include request, organization, actor, job, and correlation identifiers but exclude athlete identity, guardian details, scores, and evaluation notes unless a narrowly controlled diagnostic need is approved.

Audit logs are separate from operational logs. Audit events include organization, actor, action, target type/ID, timestamp, and safe structured metadata for publishing, rubric changes after scoring starts, evaluation reopening, roster finalization/revision, manual roster movement, decision changes, bulk communication, integration changes and export, and member-role changes.

Health indicators cover database connectivity, job backlog, webhook failures, communication failures, and synchronization problems. Privacy-safe analytics record workflow events without private evaluation content.

## 19. Testing architecture

### 19.1 Unit and domain tests

- Score normalization, weighted totals, aggregation, rounding, zero-completion behavior, ties, filtering, and edited/reopened/locked evaluations.
- Permission policies and state machines.
- Registration validation and duplicate candidates.
- Number allocation.
- Roster and decision transitions.
- Provider mapping, idempotency, and error normalization.

Scoring tests are written before scoring implementation.

### 19.2 Database and integration tests

- Local Supabase PostgreSQL migrations from empty state.
- RLS allowed and denied cases for every role.
- Cross-tenant IDs and composite-key failures.
- Database constraints for duplicate membership, assignments, evaluations, active numbers, rubric/category consistency, roster integrity, and subscription mapping.
- Transaction and concurrency behavior.
- Fake Stripe, email, and team-management adapters; no real emails or customer charges.

### 19.3 Browser tests

Playwright projects cover Chromium, Firefox, WebKit, Mobile Chrome, and Mobile Safari. Critical scenarios include:

1. Owner onboarding and tryout publication.
2. Guardian registration and administrator visibility.
3. Check-in and number assignment.
4. Three independent evaluators and exact aggregate math.
5. Offline draft, reconnect, sync, and no duplicate evaluation.
6. Cross-organization direct URL denial.
7. Check-in staff rankings denial.
8. Roster creation, finalization, lock, and audit.
9. Communication state independent from decision state.
10. Idempotent mock export.
11. Partial mock failure and retry without duplication.
12. Stripe test subscription, webhook changes, cancellation, and portal.
13. Narrow evaluator viewport with no overflow or inaccessible controls.

Critical flows also run automated accessibility checks and assert no unexpected console errors or failed network requests.

### 19.4 Verification gates

Each implementation phase runs fresh formatting, linting, strict type checking, relevant unit/integration/database tests, production build, and proportional browser tests. A phase cannot be called complete with skipped failures, weakened security, removed requirements, hidden console errors, or undocumented broad types.

## 20. Deployment and environments

- Vercel hosts the Next.js application.
- Supabase hosts PostgreSQL, Auth, and private storage.
- Development, preview, and production use separate projects and Stripe modes.
- Supabase Free is acceptable for development and demos. Production upgrades before onboarding real organizations to obtain non-pausing service and stronger backup guarantees.
- Region selection aligns application and database latency; Canadian-only residency is not an MVP promise.
- Version-controlled migrations apply before compatible application releases.
- Secrets live in environment configuration and never reach browser bundles.
- Preview environments use synthetic data only.
- Seeded demo data includes incomplete evaluations, a genuine tie, different decision states, draft/final rosters, and successful/failed mock sync jobs.

Current stable dependency versions are selected during implementation planning from official documentation rather than fixed from memory in this design.

## 21. Security and privacy requirements

- Validate every untrusted input and allow-list writable fields.
- Rate-limit and bot-protect public registration and authentication-sensitive endpoints.
- Protect exports, object storage, integration credentials, email actions, scheduled jobs, and webhooks.
- Verify Stripe signatures from raw request bodies.
- Encrypt provider secrets at rest and avoid secrets in audit metadata.
- Prevent mass assignment and insecure direct object references.
- Reauthorize high-value mutations at execution time.
- Minimize collection of emergency or eligibility data and make optional fields organization-controlled.
- Define retention, export, correction, deletion, support-access, and breach-response policies before production launch.
- Obtain legal/privacy review for minor-athlete data and applicable Canadian and customer-jurisdiction obligations.

## 22. Performance requirements

- Evaluator devices load only assigned athletes, rubric context, and minimal session information.
- Tenant, tryout, session, assignment, registration, evaluation, decision, and job filters receive appropriate composite indexes.
- Large administrative lists paginate; dense roster/ranking views may virtualize after measurement.
- Aggregate queries avoid repeated per-row work and may use transactionally refreshed summaries after profiling.
- Marketing pages minimize client JavaScript and optimize images.
- Analytics never blocks score persistence.

## 23. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Cross-tenant data exposure | Server capabilities, RLS, composite keys, denial tests, audited support elevation |
| Lost rink-side scores | IndexedDB-first save, visible states, idempotent outbox, conflict retention, mobile network tests |
| Incorrect scoring | TDD, deterministic decimal math, immutable rubric versions, explicit completion rules, reproducible aggregates |
| Evaluator bias | Peer scores private by default, optional blind evaluation, director-controlled visibility |
| Duplicate people or exports | Candidate review, external mappings, unique idempotency keys, item-level retry |
| Concurrent edits | Unique constraints, transactions, row locks where appropriate, optimistic versions |
| Email/provider partial failure | Separate delivery/sync state, durable outbox, actionable retry, unchanged roster decision |
| Free-tier interruption | Free only for development/demo; paid production upgrade before real use |
| Privacy or retention ambiguity | Data minimization and formal legal/privacy review before launch |
| MVP overexpansion | Explicit exclusions and independently testable delivery phases |

## 24. Acceptance criteria

TryoutFlow's MVP architecture is satisfied when fresh verification demonstrates:

- A new owner creates an account and organization and completes focused onboarding.
- A director creates, validates, and explicitly publishes a tryout with divisions, sessions, assignments, form, and rubric.
- A guardian registers an athlete without an athlete account, and duplicate candidates do not auto-merge.
- Check-in staff concurrently assign valid numbers and check athletes in without seeing rankings.
- Multiple evaluators independently score assigned athletes without peer-score influence.
- Draft scores survive refresh and weak-network simulation, then synchronize once without overwriting newer data.
- Weighted results match the scoring specification; missing work never becomes zero; ties remain ties.
- Directors understand completion context, compare athletes, create teams, manage decisions, and finalize an immutable roster.
- Finalization is audited, and revision preserves the prior snapshot.
- Communication delivery remains separate from decisions and supports visible failure/retry.
- CSV imports and exports validate and report row-level issues.
- Stripe test subscriptions follow verified, idempotent webhook state.
- The mock provider exports a finalized roster idempotently, preserves mappings, reports partial failure, and retries only failed items.
- RLS and server authorization deny cross-tenant, evaluator, check-in, reviewer, and anonymous privilege escalation.
- Critical workflows work at 375 px through large desktop widths with no evaluator horizontal overflow.
- Critical workflows have no known severe accessibility failures, unexpected console errors, failed production build, failing required tests, or unresolved cross-tenant security defects.
- Completed MVP screens contain purposeful loading, empty, error, denied, and recovery states rather than placeholders.

## 25. Implementation transition

After written-spec approval, create a separate implementation plan in `docs/superpowers/plans/2026-08-28-tryoutflow-implementation.md`. The plan will divide work into independently testable phases for foundation, identity/tenancy, tryout configuration, registration/check-in, evaluator scoring, offline synchronization, ranking, rosters, communication, subscriptions, mock integration, marketing/onboarding, full QA, and production-readiness verification.

No production implementation begins before that plan is reviewed under the required Superpowers workflow.
