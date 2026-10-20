# Guided Tryout Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make tryout setup, participant intake, and day-to-day operation understandable and efficient from desktop and mobile.

**Architecture:** Preserve the existing authorization, RPC, registration, evaluation, roster, messaging, and reporting boundaries. Add a presentation projection for each tryout, restore persisted setup values at the server-component boundary, and reorganize existing actions into a stage-based workspace with Participants as a first-class destination.

**Tech Stack:** Next.js App Router, React, TypeScript, Supabase/PostgreSQL, Vitest/Testing Library, Playwright, CSS.

**Spec:** User-approved guided flow in the 2026-09-01 conversation: Create → Prepare → Add participants → Run tryout → Make decisions → Complete.

## Global Constraints

- Keep the existing hardened backend and execution-time authorization boundaries.
- Do not introduce a migration unless an existing projection cannot support the required counts.
- Preserve progressive enhancement and 44px minimum interactive targets.
- Keep public registration, manual registration, and returning-athlete registration distinct and explicit.
- Errors must identify the invalid field or recovery action without leaking tenant data.
- Mobile layouts must remain usable at 320px and must not obscure the page with an unbounded menu.

---

### Task 1: Restore and validate tryout basics

**Files:**
- Modify: `src/app/(app)/app/[organizationSlug]/tryouts/[tryoutId]/setup/[step]/page.tsx`
- Modify: `src/modules/tryouts/ui/tryout-wizard.tsx`
- Create: `src/modules/tryouts/ui/tryout-basics.ts`
- Test: `tests/unit/tryouts/tryout-wizard.test.tsx`
- Test: `tests/unit/tryouts/tryout-basics.test.ts`

**Interfaces:**
- Produces: `TryoutBasicsValues` and `toDateTimeLocalValue(value, timezone)` for deterministic server-rendered defaults.
- Consumes: the existing tryout row fields `name`, `sport`, `timezone`, `registration_starts_at`, and `registration_ends_at`.

- [ ] Write failing tests proving stored values render, required labels are explicit, invalid ranges produce specific copy, and submitted values are not replaced with blanks.
- [ ] Run the focused tests and confirm the failures describe the current value-loss behavior.
- [ ] Select and parse the complete basics projection and pass it to `TryoutWizard`.
- [ ] Render deterministic local datetime values and field-level guidance; map known error codes to actionable messages.
- [ ] Run focused tests and typecheck.

### Task 2: Make participants a first-class tryout workspace

**Files:**
- Modify: `src/app/(app)/app/[organizationSlug]/tryouts/[tryoutId]/overview/page.tsx`
- Modify: `src/app/(app)/app/[organizationSlug]/tryouts/[tryoutId]/registration/page.tsx`
- Create: `src/modules/tryouts/ui/tryout-action-plan.tsx`
- Create: `src/modules/registration/ui/participant-workspace-header.tsx`
- Test: `tests/unit/tryouts/tryout-action-plan.test.tsx`
- Test: `tests/unit/registration/staff-registration-and-qr.test.ts`

**Interfaces:**
- Produces: stage-based actions for Prepare, Participants, Run tryout, Decisions, and Complete.
- Reuses: the existing staff registration action, returning-athlete search, public registration share, QR issuance, CSV import route, and registration records.

- [ ] Write failing component tests for a primary Add participant action, adjacent Share registration link action, returning-athlete discovery, participant count, and stage-specific next action.
- [ ] Run focused tests and confirm the actions are currently hidden or generically labeled.
- [ ] Add the tryout action plan to the overview and relabel the staff registration route presentation as Participants.
- [ ] Place new-athlete and returning-athlete choices at the top, recent participants below, and public sharing/import as secondary actions.
- [ ] Run focused tests and the existing registration integration test.

### Task 3: Make the tryout list operational

**Files:**
- Modify: `src/app/(app)/app/[organizationSlug]/tryouts/page.tsx`
- Create: `src/modules/tryouts/ui/tryout-card.tsx`
- Test: `tests/unit/tryouts/tryout-card.test.tsx`

**Interfaces:**
- Produces: compact tryout cards with status, updated time, next action, and direct Participants access when published.
- Consumes: the existing tryout list projection; counts remain optional to avoid a new unbounded query.

- [ ] Write failing tests for draft and published card actions and compact semantic structure.
- [ ] Run the focused test and confirm current generic cards fail.
- [ ] Implement `TryoutCard` and replace the sparse list markup.
- [ ] Run focused tests and typecheck.

### Task 4: Compact the dashboard and repair mobile navigation

**Files:**
- Modify: `src/components/layout/mobile-nav.tsx`
- Modify: `src/components/layout/app-navigation.tsx`
- Modify: `src/app/globals.css`
- Modify: `src/modules/organizations/components/onboarding-checklist.tsx`
- Test: `tests/unit/components/design-system.test.tsx`
- Test: `tests/unit/organizations/app-navigation.test.tsx`

**Interfaces:**
- Produces: a bounded grouped mobile navigation sheet and content-hugging dashboard/tryout cards.
- Consumes: existing `NavigationGroup` labels instead of presenting icon category numbers as a false workflow sequence.

- [ ] Write failing tests for grouped More navigation, an explicit close affordance, visible sign-out, and unique non-sequential icon treatment.
- [ ] Run focused tests and confirm the current flat numbered menu fails.
- [ ] Render grouped sections in the mobile sheet and add a clear close/summary state.
- [ ] Adjust responsive CSS so metric, checklist, and tryout cards hug content on small screens.
- [ ] Run focused tests and responsive browser checks at 320px, 390px, and desktop.

### Task 5: Verify the complete guided flow

**Files:**
- Modify: `tests/e2e/final-remediation.spec.ts`
- Modify: `tests/e2e/responsive-and-accessibility.spec.ts`
- Create: `.superpowers/sdd/2026-09-01-guided-tryout-flow/report.md`

**Interfaces:**
- Verifies: saved basics reload, published tryout → Participants, new and returning athlete paths, stage navigation, mobile menu, and compact responsive layout.

- [ ] Add browser assertions for persisted basics and the primary participant journey.
- [ ] Run the focused Chromium flow with retries disabled.
- [ ] Run the responsive Chromium/WebKit/Mobile Safari slice with retries disabled and axe checks.
- [ ] Run format, lint, typecheck, focused unit/integration tests, production build, and `git diff --check`.
- [ ] Record exact evidence and remaining external prerequisites in the report.
