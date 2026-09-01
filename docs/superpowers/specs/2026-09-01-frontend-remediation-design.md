# TryoutFlow Frontend Remediation Design

**Date:** 2026-09-01

**Status:** Approved in conversation

**Visual direction:** Performance Lab with Game-Day operational workspaces

## Problem

TryoutFlow's backend and workflow behavior are substantially complete, but the frontend does not present that capability credibly. The root visual defect is structural: many routes use semantic class names such as `auth-page`, `auth-card`, `card`, `eyebrow`, and `button-primary` without corresponding stylesheet definitions. Those routes therefore render close to browser-default HTML even though global CSS loads successfully. Other routes use local Tailwind utilities and look materially different, producing an inconsistent product.

This remediation must create a coherent application interface rather than patch the two reported screenshots. It covers signed-out authentication, onboarding, the authenticated shell, manager/director workflows, evaluator and check-in workspaces, secondary administration, and regression protection.

## Goals

1. Make every user-facing route look deliberate, coherent, and production-ready.
2. Carry the existing marketing identity into the product with a stronger sports-performance character.
3. Give managers and directors an efficient operational command center while keeping evaluator and check-in experiences focused.
4. Preserve existing backend authorization, idempotency, concurrency, offline, and audit contracts.
5. Make loading, empty, partial, unavailable, denied, error, conflict, offline, pending, and success states visually explicit.
6. Prevent undefined semantic classes and raw-browser rendering from recurring.
7. Provide deterministic local demo access and screenshot coverage for representative production-bound states.

## Non-Goals

- Rewriting database migrations, RPC contracts, authorization rules, or durable workflow semantics.
- Introducing a general-purpose theme editor or organization-specific theming.
- Adding a user-selectable dark mode. Game-Day mode is route-specific and purposeful.
- Replacing accessible native behavior with ornamental custom controls.
- Redesigning the public marketing information architecture beyond alignment work needed for shared primitives.
- Adding new workflow capabilities unrelated to presentation and interaction clarity.

## Product Personality

The approved direction is **Performance Lab**: warm athletic editorial design with technical clarity. It should feel like a professional training facility and decision room, not a generic SaaS dashboard and not a novelty scoreboard.

The existing palette remains the base:

- Warm cream canvas for low-glare administrative work.
- Deep navy for structure, text, and operational authority.
- Electric blue for primary actions and focus.
- Performance lime for positive performance cues and high-salience highlights.
- Coral for selection and attention where it does not imply an error.
- Red reserved for destructive and failure states.

Sports character comes from bib-forward identity, score typography, decisive information hierarchy, restrained field/court geometry, compact uppercase labels, technical metrics, and tactile surfaces. It must not rely on sport-specific imagery so the interface remains credible for hockey, soccer, basketball, volleyball, and other tryout programs.

## Visual Modes

### Performance Lab

The default light mode covers authentication, onboarding, home, setup, registration administration, athletes, rankings, compare, rosters, reports, communications, staffing, organization administration, billing, integrations, audit, and settings.

It uses warm canvas, white surfaces, navy type, electric-blue actions, lime performance accents, subtle borders, restrained shadows, and dense-but-readable responsive layouts.

### Game-Day

The route-specific dark operational mode covers check-in, active evaluation, and the live tryout dashboard. It uses deep navy surfaces, high-contrast white text, luminous but accessible status accents, larger targets, and reduced navigation. It is not a user preference and does not change the semantics of shared components.

## Design-System Architecture

The application will use a shared semantic design layer backed by existing Tailwind support and CSS custom properties. No route may depend on an undefined global class.

### Tokens

Expand the current token set to cover:

- Canvas, surface, elevated surface, inset surface, and operational surface colors.
- Primary, performance, selection, warning, destructive, success, and informational roles.
- Text, muted text, inverted text, border, strong border, and focus roles.
- Type families and scales for display, body, labels, scores, and bibs.
- Spacing, target sizes, content widths, radii, shadows, transitions, and layering.
- Game-Day overrides expressed through a bounded route-level theme wrapper.

### Shared Primitives

Shared components will own their complete visual and behavioral contracts:

- Buttons and links: primary, secondary, quiet, destructive, icon, pending, and disabled states.
- Form controls: input, textarea, select, checkbox, radio, field group, help, validation, and bot-challenge states.
- Surfaces: card, inset panel, metric card, data panel, decision panel, and empty-state panel.
- Feedback: alert, field error, action status, loading skeleton, empty, unavailable, denied, offline, conflict, and success.
- Data display: status badge, bib badge, score, metric, progress, responsive table/list, and definition list.
- Structure: page header, section header, action bar, breadcrumb/context trail, filters, dialog, sheet, and tabs where semantically appropriate.

