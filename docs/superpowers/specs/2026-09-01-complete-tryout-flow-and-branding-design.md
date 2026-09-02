# Complete Tryout Flow and Organization Branding Design

**Date:** 2026-09-01  
**Status:** Approved for implementation
**Scope:** TryoutFlow organization branding, form guidance, layout consistency, and end-to-end tryout journey

## Objective

Make TryoutFlow understandable and operational from the first organization setup through the final roster and reports. The product should teach users what to enter, expose one recommended next action at every stage, preserve all existing authorization and durability guarantees, and display an organization logo consistently in staff and public registration experiences.

## User Journey

The canonical journey is:

1. Create and brand an organization.
2. Create a season/cycle and draft tryout.
3. Complete guided setup: basics, divisions, registration form, sessions, rubrics, staff, review, and publish.
4. Add participants through a new registration, returning-athlete registration, CSV import, or a shared public link.
5. Check participants in, issue QR assistance, run sessions, and collect evaluations.
6. Review evidence, compare and rank participants, record decisions, and build roster drafts.
7. Finalize immutable rosters, communicate decisions, export data, and review reports/audit history.

The tryout overview is the durable hub for this journey. Every operational page provides a clear route back to that overview or forward to the next logical stage.

## Layout and Spacing

The current tryout-card padding defect is caused by the undefined `--space-5` token. Browsers discard declarations such as `padding: var(--space-5)` when the custom property is missing.

The implementation will:

- define the missing spacing token in the shared theme;
- keep the spacing scale monotonic between `--space-4` and `--space-6`;
- apply consistent internal card padding and vertical rhythm to tryout cards, settings forms, journey cards, and participant actions;
- preserve 44-pixel minimum interactive targets;
- prevent button collisions and horizontal overflow at 320, 375, and 390 pixels;
- keep desktop cards compact while leaving sufficient separation around headings, badges, copy, and actions.

## Form Examples and Guidance

Core journey forms will include meaningful examples rather than generic or empty fields. Examples explain format but never become submitted values unless a user enters them.

Examples include:

- Tryout name: `U15 Fall Evaluations`
- Sport: `Hockey`
- Cycle: `2026 Fall Season`
- Timezone: `America/Edmonton`
- Division: `U15`
- Session: `Skills Session 1`
- Group: `Forward Group`
- Position: `Forward`
- Registration form: `2026 Player Registration`
- Rubric: `Skating and Game Sense`
- Athlete and guardian fields: realistic, explicitly fictional names and contact formats
- Organization defaults: comma-separated examples for sports and quick tags

Native date and datetime controls do not reliably render placeholders. They will receive adjacent example/help text describing the expected local date and time and the applicable organization timezone.

Placeholder coverage applies to organization creation/settings, tryout creation/setup, staff participant entry, public registration, membership invitations, messaging, check-in search, and other user-entered core workflow fields. Select controls will begin with a truthful instructional option where choosing a value is required.

## Organization Logo

### Upload and normalization

Owners and administrators can upload, replace, or remove a logo from Organization Settings.

The upload boundary will:

- accept PNG, JPEG, or WebP only;
- reject SVG and other active or ambiguous formats;
- reject empty files and raw files over 2 MiB;
- decode the image with Sharp, ignoring file extensions and client MIME claims;
- strip metadata and orientation surprises;
- resize within a 512 by 512 pixel box without enlargement;
- encode one normalized WebP asset with a strict encoded-size ceiling;
- compute a SHA-256 digest for integrity and caching;
- provide actionable invalid-file and temporary-failure states.

### Durable storage

A new private `organization_brand_assets` table will own one normalized logo per organization. The row contains organization identity, normalized bytes, content type, byte length, digest, updater, and timestamps. Database checks enforce the one-logo relationship, WebP-only content, bounded size, digest shape, and immutable organization identity.

Clients receive no direct table access. Narrow `SECURITY DEFINER` functions with empty search paths provide owner/admin upsert and removal after action-time authorization. Mutations are audited. Direct table mutation, truncation, and unsafe role grants remain denied.

### Delivery and display

An image route returns only the normalized logo bytes and safe caching headers. It supports conditional requests using the stored digest as an ETag.

- Authenticated organization layouts learn whether a logo exists and render it in desktop and mobile navigation.
- Public registration configuration includes only a safe logo URL when the published tryout's organization has a logo.
- Public registration displays the organization name and logo above the tryout name.
- Missing, removed, or temporarily unavailable logos fall back to the current `TF` mark without broken-image UI.
- Logo alternative text uses the organization name and does not repeat adjacent text unnecessarily.

## Guided Tryout State

