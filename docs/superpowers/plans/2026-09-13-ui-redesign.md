# TryoutFlow UI redesign implementation plan

**Goal:** Apply the supplied September 13 visual reference across the existing product, retaining working behavior and production contracts.
**Authority:** User's full brief in the attached pasted-text.txt and supplied reference image.
**Architecture:** Shared CSS tokens and primitives, shared application/public/auth shells, targeted presentation changes in workflow components. Existing server loaders, actions, API, permissions, calculations and migrations remain intact. Data displayed must come from existing projections.
**Stack:** Next 16.3.3, React 19, existing Tailwind and lucide-react, Playwright/Vitest.

## Application map and audit
- Public: home, features, pricing, demo, team/club/association pages, legal pages; shared MarketingShell and ProductProof.
- Identity: sign-in/up, password reset/recovery, verify email, invitation and organization start; shared AuthShell.
- Organization: home command center, athletes/list/profile/import/duplicates, evaluators, reports, account.
- Administration: members, settings/branding, integrations, billing, audit. Owner/administrator navigation; billing owner only.
- Tryouts: list/new, overview, guided setup/[step], registration builder, sessions, staff, check-in, live, rankings, comparison, rosters/export, messages, reports.
- Evaluator: assigned sessions, athlete queue, scorecard, progress and profile; scoped assignments remain authoritative.
- Public registration and confirmation: dynamic configurable fields with enabled-waiver enforcement.
- Platform administration: organization/support/subscriptions/audit/health; retains restricted shell and authorization.
- Shared design: theme.css and globals.css, PageHeader, Metric, Surface, Button, inputs, StatusBadge, feedback states. No public photo library exists in repository.
- Existing mismatch: beige canvas, lime highlights, heavy typography/shadows and 288px sidebar. Data tables and many fields already use shared CSS variables. Guided setup, rubric editing, rosters and check-in already exist and must not be replaced.
- Baseline: all source copies/hashes, prior dirty diff and full route list preserved in output/ui-redesign-20260913. Work on codex branch without stashing or deleting existing changes.

## Task 1: Shared visual system and shell
1. Apply navy/blue/white/orange palette; 8px controls, 10px cards, subtle borders and shadows; preserve accessible game-day mode with restrained blue.
2. Standardize headings, tables, forms, focus states and responsive sizing through shared primitives and CSS.
3. Add reusable vector wordmark inspired by reference and compact utility bar using permitted existing links; preserve role-derived navigation and mobile menu.
4. Validate typecheck, existing navigation/component tests and browser widths.

## Task 2: Dashboard and workflow presentation
1. Recompose command center with welcome header, four real metrics, operational progress, existing next actions and practical quick links.
2. Audit all workflow component markup, normalize headers/tables/card density and mobile layouts without deleting controls.
3. Preserve guided creation and rubric/selection/roster state machines; all server actions unchanged.
4. Run relevant existing suites and local end-to-end primary lifecycle.

## Task 3: Public, auth and registration surfaces
1. Replace decorative marketing shapes with purposeful athletic composition, navy typography, sparse orange and appropriate sports imagery.
2. Apply shared brand and typography to public/auth pages.
3. Improve configurable registration presentation while preserving field order, values, errors, waiver validation and submit contract. Retain all existing information; no invented public facts.
4. Verify public/auth routes and registration persistence/validation at desktop/tablet/mobile.

## Task 4: Verification and final review
1. Run typecheck, lint, unit suite and production build; record baseline-related failures separately.
2. Use existing isolated local E2E fixtures for roles and primary workflow; no external email/messages or real billing.
3. Browser audit every major route group at 1440/768/390 widths, inspect screenshots, errors, focus, overflow and menus; fix and retest failures.
4. Review scoped source diff versus saved baseline, confirm backend untouched, deliver evidence and exact remaining limitations. No deployment requested.