Primitives must remain independently understandable and testable. Route components compose them rather than restyling them ad hoc.

## Application Shell

### Manager and Director Shell

Desktop uses a persistent sidebar with:

- TryoutFlow and organization identity.
- Current role and organization context.
- Grouped navigation for Overview, Tryouts, People, Decisions, Communications, and Organization.
- Current-tryout shortcuts when a tryout is in context.
- Account and sign-out controls.

The content frame supplies a consistent page header, context/breadcrumb region, primary-action area, and responsive main grid. Wide screens may use contextual side panels; content never expands without a useful reading or data-density reason.

Tablet and mobile use a compact top bar, a bounded primary bottom navigation, and an accessible More sheet for secondary destinations. Navigation labels remain truthful to authorization; unavailable destinations are omitted rather than merely hidden visually.

### Focused Role Workspaces

Evaluators and check-in staff enter focused workspaces with only the context and navigation required for their active assignment. They retain a safe path to profile, assignment selection, and sign-out without inheriting manager-only information architecture.

## Authentication and Onboarding

Signed-out authentication uses a branded split layout on desktop and a focused card on small screens. The product side communicates the operational value of TryoutFlow without unsupported marketing claims. The form side provides strong labels, clear validation, visible password and recovery affordances, and an explicit Turnstile lifecycle.

The routes for sign-in, sign-up, verification, password recovery/reset, invitations, and start/onboarding share the same shell and state components.

Organization onboarding becomes a short, legible setup flow. It explains organization name, generated URL, and timezone; preserves server-side validation; and moves the user into the authenticated shell after success. Demo credentials are documented for local use and backed by deterministic seeded or setup data rather than transient manual state.

## Workflow Information Architecture

### Home

Home becomes an operational command center with upcoming sessions, registration totals, evaluation progress, roster state, actionable alerts, onboarding milestones, and a concise next-action hierarchy. It must distinguish genuine zero states from unavailable data.

### Tryout Lifecycle

Tryout routes share a visible lifecycle model:

`Draft → Published → Registration → Evaluation → Decisions → Finalized`

The lifecycle rail shows current state, completed stages, outstanding work, and the next valid action. It does not fabricate progress that the backend does not provide.

### Athletes and Registration

Athlete identity is bib-forward and preserves exact authorized display names. Directory and registration views expose useful status, division, position, registration, and evaluation context through responsive rows/cards and bounded filters. Sensitive data remains limited by the existing projections.

### Rankings and Compare

Rankings emphasize evidence rather than decoration: overall score, evaluator completion, score range or variance where available, position, current human decision, and explicit unavailable states. Compare uses stable side-by-side evidence and remains readable on narrow screens.

### Rosters

Rosters use a decision-room layout containing the athlete pool, team targets, placement state, independent decision controls, revision history, audit context, and guarded finalization. Drag-and-drop remains an enhancement; keyboard and explicit controls retain full parity.

### Evaluation, Check-In, and Live

These routes use Game-Day mode. They prioritize large targets, unmistakable participant identity, progress, save/sync state, offline state, conflict recovery, and minimal navigation. The interface must make durable versus local state visually explicit without changing the existing offline and concurrency behavior.

### Secondary Administration

Communications, reports, staff, members, billing, integrations, audit, settings, and platform administration use shared workspace patterns. They remain visually coherent but do not receive bespoke ornament that obscures their operational purpose.

## Interaction Rules

- One visually dominant primary action per region.
- Destructive and irreversible actions remain separated and require explicit confirmation.
- Dialogs are reserved for consequential confirmation or focused editing; routine navigation does not become modal.
- Action feedback appears adjacent to the initiating control or affected object.
- Pending actions prevent duplicate activation while retaining their accessible names.
- Filters are comprehensible, reversible, and accurately distinguish filtered-empty from true-empty states.
- Server and client conflicts preserve current context and present the correct recovery action.
- Navigation and responsive transformations do not hide critical facts or permissions.

## Data and Authorization Boundaries

The frontend continues to consume existing server loaders, application commands, gateways, RPCs, and safe projections. The visual remediation must not bypass, duplicate, or weaken execution-time authorization.