The overview computes a read-only journey projection from authoritative durable records. It does not infer completion from browser state or optimistic UI.

Each stage exposes:

- a short purpose statement;
- `Not started`, `In progress`, `Ready`, or `Complete` status;
- truthful supporting counts or an explicit unavailable state;
- blockers when the next action is not permitted;
- one recommended primary action and optional supporting actions.

### Prepare

Uses the existing setup progress and publication status. The primary action is the first incomplete guided setup step. Published tryouts show setup as complete while still allowing settings review.

### Participants

Uses publication state and registration counts. Actions include new participant, returning athlete, CSV import, and public-link sharing. Draft tryouts explain that publishing is required before intake.

### Run tryout

Uses configured sessions, check-ins, and evaluation progress. Actions lead to sessions, check-in, live operations, and evaluator work. Missing sessions or staff produce exact preparation blockers.

### Make decisions

Uses evaluation availability, decision state, and roster-draft state. Actions lead to comparison, rankings, and roster building. The UI never claims evaluation completeness when data is unavailable.

### Complete

Uses finalized roster, communication, export, and report state. Actions lead to roster finalization, decision messaging, reports, and audit history. Finalized snapshots remain immutable and revisions remain explicit.

The projection selects only bounded counts and identifiers required for navigation. Any failed dependency yields a stage-level unavailable state rather than fabricated zeroes.

## Navigation and Page Transitions

- The overview remains the main control room.
- Stage pages include a compact journey header with `Back to overview` and the relevant next action.
- Completing setup returns to the overview with the next recommended stage visible.
- Participant creation returns to the participant workspace with a truthful success state and refreshed count.
- Operational pages never hide existing specialist tools; they organize them under the journey stage.
- Browser back/forward, refresh, stale submissions, double clicks, and network errors retain existing idempotency and conflict semantics.

## Authorization and Privacy

- Logo mutations require a live organization membership and the existing organization-update capability at execution time.
- Public logo reads expose only normalized organization artwork; no membership, contact, or internal metadata is returned.
- Public registration remains published-tryout scoped and non-oracular.
- Journey counts use the current user's authorized organization and tryout scope.
- Service-role access remains route-internal and receives no broad client-facing grants.
- Upload errors and public missing-logo responses reveal no tenant-private details.

## Error Handling

- Invalid files: explain accepted formats and size limits without storing data.
- Image processing failure: retain the current logo and show a retryable error.
- Logo delivery failure: render the fallback mark.
- Journey projection failure: mark only the affected stage unavailable and preserve usable actions whose authorization is known.
- Invalid form input: identify the affected field and show its expected format; do not collapse all validation into a generic `invalid input` message.
- Network/stale-action failures: preserve entered values where safe and provide a direct retry.

## Testing and Acceptance Criteria

### Database

- Clean additive migration and upgrade rehearsal.
- pgTAP coverage for schema constraints, exact ACLs, RLS, fixed search paths, mutation authorization, audit behavior, replacement/removal, and direct/replica truncation denial.

### Unit and integration

- Image decoder rejects spoofed MIME types, SVG, malformed data, oversize input, and oversize normalized output.
- Upload, replace, remove, missing-logo, and ETag paths are covered.
- Placeholder/example catalog is asserted across core forms.
- Journey projection covers draft, published-empty, active evaluation, roster-draft, finalized, and dependency-unavailable states.
- Existing idempotency, authorization, and stale-action behavior remains green.

### Browser

The seeded demo must pass a production-bound, zero-retry journey:

1. Sign in as the demo owner.
2. Upload a logo and verify it in desktop and mobile navigation.
3. Create a new cycle-backed tryout using the example-guided fields.
4. Complete setup and publish.
5. Open the public registration page and verify the organization logo/name.
6. Register a participant and verify staff-side participant visibility.
7. Exercise check-in, session/evaluation navigation, decisions, roster finalization, communication, and reporting transitions using authoritative demo fixtures.
8. Replace and remove the logo and verify fallback behavior.
9. Verify keyboard operation, focus recovery, accessible names, 320-pixel layout, no horizontal overflow, and no unexpected console or request errors.

### Release gates

- Focused RED-to-GREEN tests for each new behavior.
- Full bounded unit suite.
- Full pgTAP and affected integration suites.
- Production build, format, lint, typecheck, audit, and diff checks.
- Clean worktree and zero owned test/process/database residue.

## Non-goals

- Multiple logos or per-tryout branding.
- Arbitrary image cropping or a full brand-kit editor.
- Custom colors, fonts, or themes.
- Replacing specialist operational workspaces with a single monolithic wizard.
- Changing evaluation, ranking, roster, communication, or export business rules.