Shared view models may normalize presentation state, but they may not invent data. Missing, malformed, unauthorized, and unavailable results remain distinct. Exact IDs and version/CAS values continue to flow from loaded authoritative snapshots into mutations.

## Error and State Handling

Every redesigned route defines the following applicable states:

- Loading: stable skeleton or progress language without false data.
- Empty: a truthful absence with a valid next action when authorized.
- Partial/unavailable: available information remains visible while missing evidence is named.
- Denied/not found: non-oracular behavior consistent with current authorization contracts.
- Validation error: field-level guidance and a preserved form.
- Conflict/stale state: preserved context, authoritative refresh information, and a bounded retry or reconciliation action.
- Offline/pending: durable/local distinction and exact sync state.
- Success: concise confirmation tied to the affected object.

Correlation details remain in safe logs and analytics rather than user-visible error copy. The redesign must not create secret or PII exposure in markup, URLs, browser logs, or screenshot fixtures.

## Accessibility and Responsive Requirements

- Interactive targets are at least 44 CSS pixels in both modes.
- Keyboard order follows visual order; dialogs and sheets restore focus to their initiators.
- Focus indicators use the semantic focus token and remain visible on every surface.
- Pages use semantic headings, landmarks, labels, status regions, tables, and dialogs.
- Color is never the sole carrier of state.
- Text and interface contrast meet WCAG AA in Performance Lab and Game-Day modes.
- Reduced-motion preferences remove nonessential animation.
- Required workflows remain usable from 320 CSS pixels through 1920 CSS pixels without critical horizontal overflow.
- Pointer, keyboard, and explicit control paths retain parity for roster and evaluation interactions.

## Testing Strategy

### Contract and Unit Tests

- Add a semantic-class contract that discovers used global semantic classes and fails when definitions are absent.
- Test tokens and each shared primitive across variants, states, focus, reduced motion, and target sizes.
- Test role-aware navigation composition and Game-Day route scoping.
- Test route view-state mapping without weakening existing backend/action assertions.

### Component and Integration Tests

- Cover auth/onboarding form states, Turnstile states, conflict recovery, filters, dialogs, and mobile navigation.
- Retain existing application and integration suites to prove authorization, idempotency, concurrency, offline, and audit semantics are unchanged.
- Use deterministic seeded data and stable demo identities.

### Browser and Visual Regression

Playwright screenshot baselines will cover, at minimum:

- Sign-in and organization onboarding.
- Manager home and tryout lifecycle.
- Rankings and compare.
- Roster decision room.
- Evaluator Game-Day workspace.
- Check-in or live Game-Day workspace.
- Representative empty, unavailable, conflict, and mobile navigation states.

Representative baselines run at desktop and mobile sizes. Interaction and accessibility gates remain cross-browser; screenshot comparison may use a canonical browser to avoid engine rendering noise. Screenshots must contain synthetic demo data only.

## Delivery Slices

1. **Foundation:** tokens, typography, semantic primitives, CSS-definition contract, and representative visual tests.
2. **Auth and onboarding:** signed-out shell, forms, Turnstile states, invitations, recovery, and deterministic demo access.
3. **Application shell and home:** desktop/mobile navigation, role focus, context headers, and command-center home.
4. **Lifecycle administration:** tryouts, sessions, registration, athletes, staff, rankings, compare, and reports.
5. **Decision and Game-Day workflows:** rosters, evaluation, check-in, and live dashboards.
6. **Secondary administration:** communications, members, integrations, billing, audit, settings, and platform pages.
7. **Regression and polish:** canonical screenshot baselines, cross-browser accessibility, responsive audit, demo walkthrough, and removal of obsolete visual declarations.

Each slice must be independently reviewable and leave the application in a coherent state. Production code changes follow test-driven development: the relevant test fails for the intended visual or behavioral reason before implementation begins.

## Acceptance Criteria

The remediation is complete when:

1. No user-facing route relies on undefined semantic CSS.
2. Signed-out and authenticated routes visibly share the approved Performance Lab identity.
3. Check-in, active evaluation, and live dashboards use the approved bounded Game-Day treatment.
4. Manager/director, evaluator, and check-in navigation reflect their real roles and authorization.
5. Core workflows are legible and usable at mobile and desktop widths with keyboard and pointer parity.
6. Existing backend behavior and security gates remain green.
7. The documented demo credentials work after the repeatable local setup path.
8. Visual regression, component, accessibility, cross-browser, integration, and repository verification gates pass without skipped critical coverage.
