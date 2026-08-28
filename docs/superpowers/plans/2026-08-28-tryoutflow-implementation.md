# TryoutFlow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the production-quality TryoutFlow MVP described in the approved architecture specification, from organization onboarding through idempotent finalized-roster export.

**Architecture:** Implement a modular Next.js monolith with domain modules, typed application commands, Supabase PostgreSQL/Auth/RLS, and narrow infrastructure adapters. PostgreSQL is authoritative; evaluator devices use a scoped IndexedDB outbox, and durable server side effects use a PostgreSQL job outbox.

**Tech Stack:** Node.js 24.12.0, npm 11.12.1, Next.js 16.3.3, React 19.2.8, TypeScript 7.0.2, Tailwind CSS 4.3.3, Supabase CLI 2.116.0, `@supabase/supabase-js` 2.112.4, `@supabase/ssr` 0.12.5, Zod 4.5.1, Vitest 4.1.11, Playwright 1.62.1, Dexie 4.4.5, Stripe 22.6.0, Resend 6.25.0, Radix UI primitives, and Vercel.

**Spec:** `docs/superpowers/specs/2026-08-28-tryoutflow-design.md`

## Verified Dependency Baseline

Registry versions were checked on 2026-08-28. Before Task 1 installs them, confirm the same versions remain current and compatible in the official [Next.js installation guide](https://nextjs.org/docs/app/getting-started/installation), [Supabase SSR guidance](https://supabase.com/docs/guides/auth/choosing-a-server-package), and [Tailwind installation guide](https://tailwindcss.com/docs/installation).

| Package | Version |
|---|---:|
| `next`, `eslint-config-next` | 16.3.3 |
| `react`, `react-dom` | 19.2.8 |
| `typescript` | 7.0.2 |
| `tailwindcss`, `@tailwindcss/postcss` | 4.3.3 |
| `@supabase/supabase-js` | 2.112.4 |
| `@supabase/ssr` | 0.12.5 |
| `supabase` | 2.116.0 |
| `zod` | 4.5.1 |
| `decimal.js` | 10.6.0 |
| `vitest`, `@vitest/coverage-v8` | 4.1.11 |
| `@playwright/test` | 1.62.1 |
| `@testing-library/react` | 16.3.3 |
| `@testing-library/jest-dom` | 7.0.1 |
| `@testing-library/user-event` | 14.6.6 |
| `@axe-core/playwright` | 4.13.0 |
| `dexie` | 4.4.5 |
| `fake-indexeddb` | 6.2.5 |
| `react-hook-form` | 7.86.0 |
| `@hookform/resolvers` | 5.9.1 |
| `@dnd-kit/core` | 6.3.1 |
| `@dnd-kit/sortable` | 10.0.0 |
| `stripe` | 22.6.0 |
| `resend` | 6.25.0 |
| `papaparse`, `@types/papaparse` | 5.7.0, 5.5.2 |
| `qrcode`, `@types/qrcode` | 1.5.4, 1.5.6 |
| `lucide-react` | 1.35.0 |
| `@radix-ui/react-dialog` | 1.1.23 |
| `@radix-ui/react-select` | 2.3.7 |
| `@radix-ui/react-tooltip` | 1.2.16 |
| `recharts` | 3.10.1 |
| `pino`, `pino-pretty` | 10.3.1, 13.1.3 |

## Global Constraints

- Read the specification before every task and preserve its explicit MVP exclusions.
- Use Node.js 24.12.0 and npm 11.12.1; commit `package-lock.json` and use `npm ci` in CI.
- Use Next.js App Router and `src/proxy.ts`; Next.js 16 does not run lint during `next build`, so lint is a separate required command.
- Keep TypeScript strict; do not introduce broad `any`, unchecked casts, or client-exposed service credentials.
- Write a failing test first, confirm the expected failure, implement the minimum behavior, refactor only after green, and run related regressions.
- Every tenant-bound schema change includes `organization_id`, RLS, tenant-safe constraints, indexes, allowed tests, and denied tests in the same task.
- Every public or privileged mutation validates with Zod, authorizes on the server, and returns typed validation, permission, conflict, or unexpected errors.
- Individual evaluator scores are integers on 1–5 or 1–10 scales; internal score math uses deterministic decimal semantics and rounds only for display.
- Incomplete evaluations never count as zero; genuine ties retain equal rank; numerical rank never selects an athlete automatically.
- Selection, roster placement, finalization, communication, and synchronization remain distinct states and actions.
- Offline behavior is limited to assigned evaluator scoring and never claims server persistence before acknowledgment.
- The Squad integration remains a disabled, clearly labeled mock until documented authenticated APIs exist.
- Stripe handles TryoutFlow subscriptions only; guardian registration payments and Stripe Connect remain excluded.
- Each task ends with fresh tests, changed-file review, `git diff --check`, and a logical commit; never continue past a failed required check.
- Before declaring any phase complete, run formatting, lint, typecheck, phase tests, production build, and proportional Playwright coverage.

## Repository Map

```text
src/
  app/
    (marketing)/                 public marketing, pricing, demo, privacy, terms
    (auth)/                      sign-in, start, callback, invitations
    (registration)/              guardian-facing registration and confirmation
    (app)/app/[organizationSlug]/ organization application and evaluator routes
    api/                          webhooks, jobs, sync, CSV, and controlled public commands
  components/
    ui/                           accessible design-system primitives
    layout/                       marketing, desktop, and mobile shells
    feedback/                     empty, loading, denied, offline, and error states
  modules/
    identity/ organizations/ subscriptions/ tryouts/ registration/ athletes/
    checkin/ staffing/ rubrics/ evaluations/ scoring/ rankings/ rosters/
    communications/ reports/ integrations/ audit/ observability/
  infrastructure/
    supabase/                     browser, server, admin, and generated database types
    jobs/                         PostgreSQL outbox claiming and dispatch
    email/                        Resend and fake adapters
    billing/                      Stripe and fake adapters
    integrations/                provider registry and mock The Squad adapter
    analytics/                    privacy-safe event adapter
  lib/                            identifiers, result types, clocks, pagination, env parsing
supabase/
  config.toml
  migrations/                    ordered schema, policies, functions, indexes, and grants
  tests/                         pgTAP RLS, constraint, and database-function tests
  seed.sql                       deterministic demo and authorization fixtures
tests/
  unit/                           pure domain and component tests
  integration/                    application commands against local Supabase
  contract/                       email, billing, and integration adapter suites
  e2e/                            Playwright desktop and mobile scenarios
docs/
  operations/                     environment, deployment, privacy, and incident runbooks
.github/workflows/ci.yml          deterministic verification pipeline
```

The implementation may add focused files inside these directories, but it must not replace domain boundaries with generic `services.ts`, `utils.ts`, or giant route components.

---

## Phase 1 — Repository foundation, CI, design tokens, and database foundation

### Task 1: Scaffold the strict Next.js toolchain and CI baseline

**Files:**
- Create: `package.json`
- Create: `package-lock.json`
- Create: `.nvmrc`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `tsconfig.json`
- Create: `next.config.ts`
- Create: `postcss.config.mjs`
- Create: `eslint.config.mjs`
- Create: `.prettierrc.json`
- Create: `vitest.config.ts`
- Create: `vitest.integration.config.ts`
- Create: `tests/setup.ts`
- Create: `playwright.config.ts`
- Create: `src/app/layout.tsx`
- Create: `src/app/page.tsx`
- Create: `src/app/globals.css`
- Create: `tests/unit/smoke.test.ts`
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: none.
- Produces: scripts `dev`, `build`, `start`, `lint`, `typecheck`, `format:check`, `test:unit`, `test:integration`, `test:db`, `test:e2e`, and `verify`; import alias `@/*`; Node/npm version contract.

- [ ] **Step 1: Write the failing repository smoke test**

```ts
import { describe, expect, it } from 'vitest';

describe('repository foundation', () => {
  it('runs strict TypeScript tests', () => {
    const product: 'TryoutFlow' = 'TryoutFlow';
    expect(product).toBe('TryoutFlow');
  });
});
```

- [ ] **Step 2: Run the test before the runner exists**

Run: `npm test -- --run tests/unit/smoke.test.ts`

Expected: FAIL because `package.json` and the test runner do not exist.

- [ ] **Step 3: Create the pinned toolchain and scripts**

Set `engines.node` to `>=24.12.0 <25`, install the exact versions in the Verified Dependency Baseline, and configure Next.js App Router, Tailwind's PostCSS plugin, strict TypeScript, Vitest `jsdom`, Playwright projects, Prettier, ESLint CLI, and CI. Include `.superpowers/`, `.env*` except `.env.example`, `.next/`, `coverage/`, `playwright-report/`, and Supabase temporary files in `.gitignore`.

Core verification script:

```json
{
  "scripts": {
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "format:check": "prettier --check .",
    "test": "npm run test:unit",
    "test:unit": "vitest run --config vitest.config.ts tests/unit",
    "test:integration": "vitest run --config vitest.integration.config.ts tests/integration",
    "test:contract": "vitest run --config vitest.integration.config.ts tests/contract",
    "test:db": "supabase test db",
    "test:e2e": "playwright test",
    "build": "next build",
    "verify": "npm run format:check && npm run lint && npm run typecheck && npm run test:unit && npm run build"
  }
}
```

- [ ] **Step 4: Run foundation verification**

Run: `npm ci && npm run verify`

Expected: all commands exit 0; Next.js production build succeeds.

- [ ] **Step 5: Review and commit**

Run: `git diff --check && git status --short && git diff --stat`

Commit: `git commit -am "chore: establish TryoutFlow application foundation"` after explicitly staging all Task 1 files.

### Task 2: Establish design tokens and accessible primitives

**Files:**
- Create: `src/app/theme.css`
- Create: `src/components/ui/button.tsx`
- Create: `src/components/ui/input.tsx`
- Create: `src/components/ui/status-badge.tsx`
- Create: `src/components/ui/focus-ring.ts`
- Create: `src/components/feedback/empty-state.tsx`
- Create: `src/components/feedback/error-state.tsx`
- Create: `src/components/feedback/loading-state.tsx`
- Create: `src/components/layout/app-shell.tsx`
- Create: `src/components/layout/mobile-nav.tsx`
- Test: `tests/unit/components/design-system.test.tsx`

**Interfaces:**
- Consumes: Tailwind CSS and React foundation from Task 1.
- Produces: `Button`, `Input`, `StatusBadge`, `EmptyState`, `ErrorState`, `LoadingState`, `AppShell`, and `MobileNav`; semantic color and motion tokens.

- [ ] **Step 1: Write failing accessibility and token tests**

```tsx
it('exposes a visible accessible primary action', async () => {
  render(<Button>Publish tryout</Button>);
  expect(screen.getByRole('button', { name: 'Publish tryout' })).toBeEnabled();
  expect(document.documentElement).toHaveStyle({ colorScheme: 'light' });
});
```

Also assert 44 px mobile target tokens, reduced-motion overrides, electric-blue focus, and non-color status labels.

- [ ] **Step 2: Verify the design tests fail**

Run: `npm run test:unit -- tests/unit/components/design-system.test.tsx`

Expected: FAIL because the components and tokens do not exist.

- [ ] **Step 3: Implement the minimal TryoutFlow visual foundation**

Define role-based tokens for canvas, surface, text, muted text, primary blue, performance lime, selection coral, destructive red, focus, radius, shadow, spacing, duration, and score/bib typography. Build semantic primitives with forwarded refs, disabled/busy states, visible focus, and no dark-dashboard defaults.

- [ ] **Step 4: Verify components and responsive shell**

Run: `npm run test:unit -- tests/unit/components/design-system.test.tsx && npm run typecheck && npm run build`

Expected: PASS with no hydration or type errors.

- [ ] **Step 5: Review and commit**

Run: `git diff --check && git diff -- src/app/theme.css src/components`

Commit: `git commit -m "feat: add TryoutFlow accessible design foundation"`.

### Task 3: Initialize Supabase and shared tenant primitives

**Files:**
- Create: `supabase/config.toml`
- Create: `supabase/migrations/202608280001_extensions_and_primitives.sql`
- Create: `supabase/migrations/202608280002_profiles_organizations.sql`
- Create: `supabase/tests/001_primitives.test.sql`
- Create: `src/infrastructure/supabase/database.types.ts`
- Create: `src/lib/ids.ts`
- Create: `src/lib/result.ts`
- Create: `src/lib/env.ts`
- Create: `src/lib/clock.ts`
- Create: `src/modules/audit/application/append-audit-event.ts`
- Test: `tests/unit/lib/ids.test.ts`
- Test: `tests/integration/audit/append-audit-event.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: environment and scripts from Task 1.
- Produces: branded UUID types, `AppResult<T, E>`, validated environment access, injectable `Clock`, `AuditWriter.append(event)`, organization/profile/audit tables, tenant composite-key convention, and local database scripts.

- [ ] **Step 1: Write failing pgTAP and TypeScript tests**

```sql
select has_table('public', 'organizations');
select has_column('public', 'organizations', 'id');
select has_column('public', 'organizations', 'slug');
select col_is_unique('public', 'organizations', 'slug');
```

```ts
expect(parseOrganizationId(crypto.randomUUID())).toMatch(/[0-9a-f-]{36}/);
expect(() => parseOrganizationId('bad-id')).toThrow();
```

- [ ] **Step 2: Verify the schema tests fail**

Run: `npx supabase start && npx supabase db reset && npx supabase test db && npm run test:unit -- tests/unit/lib/ids.test.ts`

Expected: FAIL because migrations and identifier parsers are missing.

- [ ] **Step 3: Implement extensions, primitives, profiles, and organizations**

Enable required PostgreSQL extensions, create timestamps and constrained slugs, use UUID keys, add `(organization_id, id)` unique pairs for tenant descendants, add append-only audit records without private metadata, enable RLS immediately, and generate database types with `npx supabase gen types typescript --local`.

- [ ] **Step 4: Verify clean migration and tests**

Run: `npx supabase db reset && npx supabase test db && npm run test:unit -- tests/unit/lib && npm run typecheck`

Expected: migrations apply from zero and all assertions pass.

- [ ] **Step 5: Review and commit**

Run: `git diff --check && git diff -- supabase src/lib src/infrastructure/supabase`

Commit: `git commit -m "feat: establish database and tenant primitives"`.

---

## Phase 2 — Authentication, organizations, tenancy, roles, and RLS

### Task 4: Add Supabase SSR authentication

**Files:**
- Create: `src/infrastructure/supabase/client.ts`
- Create: `src/infrastructure/supabase/server.ts`
- Create: `src/infrastructure/supabase/admin.ts`
- Create: `src/proxy.ts`
- Create: `src/modules/identity/application/sign-in.ts`
- Create: `src/modules/identity/application/sign-out.ts`
- Create: `src/app/(auth)/sign-in/page.tsx`
- Create: `src/app/(auth)/auth/callback/route.ts`
- Create: `src/app/(auth)/invite/[token]/page.tsx`
- Test: `tests/unit/identity/authentication.test.ts`
- Test: `tests/e2e/authentication.spec.ts`

**Interfaces:**
- Consumes: environment parser and Supabase types.
- Produces: `createBrowserSupabaseClient()`, `createServerSupabaseClient()`, server-only `createAdminSupabaseClient()`, `signInWithPassword`, `signOut`, and protected-route session refresh.

- [ ] **Step 1: Write failing session-boundary tests**

```ts
it('redirects an anonymous app request to sign in with a safe return path', async () => {
  const response = await proxy(requestFor('/app/badlands/home'));
  expect(response.headers.get('location')).toContain('/sign-in?next=%2Fapp%2Fbadlands%2Fhome');
});
```

Test invalid `next` URLs, expired callbacks, and invitation-token errors.

- [ ] **Step 2: Verify authentication tests fail**

Run: `npm run test:unit -- tests/unit/identity/authentication.test.ts`

Expected: FAIL because clients, proxy, and commands are absent.

- [ ] **Step 3: Implement cookie-based SSR authentication**

Follow current Supabase SSR guidance, use publishable keys for caller-scoped clients, keep secret/admin keys server-only, validate safe internal redirects, and show useful recovery states.

- [ ] **Step 4: Verify auth unit and browser flows**

Run: `npm run test:unit -- tests/unit/identity && npm run typecheck && npx playwright test tests/e2e/authentication.spec.ts --project=chromium`

Expected: password sign-in, sign-out, callback, invitation, and anonymous redirect pass.

- [ ] **Step 5: Review and commit**

Run: `git diff --check && git diff -- src/infrastructure/supabase src/modules/identity src/proxy.ts src/app/'(auth)'`

Commit: `git commit -m "feat: add secure Supabase authentication"`.

### Task 5: Implement organization membership and capability authorization

**Files:**
- Create: `supabase/migrations/202608280003_memberships_and_assignments.sql`
- Create: `supabase/tests/002_tenant_isolation.test.sql`
- Create: `src/modules/organizations/domain/roles.ts`
- Create: `src/modules/organizations/application/capabilities.ts`
- Create: `src/modules/organizations/application/require-capability.ts`
- Create: `src/modules/organizations/infrastructure/membership-repository.ts`
- Test: `tests/unit/organizations/capabilities.test.ts`
- Test: `tests/integration/organizations/tenant-isolation.test.ts`

**Interfaces:**
- Consumes: authenticated user ID and branded organization/tryout/session IDs.
- Produces: `OrganizationRole`, `ScopedRole`, `Capability`, `AuthorizationContext`, `can(context, capability, resource)`, and `requireCapability(...)`.

- [ ] **Step 1: Write the denied and allowed tests first**

```ts
expect(can(evaluatorContext, 'evaluation:update-own', assignedEvaluation)).toBe(true);
expect(can(evaluatorContext, 'ranking:read', assignedTryout)).toBe(false);
expect(can(checkinContext, 'evaluation:read', assignedTryout)).toBe(false);
expect(can(ownerAContext, 'athlete:read', organizationBAthlete)).toBe(false);
```

Add pgTAP cases for owner A/B, assigned/unassigned evaluator, check-in score denial, reviewer mutation denial, and anonymous athlete-table denial.

- [ ] **Step 2: Verify policy tests fail**

Run: `npx supabase db reset && npx supabase test db && npm run test:unit -- tests/unit/organizations/capabilities.test.ts`

Expected: FAIL because roles, policies, and assignments are missing.

- [ ] **Step 3: Implement current-record capabilities and RLS**

Create organization memberships, invitations, scoped staff assignments, policy helper functions, indexes, and RLS. Do not use mutable JWT role claims as authority. Keep platform support elevation separate, expiring, reasoned, and audited.

- [ ] **Step 4: Run authorization regressions**

Run: `npx supabase db reset && npx supabase test db && npm run test:unit -- tests/unit/organizations && npm run test:integration -- tests/integration/organizations`

Expected: every allow and deny case passes.

- [ ] **Step 5: Review and commit**

Run: `git diff --check && git diff -- supabase/migrations/202608280003_memberships_and_assignments.sql supabase/tests/002_tenant_isolation.test.sql src/modules/organizations`

Commit: `git commit -m "feat: enforce tenant roles and scoped capabilities"`.

### Task 6: Build organization onboarding and member invitations

**Files:**
- Create: `src/modules/organizations/domain/organization.ts`
- Create: `src/modules/organizations/application/create-organization.ts`
- Create: `src/modules/organizations/application/invite-member.ts`
- Create: `src/modules/organizations/application/accept-invitation.ts`
- Create: `src/modules/organizations/application/update-organization-settings.ts`
- Create: `src/modules/organizations/application/invitation-notifier.ts`
- Create: `src/app/(auth)/start/page.tsx`
- Create: `src/app/(app)/app/[organizationSlug]/layout.tsx`
- Create: `src/app/(app)/app/[organizationSlug]/home/page.tsx`
- Create: `src/app/(app)/app/[organizationSlug]/organization/members/page.tsx`
- Create: `src/app/(app)/app/[organizationSlug]/organization/settings/page.tsx`
- Test: `tests/integration/organizations/onboarding.test.ts`
- Test: `tests/e2e/onboarding.spec.ts`

**Interfaces:**
- Consumes: authenticated user, organization repository, and temporary port `InvitationNotifier.enqueue(...)` backed by a test fake until Task 22 wires the durable email adapter.
- Produces: `createOrganization(input, actor)`, `inviteMember(input, actor)`, `acceptInvitation(token, actor)`, `updateOrganizationSettings`, terminology/timezone/sport/tag defaults, active organization shell, and onboarding checklist state.

- [ ] **Step 1: Write failing onboarding tests**

```ts
it('creates an organization and owner membership atomically', async () => {
  const result = await createOrganization(validInput, signedInUser);
  expect(result.organization.slug).toBe('badlands-hockey-academy');
  expect(result.membership.role).toBe('owner');
});
```

Test slug collision, invitation expiry, wrong email, duplicate membership, and unauthorized role assignment.

- [ ] **Step 2: Confirm the tests fail**

Run: `npm run test:integration -- tests/integration/organizations/onboarding.test.ts`

Expected: FAIL because onboarding commands and pages are missing.

- [ ] **Step 3: Implement the transaction and focused UI**

Create an organization plus owner membership in one transaction, reserve normalized slugs, support terminology/timezone/sport/tag defaults, provide invitation preview and confirmation, and show an onboarding checklist rather than an empty dashboard.

- [ ] **Step 4: Verify onboarding end to end**

Run: `npm run test:integration -- tests/integration/organizations/onboarding.test.ts && npx playwright test tests/e2e/onboarding.spec.ts --project=chromium`

Expected: creation, invitation acceptance, and direct URL authorization pass.

- [ ] **Step 5: Review and commit**

Run: `git diff --check && git diff -- src/modules/organizations src/app/'(auth)'/start src/app/'(app)'`

Commit: `git commit -m "feat: add organization onboarding and invitations"`.

---

## Phase 3 — Tryout creation, divisions, sessions, and rubrics

### Task 7: Model tryout configuration and lifecycle

**Files:**
- Create: `supabase/migrations/202608280004_tryout_configuration.sql`
- Create: `supabase/tests/003_tryout_integrity.test.sql`
- Create: `src/modules/tryouts/domain/tryout.ts`
- Create: `src/modules/tryouts/domain/lifecycle.ts`
- Create: `src/modules/tryouts/application/create-tryout.ts`
- Create: `src/modules/tryouts/application/update-tryout-step.ts`
- Test: `tests/unit/tryouts/lifecycle.test.ts`
- Test: `tests/integration/tryouts/configuration.test.ts`

**Interfaces:**
- Consumes: organization context, `Clock`, and `requireCapability`.
- Produces: `TryoutStatus`, `TryoutDraft`, `createTryout`, `updateTryoutStep`, and normalized season/division/session/group/position records.

- [ ] **Step 1: Write failing lifecycle and integrity tests**

```ts
expect(transitionTryout('draft', 'publish')).toBe('published');
expect(() => transitionTryout('finalized', 'publish')).toThrow('invalid transition');
expect(validateSession({ startAt, endAt: startAt })).toEqual({ ok: false, code: 'invalid_time_range' });
```

Add database tests rejecting cross-organization sessions/divisions and duplicate position order.

- [ ] **Step 2: Verify failure before schema and domain exist**

Run: `npx supabase db reset && npx supabase test db && npm run test:unit -- tests/unit/tryouts/lifecycle.test.ts`

Expected: FAIL for missing tables and functions.

- [ ] **Step 3: Implement normalized configuration and transitions**

Create seasons, tryouts, divisions, positions, sessions, and groups with tenant-safe foreign keys, lifecycle checks, timezone-aware instants, indexes, RLS, and typed commands.

- [ ] **Step 4: Verify configuration behavior**

Run: `npx supabase db reset && npx supabase test db && npm run test:unit -- tests/unit/tryouts && npm run test:integration -- tests/integration/tryouts/configuration.test.ts`

Expected: valid drafts persist and invalid/cross-tenant configuration is rejected.

- [ ] **Step 5: Review and commit**

Run: `git diff --check && git diff -- supabase src/modules/tryouts`

Commit: `git commit -m "feat: model tryout configuration lifecycle"`.

### Task 8: Add immutable registration-form and rubric versions

**Files:**
- Create: `supabase/migrations/202608280005_forms_and_rubrics.sql`
- Create: `supabase/tests/004_rubric_integrity.test.sql`
- Create: `src/modules/registration/domain/form-schema.ts`
- Create: `src/modules/rubrics/domain/rubric.ts`
- Create: `src/modules/rubrics/application/publish-rubric-version.ts`
- Test: `tests/unit/rubrics/rubric.test.ts`
- Test: `tests/integration/rubrics/versioning.test.ts`

**Interfaces:**
- Consumes: tryout/division/session identifiers and capability checks.
- Produces: `RegistrationFormSchema`, `RubricDraft`, `RubricVersion`, `validateWeightTotal`, and `publishRubricVersion`.

- [ ] **Step 1: Write failing validation and immutability tests**

```ts
expect(validateWeightTotal([{ weight: 30 }, { weight: 70 }])).toEqual({ ok: true });
expect(validateWeightTotal([{ weight: 30 }, { weight: 60 }])).toEqual({ ok: false, code: 'weights_must_total_100' });
expect(validateScale({ min: 1, max: 7 })).toEqual({ ok: false, code: 'unsupported_scale' });
```

Add integration tests proving a used rubric version cannot change and a revision creates a new version.

- [ ] **Step 2: Verify tests fail**

Run: `npx supabase db reset && npx supabase test db && npm run test:unit -- tests/unit/rubrics/rubric.test.ts`

Expected: FAIL because form/rubric versioning is absent.

- [ ] **Step 3: Implement versioned schemas and publishing rules**

Store validated form schemas and ordered rubric categories, support only 1–5 and 1–10 integer inputs, require exact decimal weight total 100, and prevent in-place edits after an evaluation references a version.

- [ ] **Step 4: Verify versioning and generated types**

Run: `npx supabase db reset && npx supabase test db && npm run test:unit -- tests/unit/rubrics && npm run test:integration -- tests/integration/rubrics && npm run typecheck`

Expected: all weight, scale, ordering, and immutability tests pass.

- [ ] **Step 5: Review and commit**

Run: `git diff --check && git diff -- supabase/migrations/202608280005_forms_and_rubrics.sql src/modules/rubrics src/modules/registration/domain`

Commit: `git commit -m "feat: add versioned forms and evaluation rubrics"`.

### Task 9: Build the resumable tryout wizard and explicit publishing

**Files:**
- Create: `src/modules/tryouts/application/publish-tryout.ts`
- Create: `src/modules/tryouts/ui/tryout-wizard.tsx`
- Create: `src/modules/tryouts/ui/wizard-progress.tsx`
- Create: `src/modules/tryouts/ui/registration-share.tsx`
- Create: `src/app/(app)/app/[organizationSlug]/tryouts/page.tsx`
- Create: `src/app/(app)/app/[organizationSlug]/tryouts/new/page.tsx`
- Create: `src/app/(app)/app/[organizationSlug]/tryouts/[tryoutId]/setup/[step]/page.tsx`
- Create: `src/app/(app)/app/[organizationSlug]/tryouts/[tryoutId]/overview/page.tsx`
- Test: `tests/integration/tryouts/publish.test.ts`
- Test: `tests/e2e/tryout-wizard.spec.ts`

**Interfaces:**
- Consumes: Tasks 7–8 configuration commands and `requireCapability('tryout:publish')`.
- Produces: `validateTryoutForPublish`, `publishTryout`, seven-step wizard, draft resume, review summary, confirmation dialog, public registration URL, and generated QR code.

- [ ] **Step 1: Write failing publish tests**

```ts
it('rejects publication when rubric weights total 90', async () => {
  const result = await publishTryout(incompleteTryoutId, directorContext);
  expect(result).toEqual({ ok: false, error: { code: 'rubric_invalid' } });
});
```

Test missing division/session/form, closed registration dates, unauthorized actor, double click, and successful audit entry.

- [ ] **Step 2: Verify publish tests fail**

Run: `npm run test:integration -- tests/integration/tryouts/publish.test.ts`

Expected: FAIL because publication command and audit record do not exist.

- [ ] **Step 3: Implement wizard steps and atomic publication**

Persist each valid step, show one focused step per route, summarize blockers, require typed confirmation, atomically publish form/rubric versions and tryout state, generate the public URL/QR code, and write an audit event.

- [ ] **Step 4: Verify desktop and mobile wizard flows**

Run: `npm run test:integration -- tests/integration/tryouts/publish.test.ts && npx playwright test tests/e2e/tryout-wizard.spec.ts --project=chromium --project='Mobile Safari'`

Expected: draft resume and confirmed publication pass without horizontal overflow.

- [ ] **Step 5: Review and commit**

Run: `git diff --check && git diff -- src/modules/tryouts src/app/'(app)'`

Commit: `git commit -m "feat: add guided tryout setup and publishing"`.

---

## Phase 4 — Athlete registration, CSV import, check-in, and number assignment

### Task 10: Implement athlete, guardian, and controlled public registration

**Files:**
- Create: `supabase/migrations/202608280006_athletes_and_registration.sql`
- Create: `supabase/tests/005_registration_security.test.sql`
- Create: `src/modules/athletes/domain/athlete.ts`
- Create: `src/modules/registration/domain/duplicate-detection.ts`
- Create: `src/modules/registration/application/register-athlete.ts`
- Create: `src/modules/registration/application/public-registration-rate-limiter.ts`
- Create: `src/infrastructure/registration/postgres-registration-rate-limiter.ts`
- Create: `src/app/(registration)/register/[tryoutSlug]/page.tsx`
- Create: `src/app/(registration)/register/[tryoutSlug]/confirmation/page.tsx`
- Create: `src/app/api/public/registrations/route.ts`
- Test: `tests/unit/registration/duplicate-detection.test.ts`
- Test: `tests/integration/registration/public-registration.test.ts`
- Test: `tests/e2e/guardian-registration.spec.ts`

**Interfaces:**
- Consumes: published tryout, immutable form version, `Clock`, `PublicRegistrationRateLimiter`, and confirmation notifier.
- Produces: `RegistrationSubmission`, `DuplicateCandidate`, `PublicRegistrationRateLimiter.check(key)`, `registerAthlete`, session enrollment records, expiring confirmation token, and public registration command.

- [ ] **Step 1: Write failing privacy, validation, and duplicate tests**

```ts
expect(findDuplicateCandidates(existing, incoming)).toContainEqual(
  expect.objectContaining({ reason: 'name_birthdate_guardian_email' }),
);
expect(findDuplicateCandidates(existing, incoming)).not.toContainEqual(
  expect.objectContaining({ action: 'auto_merge' }),
);
```

Test closed registration, unknown fields, invalid form version, rate limit, replay, anonymous private-table read denial, and successful controlled write.

- [ ] **Step 2: Verify registration tests fail**

Run: `npx supabase db reset && npx supabase test db && npm run test:unit -- tests/unit/registration && npm run test:integration -- tests/integration/registration/public-registration.test.ts`

Expected: FAIL because athlete/guardian tables and controlled command are absent.

- [ ] **Step 3: Implement normalized people records and server-only registration**

Create athletes, guardians, athlete-guardian links, registrations, session enrollments, duplicate candidates, hashed confirmation tokens, and bounded registration-rate counters. Validate only the active published form, minimize collected fields, write transactionally, and enqueue confirmation without granting anonymous table access.

- [ ] **Step 4: Verify public flow and tenant denial**

Run: `npx supabase db reset && npx supabase test db && npm run test:unit -- tests/unit/registration && npm run test:integration -- tests/integration/registration && npx playwright test tests/e2e/guardian-registration.spec.ts --project=chromium --project='Mobile Chrome'`

Expected: valid submission succeeds; duplicate, privacy, replay, and cross-tenant cases behave exactly as specified.

- [ ] **Step 5: Review and commit**

Run: `git diff --check && git diff -- supabase src/modules/athletes src/modules/registration src/app/'(registration)' src/app/api/public`

Commit: `git commit -m "feat: add guardian-led athlete registration"`.

### Task 11: Add CSV preview, mapping, validation, and import

**Files:**
- Create: `supabase/migrations/202608280006_csv_imports.sql`
- Create: `src/modules/registration/application/parse-athlete-csv.ts`
- Create: `src/modules/registration/application/preview-athlete-import.ts`
- Create: `src/modules/registration/application/commit-athlete-import.ts`
- Create: `src/modules/registration/ui/csv-import-wizard.tsx`
- Create: `src/app/(app)/app/[organizationSlug]/athletes/import/page.tsx`
- Create: `src/app/(app)/app/[organizationSlug]/athletes/page.tsx`
- Create: `src/app/(app)/app/[organizationSlug]/athletes/[athleteId]/page.tsx`
- Create: `src/app/(app)/app/[organizationSlug]/athletes/duplicates/page.tsx`
- Create: `src/app/api/organizations/[organizationId]/athlete-imports/route.ts`
- Test: `tests/unit/registration/csv-import.test.ts`
- Test: `tests/integration/registration/csv-import.test.ts`
- Fixture: `tests/fixtures/athletes/valid-and-invalid.csv`

**Interfaces:**
- Consumes: Task 10 athlete/registration command and duplicate detector.
- Produces: `CsvColumnMapping`, `ImportPreviewRow`, `AthleteImportPreview`, `previewAthleteImport`, and `commitAthleteImport(previewId, selectedRows, actor)`.

- [ ] **Step 1: Write failing import tests with real fixture rows**

```ts
expect(preview.rows).toMatchObject([
  { row: 2, status: 'valid' },
  { row: 3, status: 'duplicate_candidate' },
  { row: 4, status: 'invalid', errors: ['birth_date_invalid'] },
]);
```

Test formula injection escaping, oversized files, unknown columns, unauthorized commit, and repeated commit idempotency.

- [ ] **Step 2: Verify import tests fail**

Run: `npm run test:unit -- tests/unit/registration/csv-import.test.ts`

Expected: FAIL because parser and preview contracts are missing.

- [ ] **Step 3: Implement two-stage import**

Parse with bounded size/row limits, normalize headers, require explicit mapping, show row-level errors and duplicate candidates, persist a hashed expiring preview, provide tenant-scoped directory/detail/duplicate-review pages, and commit only confirmed valid rows transactionally in bounded batches.

- [ ] **Step 4: Verify preview and commit**

Run: `npm run test:unit -- tests/unit/registration/csv-import.test.ts && npm run test:integration -- tests/integration/registration/csv-import.test.ts && npm run typecheck`

Expected: preview is deterministic and repeated commit creates no duplicates.

- [ ] **Step 5: Review and commit**

Run: `git diff --check && git diff -- src/modules/registration src/app/'(app)'/app/'[organizationSlug]'/athletes/import src/app/api tests/fixtures/athletes`

Commit: `git commit -m "feat: add reviewable athlete CSV import"`.

### Task 12: Build concurrent-safe check-in and tryout-number assignment

**Files:**
- Create: `supabase/migrations/202608280007_checkins_and_numbers.sql`
- Create: `supabase/tests/006_checkin_integrity.test.sql`
- Create: `src/modules/checkin/domain/number-scope.ts`
- Create: `src/modules/checkin/application/check-in-athlete.ts`
- Create: `src/modules/checkin/application/assign-tryout-number.ts`
- Create: `src/modules/checkin/ui/checkin-workspace.tsx`
- Create: `src/app/(app)/app/[organizationSlug]/tryouts/[tryoutId]/check-in/page.tsx`
- Test: `tests/integration/checkin/concurrency.test.ts`
- Test: `tests/e2e/checkin.spec.ts`

**Interfaces:**
- Consumes: registration/session/group records and `checkin:update` capability.
- Produces: `NumberScope`, `assignTryoutNumber`, `checkInAthlete`, search result summaries that exclude scores, and idempotent check-in receipts.

- [ ] **Step 1: Write failing concurrency and permission tests**

```ts
const [first, second] = await Promise.all([
  assignTryoutNumber({ registrationId: a, requested: 42 }, staffOne),
  assignTryoutNumber({ registrationId: b, requested: 42 }, staffTwo),
]);
expect([first.ok, second.ok].sort()).toEqual([false, true]);
```

Test repeated check-in, division-scoped numbers, withdrawn athlete, missing information, and absence of ranking fields from results.

- [ ] **Step 2: Verify check-in tests fail**

Run: `npx supabase db reset && npx supabase test db && npm run test:integration -- tests/integration/checkin/concurrency.test.ts`

Expected: FAIL because number constraints and transaction functions are absent.

- [ ] **Step 3: Implement transactional assignment and fast search UI**

Use partial unique indexes and one transaction for number/session/group/check-in changes. Return conflict codes and the next available number. Keep phone targets large and support name, guardian, registration ID, permitted phone, QR token, and number search.

- [ ] **Step 4: Verify concurrent and mobile behavior**

Run: `npx supabase db reset && npx supabase test db && npm run test:integration -- tests/integration/checkin && npx playwright test tests/e2e/checkin.spec.ts --project=chromium --project='Mobile Safari'`

Expected: no duplicate active numbers, double check-ins, score leakage, or mobile overflow.

- [ ] **Step 5: Review and commit**

Run: `git diff --check && git diff -- supabase src/modules/checkin src/app/'(app)'`

Commit: `git commit -m "feat: add safe tryout check-in and number assignment"`.

---

## Phase 5 — Evaluator invitations, assignments, and mobile scoring

### Task 13: Implement evaluator invitations and scoped assignments

**Files:**
- Create: `src/modules/staffing/domain/assignment.ts`
- Create: `src/modules/staffing/application/invite-evaluator.ts`
- Create: `src/modules/staffing/application/assign-evaluator.ts`
- Create: `src/modules/staffing/application/list-assigned-athletes.ts`
- Create: `src/modules/staffing/ui/assignment-workspace.tsx`
- Create: `src/app/(app)/app/[organizationSlug]/tryouts/[tryoutId]/staff/page.tsx`
- Create: `src/app/(app)/app/[organizationSlug]/evaluators/page.tsx`
- Test: `tests/unit/staffing/assignment.test.ts`
- Test: `tests/integration/staffing/evaluator-access.test.ts`

**Interfaces:**
- Consumes: organization invitations, tryout/session/group IDs, membership capabilities.
- Produces: `EvaluationScope`, `assignEvaluator`, and `listAssignedAthletes(context)` returning minimal blind-mode-safe athlete summaries.

- [ ] **Step 1: Write failing scope tests**

```ts
expect(resolveAssignedRegistrations(groupAssignment, sessionData)).toEqual(groupBlueIds);
expect(await listAssignedAthletes(unassignedEvaluator)).toEqual({ ok: false, error: { code: 'forbidden' } });
```

Test duplicate assignment rejection, removed assignment, cross-division scope, and blind/full identity projections.

- [ ] **Step 2: Verify assignment tests fail**

Run: `npm run test:unit -- tests/unit/staffing && npm run test:integration -- tests/integration/staffing/evaluator-access.test.ts`

Expected: FAIL because staffing commands and projections are missing.

- [ ] **Step 3: Implement assignment rules and workspace**

Create explicit tryout/division/session/group grants, prevent duplicates, invite nonmembers safely, provide an organization evaluator directory, and shape evaluator data at the repository boundary so unrelated identity fields are never loaded.

- [ ] **Step 4: Verify access boundaries**

Run: `npx supabase test db && npm run test:unit -- tests/unit/staffing && npm run test:integration -- tests/integration/staffing`

Expected: assigned access succeeds and all unrelated access fails.

- [ ] **Step 5: Review and commit**

Run: `git diff --check && git diff -- src/modules/staffing src/app/'(app)'`

Commit: `git commit -m "feat: add evaluator invitations and scoped assignments"`.

### Task 14: Persist independent evaluations, scores, notes, and flags

**Files:**
- Create: `supabase/migrations/202608280008_evaluations.sql`
- Create: `supabase/tests/007_evaluation_security.test.sql`
- Create: `src/modules/evaluations/domain/evaluation.ts`
- Create: `src/modules/evaluations/application/save-evaluation-draft.ts`
- Create: `src/modules/evaluations/application/complete-evaluation.ts`
- Create: `src/modules/evaluations/application/reopen-evaluation.ts`
- Create: `src/modules/evaluations/domain/note-tags.ts`
- Test: `tests/unit/evaluations/lifecycle.test.ts`
- Test: `tests/integration/evaluations/independence.test.ts`

**Interfaces:**
- Consumes: evaluator assignment, exact rubric version, capability context, `Clock`.
- Produces: `EvaluationState`, `EvaluationDraft`, organization-configured note tags, `saveEvaluationDraft(input, evaluator, expectedVersion)`, `completeEvaluation`, and audited `reopenEvaluation`.

- [ ] **Step 1: Write failing lifecycle and ownership tests**

```ts
expect(completeEvaluation(incompleteDraft)).toEqual({ ok: false, error: { code: 'required_scores_missing' } });
expect(await saveEvaluationDraft(evaluatorBInputForARecord, evaluatorB, 1)).toMatchObject({ ok: false });
```

Test uniqueness by registration/session/evaluator, wrong rubric category, locked update, director reopen reason, and peer-score read denial.

- [ ] **Step 2: Verify evaluation tests fail**

Run: `npx supabase db reset && npx supabase test db && npm run test:unit -- tests/unit/evaluations && npm run test:integration -- tests/integration/evaluations/independence.test.ts`

Expected: FAIL because evaluation tables and commands are absent.

- [ ] **Step 3: Implement tenant-safe evaluation storage and state machine**

Use the natural unique key, exact rubric foreign keys, one score per category, evaluator-owned notes/organization-configured tags/flags, version increments, completed/locked/reopened transitions, and audit events for reopen.

- [ ] **Step 4: Verify independence and integrity**

Run: `npx supabase db reset && npx supabase test db && npm run test:unit -- tests/unit/evaluations && npm run test:integration -- tests/integration/evaluations`

Expected: evaluator A and B records cannot overwrite or reveal one another.

- [ ] **Step 5: Review and commit**

Run: `git diff --check && git diff -- supabase/migrations/202608280008_evaluations.sql supabase/tests/007_evaluation_security.test.sql src/modules/evaluations`

Commit: `git commit -m "feat: add independent evaluation records"`.

### Task 15: Build the one-handed mobile evaluation interface

**Files:**
- Create: `src/modules/evaluations/ui/score-control.tsx`
- Create: `src/modules/evaluations/ui/evaluation-form.tsx`
- Create: `src/modules/evaluations/ui/save-state.tsx`
- Create: `src/modules/evaluations/ui/athlete-pager.tsx`
- Create: `src/app/(app)/app/[organizationSlug]/evaluate/session/[sessionId]/page.tsx`
- Create: `src/app/(app)/app/[organizationSlug]/evaluate/session/[sessionId]/athletes/page.tsx`
- Create: `src/app/(app)/app/[organizationSlug]/evaluate/session/[sessionId]/athletes/[registrationId]/page.tsx`
- Create: `src/app/(app)/app/[organizationSlug]/evaluate/session/[sessionId]/progress/page.tsx`
- Test: `tests/unit/evaluations/evaluation-form.test.tsx`
- Test: `tests/e2e/mobile-evaluation.spec.ts`

**Interfaces:**
- Consumes: Task 13 assignment projection and Task 14 draft command.
- Produces: integer `ScoreControl`, `EvaluationForm`, `EvaluationSaveState`, previous/next athlete navigation, and session progress view.

- [ ] **Step 1: Write failing interaction and accessibility tests**

```tsx
await user.click(screen.getByRole('radio', { name: 'Skating score 4 of 5' }));
expect(onChange).toHaveBeenCalledWith({ categoryId: skatingId, score: 4 });
expect(screen.getByRole('status')).toHaveTextContent('Saving on device');
```

Test keyboard selection, 44 px targets, blind mode, missing-score validation, note preservation, next/previous, and visible state at 375 px.

- [ ] **Step 2: Verify UI tests fail**

Run: `npm run test:unit -- tests/unit/evaluations/evaluation-form.test.tsx`

Expected: FAIL because mobile controls are missing.

- [ ] **Step 3: Implement focused scoring pages**

Render bib number prominently, category guidance briefly, one large integer control per category, optional note/tags/flag, sticky truthful save state, and immediate next-athlete navigation without modal interruption.

- [ ] **Step 4: Verify mobile evaluator behavior**

Run: `npm run test:unit -- tests/unit/evaluations && npx playwright test tests/e2e/mobile-evaluation.spec.ts --project='Mobile Chrome' --project='Mobile Safari'`

Expected: no horizontal overflow, hidden save state, inaccessible score controls, or blocked navigation.

- [ ] **Step 5: Review and commit**

Run: `git diff --check && git diff -- src/modules/evaluations/ui src/app/'(app)'/app/'[organizationSlug]'/evaluate`

Commit: `git commit -m "feat: add mobile-first evaluator scoring"`.

---

## Phase 6 — Offline evaluation resilience and synchronization

### Task 16: Add the IndexedDB evaluation outbox

**Files:**
- Create: `src/modules/evaluations/offline/database.ts`
- Create: `src/modules/evaluations/offline/outbox.ts`
- Create: `src/modules/evaluations/offline/repository.ts`
- Create: `src/modules/evaluations/offline/sync-state.ts`
- Test: `tests/unit/evaluations/offline-outbox.test.ts`

**Interfaces:**
- Consumes: `EvaluationDraft`, exact rubric context, and generated client mutation UUID.
- Produces: `EvaluationOutboxEntry`, `saveDraftLocally`, `enqueueEvaluationMutation`, `nextPendingMutation`, `acknowledgeMutation`, and `markNeedsAttention`.

- [ ] **Step 1: Write failing IndexedDB tests using `fake-indexeddb`**

```ts
await saveDraftLocally(draft);
await enqueueEvaluationMutation({ evaluationId, clientMutationId, expectedVersion: 2, draft });
expect(await nextPendingMutation()).toMatchObject({ evaluationId, expectedVersion: 2 });
```

Test refresh/reopen persistence, order, duplicate client mutation ID, acknowledgment, failed retry state, and clearing only acknowledged entries.

- [ ] **Step 2: Verify outbox tests fail**

Run: `npm run test:unit -- tests/unit/evaluations/offline-outbox.test.ts`

Expected: FAIL because the IndexedDB schema and API are missing.

- [ ] **Step 3: Implement device-first persistence**

Use a versioned Dexie schema for minimal session context, drafts, mutations, and receipts. Commit the local draft before network work and expose exact `saving_local`, `saved_device`, `syncing`, `synced`, and `needs_attention` states.

- [ ] **Step 4: Verify persistence and migration behavior**

Run: `npm run test:unit -- tests/unit/evaluations/offline-outbox.test.ts && npm run typecheck`

Expected: every persistence and idempotency case passes.

- [ ] **Step 5: Review and commit**

Run: `git diff --check && git diff -- src/modules/evaluations/offline tests/unit/evaluations/offline-outbox.test.ts`

Commit: `git commit -m "feat: persist evaluator drafts in an offline outbox"`.

### Task 17: Implement idempotent evaluation synchronization and conflicts

**Files:**
- Create: `supabase/migrations/202608280009_evaluation_mutations.sql`
- Create: `src/modules/evaluations/application/sync-evaluation-mutation.ts`
- Create: `src/modules/evaluations/offline/synchronizer.ts`
- Create: `src/app/api/evaluations/[evaluationId]/mutations/route.ts`
- Modify: `src/modules/evaluations/ui/evaluation-form.tsx`
- Test: `tests/integration/evaluations/synchronization.test.ts`
- Test: `tests/e2e/evaluation-offline-sync.spec.ts`

**Interfaces:**
- Consumes: Task 16 outbox entry and Task 14 versioned evaluation command.
- Produces: `EvaluationMutationReceipt`, `syncEvaluationMutation`, and `EvaluationSynchronizer.start()/stop()/flush()`.

- [ ] **Step 1: Write failing idempotency and stale-version tests**

```ts
const first = await syncEvaluationMutation(mutation, evaluator);
const replay = await syncEvaluationMutation(mutation, evaluator);
expect(replay).toEqual(first);
expect(await evaluationVersion(evaluationId)).toBe(first.serverVersion);
```

Test stale version retains local draft, authorization revoked, rubric changed, retry after network loss, and no duplicate evaluation row.

- [ ] **Step 2: Verify synchronization tests fail**

Run: `npm run test:integration -- tests/integration/evaluations/synchronization.test.ts`

Expected: FAIL because mutation receipts and endpoint do not exist.

- [ ] **Step 3: Implement transactional sync and UI recovery**

Authorize at execution, insert or return the mutation receipt by client ID, compare expected version, update evaluation and scores atomically, increment version, and return typed conflict details without overwriting newer server data.

- [ ] **Step 4: Verify weak-network browser scenario**

Run: `npm run test:integration -- tests/integration/evaluations/synchronization.test.ts && npx playwright test tests/e2e/evaluation-offline-sync.spec.ts --project='Mobile Chrome'`

Expected: device save survives offline/reload, reconnect syncs once, and conflict remains recoverable.

- [ ] **Step 5: Review and commit**

Run: `git diff --check && git diff -- supabase/migrations/202608280009_evaluation_mutations.sql src/modules/evaluations src/app/api/evaluations tests`

Commit: `git commit -m "feat: synchronize evaluations idempotently"`.

---

## Phase 7 — Scoring engine, rankings, and athlete comparison

### Task 18: Implement the deterministic scoring engine

**Files:**
- Create: `src/modules/scoring/domain/decimal.ts`
- Create: `src/modules/scoring/domain/normalize-score.ts`
- Create: `src/modules/scoring/domain/evaluator-total.ts`
- Create: `src/modules/scoring/domain/athlete-aggregate.ts`
- Create: `src/modules/scoring/domain/rank-athletes.ts`
- Test: `tests/unit/scoring/scoring-engine.test.ts`

**Interfaces:**
- Consumes: completed evaluation snapshots with scale maximum and decimal category weights.
- Produces: `normalizeScore`, `calculateEvaluatorTotal`, `calculateAthleteAggregate`, `rankAthletes`, `ScoreSummary`, and `RankedAthlete`.

- [ ] **Step 1: Write the complete failing scoring specification**

```ts
expect(normalizeScore({ score: 4, scaleMax: 5 })).toEqual('80.0000');
expect(calculateEvaluatorTotal(weightedScores)).toEqual('84.0000');
expect(calculateAthleteAggregate(['82.0000', '86.0000', '84.0000'])).toEqual('84.0000');
expect(calculateAthleteAggregate([])).toBeNull();
expect(rankAthletes(equalScores).map((row) => row.rank)).toEqual([1, 1]);
```

Cover single/multiple evaluators, weights, 1–5/1–10, missing/incomplete, zero complete, rounding, edited/reopened/locked/removed evaluator, session/division filtering, priority category, and no NaN/infinity.

- [ ] **Step 2: Verify every scoring test fails for the expected missing implementation**

Run: `npm run test:unit -- tests/unit/scoring/scoring-engine.test.ts --reporter=verbose`

Expected: FAIL on missing exported scoring functions, not fixture setup.

- [ ] **Step 3: Implement minimal deterministic decimal scoring**

Wrap `decimal.js` 10.6.0 behind `src/modules/scoring/domain/decimal.ts`, serialize canonical values as four-decimal strings, and never use display-rounded values as inputs. Preserve equal rank and keep selection absent from scoring types.

- [ ] **Step 4: Run scoring and property regressions**

Run: `npm run test:unit -- tests/unit/scoring/scoring-engine.test.ts && npm run typecheck`

Expected: every specification case passes with exact values.

- [ ] **Step 5: Review and commit**

Run: `git diff --check && git diff -- src/modules/scoring tests/unit/scoring`

Commit: `git commit -m "feat: add deterministic weighted scoring engine"`.

### Task 19: Build authorized aggregate queries, rankings, and comparison

**Files:**
- Create: `supabase/migrations/202608280010_scoring_queries.sql`
- Create: `supabase/tests/008_scoring_queries.test.sql`
- Create: `src/modules/rankings/application/list-rankings.ts`
- Create: `src/modules/rankings/application/compare-athletes.ts`
- Create: `src/modules/tryouts/application/get-live-dashboard.ts`
- Create: `src/modules/rankings/ui/rankings-workspace.tsx`
- Create: `src/modules/rankings/ui/athlete-comparison.tsx`
- Create: `src/app/(app)/app/[organizationSlug]/tryouts/[tryoutId]/rankings/page.tsx`
- Create: `src/app/(app)/app/[organizationSlug]/tryouts/[tryoutId]/compare/page.tsx`
- Create: `src/app/(app)/app/[organizationSlug]/tryouts/[tryoutId]/live/page.tsx`
- Test: `tests/integration/rankings/rankings.test.ts`
- Test: `tests/e2e/rankings-and-comparison.spec.ts`

**Interfaces:**
- Consumes: Task 18 scoring functions and director/reviewer capabilities.
- Produces: `RankingFilters`, `RankingRow`, `listRankings`, `AthleteComparison`, `compareAthletes`, and `getLiveDashboard` with registration/check-in/evaluator/completion/sync counts.

- [ ] **Step 1: Write failing filter, confidence, and visibility tests**

```ts
expect(rows[0]).toMatchObject({
  overall: '84.0',
  completedEvaluators: 3,
  expectedEvaluators: 3,
  completionPercent: 100,
  scoreRange: ['82.0', '86.0'],
});
```

Test division/position/session/group/completion filters, ties, evaluator denial, reviewer grants, notes privacy, and pagination.

- [ ] **Step 2: Verify ranking tests fail**

Run: `npx supabase test db && npm run test:integration -- tests/integration/rankings/rankings.test.ts`

Expected: FAIL because aggregate queries and ranking application code are missing.

- [ ] **Step 3: Implement reproducible queries and restrained UI**

Load completed evaluations in one tenant/tryout-scoped query, compute or project canonical aggregates, expose completion context, build the operational live dashboard without public score leakage, and build filterable rankings plus side-by-side category comparison without chart overload.

- [ ] **Step 4: Verify exact math and role behavior in browser**

Run: `npm run test:integration -- tests/integration/rankings && npx playwright test tests/e2e/rankings-and-comparison.spec.ts --project=chromium --project=firefox`

Expected: exact scores, ties, filters, comparison, and access rules pass.

- [ ] **Step 5: Review and commit**

Run: `git diff --check && git diff -- supabase src/modules/rankings src/app/'(app)' tests/integration/rankings`

Commit: `git commit -m "feat: add transparent rankings and athlete comparison"`.

---

## Phase 8 — Roster builder and final decisions

### Task 20: Model roster versions, assignments, and decisions

**Files:**
- Create: `supabase/migrations/202608280011_rosters_and_decisions.sql`
- Create: `supabase/tests/009_roster_integrity.test.sql`
- Create: `src/modules/rosters/domain/roster.ts`
- Create: `src/modules/rosters/application/create-roster-draft.ts`
- Create: `src/modules/rosters/application/move-athlete.ts`
- Create: `src/modules/rosters/application/change-decision.ts`
- Create: `src/modules/rosters/application/finalize-roster.ts`
- Create: `src/modules/rosters/application/revise-roster.ts`
- Test: `tests/unit/rosters/lifecycle.test.ts`
- Test: `tests/integration/rosters/finalization.test.ts`

**Interfaces:**
- Consumes: registration, tryout team, director capability, `Clock`, and expected roster version.
- Produces: `DecisionStatus`, `RosterState`, `moveAthlete`, `changeDecision`, `finalizeRoster`, and `reviseRoster`.

- [ ] **Step 1: Write failing state, tenant, and concurrency tests**

```ts
expect(await finalizeRoster(draftId, director, expectedVersion)).toMatchObject({ state: 'finalized' });
expect(await moveAthlete(finalizedId, athleteId, teamId, director, expectedVersion)).toMatchObject({ ok: false });
expect(await moveAthlete(draftId, foreignAthleteId, teamId, director, expectedVersion)).toMatchObject({ ok: false });
```

Test stale browser version, wrong tryout team, bulk decisions, explicit confirmation, immutable snapshot, audited revision, and decision independent from placement.

- [ ] **Step 2: Verify roster tests fail**

Run: `npx supabase db reset && npx supabase test db && npm run test:unit -- tests/unit/rosters && npm run test:integration -- tests/integration/rosters/finalization.test.ts`

Expected: FAIL because roster schema and commands are missing.

- [ ] **Step 3: Implement versioned roster transactions**

Create teams, roster versions, assignments, decisions, and decision history with tenant-safe constraints. Finalize atomically with actor/time/audit. Revision clones a finalized snapshot into a new draft and preserves history.

- [ ] **Step 4: Verify integrity and stale-write rejection**

Run: `npx supabase db reset && npx supabase test db && npm run test:unit -- tests/unit/rosters && npm run test:integration -- tests/integration/rosters`

Expected: all finalization, revision, and cross-tenant checks pass.

- [ ] **Step 5: Review and commit**

Run: `git diff --check && git diff -- supabase/migrations/202608280011_rosters_and_decisions.sql supabase/tests/009_roster_integrity.test.sql src/modules/rosters`

Commit: `git commit -m "feat: add versioned rosters and decisions"`.

### Task 21: Build the accessible roster workspace and finalization flow

**Files:**
- Create: `src/modules/rosters/ui/roster-builder.tsx`
- Create: `src/modules/rosters/ui/athlete-pool.tsx`
- Create: `src/modules/rosters/ui/team-roster.tsx`
- Create: `src/modules/rosters/ui/move-athlete-dialog.tsx`
- Create: `src/modules/rosters/ui/finalize-roster-dialog.tsx`
- Create: `src/app/(app)/app/[organizationSlug]/tryouts/[tryoutId]/rosters/page.tsx`
- Test: `tests/unit/rosters/roster-builder.test.tsx`
- Test: `tests/e2e/roster-finalization.spec.ts`

**Interfaces:**
- Consumes: Task 20 commands and Task 19 ranking summaries.
- Produces: mouse/touch drag operations, keyboard move dialog, decision bulk actions, roster counts/targets, and explicit finalization/revision UI.

- [ ] **Step 1: Write failing keyboard and confirmation tests**

```tsx
await user.click(screen.getByRole('button', { name: 'Move athlete 42' }));
await user.selectOptions(screen.getByLabelText('Destination team'), 'u15-a');
await user.click(screen.getByRole('button', { name: 'Confirm move' }));
expect(onMove).toHaveBeenCalledWith({ registrationId: athlete42, teamId: u15A });
```

Test drag and keyboard parity, stale conflict, roster count, position filters, bulk release confirmation, and finalization not sending messages.

- [ ] **Step 2: Verify roster UI tests fail**

Run: `npm run test:unit -- tests/unit/rosters/roster-builder.test.tsx`

Expected: FAIL because roster UI components are missing.

- [ ] **Step 3: Implement responsive roster interaction**

Use dnd-kit for pointer interaction plus explicit accessible move controls. Keep changes draft, show scores/flags/decisions without implying automatic selection, and present finalization consequences before confirmation.

- [ ] **Step 4: Verify complete roster scenario**

Run: `npm run test:unit -- tests/unit/rosters && npx playwright test tests/e2e/roster-finalization.spec.ts --project=chromium --project=webkit`

Expected: draft move, keyboard move, finalization lock, audit visibility, and revision pass.

- [ ] **Step 5: Review and commit**

Run: `git diff --check && git diff -- src/modules/rosters/ui src/app/'(app)' tests/e2e/roster-finalization.spec.ts`

Commit: `git commit -m "feat: add accessible roster building and finalization"`.

---

## Phase 9 — Transactional communication

### Task 22: Implement durable communication records and email adapters

**Files:**
- Create: `supabase/migrations/202608280012_communications_and_outbox.sql`
- Create: `supabase/tests/010_communication_integrity.test.sql`
- Create: `src/modules/communications/domain/message.ts`
- Create: `src/modules/communications/application/queue-communication.ts`
- Create: `src/infrastructure/jobs/claim-jobs.ts`
- Create: `src/infrastructure/jobs/dispatch-job.ts`
- Create: `src/infrastructure/email/email-provider.ts`
- Create: `src/infrastructure/email/resend-provider.ts`
- Create: `src/infrastructure/email/fake-email-provider.ts`
- Create: `src/app/api/jobs/process/route.ts`
- Test: `tests/contract/email-provider.contract.test.ts`
- Test: `tests/integration/communications/outbox.test.ts`

**Interfaces:**
- Consumes: authorized actor, decision/registration snapshots, `Clock`, and server-only Resend configuration.
- Produces: `EmailProvider.send(message, idempotencyKey)`, `queueCommunication`, optional `NotificationPreferences`, lease-based `claimJobs`, and protected batch processor.

- [ ] **Step 1: Write failing adapter and transactional-outbox tests**

```ts
await expectEmailProviderContract(() => new FakeEmailProvider());
expect(await queueCommunication(command, actor)).toMatchObject({ messageState: 'queued', jobState: 'pending' });
```

Test rollback leaves neither message nor job, duplicate idempotency key, expired lease reclaim, retry backoff, private notes excluded, and unauthorized cron request.

- [ ] **Step 2: Verify communication tests fail**

Run: `npx supabase db reset && npx supabase test db && npm run test:contract -- tests/contract/email-provider.contract.test.ts && npm run test:integration -- tests/integration/communications/outbox.test.ts`

Expected: FAIL because schemas and adapters are absent.

- [ ] **Step 3: Implement outbox, provider boundary, and secure processor**

Snapshot recipient/content, store optional notification preferences without suppressing required operational notices, insert message and job in one transaction, claim jobs with `FOR UPDATE SKIP LOCKED`, use stable provider idempotency keys, verify cron secret, and normalize provider errors without logging private content.

- [ ] **Step 4: Verify delivery and retry mechanics**

Run: `npx supabase db reset && npx supabase test db && npm run test:contract -- tests/contract/email-provider.contract.test.ts && npm run test:integration -- tests/integration/communications`

Expected: fake delivery, duplicate suppression, failure, lease, and retry cases pass.

- [ ] **Step 5: Review and commit**

Run: `git diff --check && git diff -- supabase src/modules/communications src/infrastructure/jobs src/infrastructure/email src/app/api/jobs`

Commit: `git commit -m "feat: add durable transactional communication"`.

### Task 23: Add editable templates, bulk confirmation, and provider events

**Files:**
- Create: `src/modules/communications/application/render-message.ts`
- Create: `src/modules/communications/application/create-message-batch.ts`
- Create: `src/modules/communications/application/apply-delivery-event.ts`
- Create: `src/modules/communications/ui/message-composer.tsx`
- Create: `src/modules/communications/ui/delivery-status.tsx`
- Create: `src/app/(app)/app/[organizationSlug]/tryouts/[tryoutId]/messages/page.tsx`
- Create: `src/app/api/webhooks/resend/route.ts`
- Test: `tests/unit/communications/render-message.test.ts`
- Test: `tests/integration/communications/provider-events.test.ts`
- Test: `tests/e2e/decision-messages.spec.ts`

**Interfaces:**
- Consumes: Task 22 queue and roster/decision snapshots.
- Produces: protected template facts, editable body region, recipient preview, `createMessageBatch`, and idempotent delivery event application.

- [ ] **Step 1: Write failing content-safety and delivery-state tests**

```ts
expect(rendered.body).toContain('U15 Competitive Tryout');
expect(rendered.body).not.toContain(privateEvaluatorNote);
expect(applyDeliveryEvent('submitted', 'delivered')).toBe('delivered');
expect(() => applyDeliveryEvent('delivered', 'submitted')).toThrow();
```

Test recipient count confirmation, decision unchanged on email failure, webhook replay, invalid signature, callback/selected/waitlist/release templates, and bounce state.

- [ ] **Step 2: Verify template and event tests fail**

Run: `npm run test:unit -- tests/unit/communications && npm run test:integration -- tests/integration/communications/provider-events.test.ts`

Expected: FAIL because renderer, batch command, and webhook are missing.

- [ ] **Step 3: Implement safe composition and provider callbacks**

Keep system facts immutable, allow organization text edits, preview exact recipients/content, require confirmation for bulk sends, verify webhook authenticity, deduplicate provider event IDs, and update delivery independently from decisions.

- [ ] **Step 4: Verify bulk communication scenario**

Run: `npm run test:unit -- tests/unit/communications && npm run test:integration -- tests/integration/communications && npx playwright test tests/e2e/decision-messages.spec.ts --project=chromium`

Expected: successful and failed delivery states update without changing selection.

- [ ] **Step 5: Review and commit**

Run: `git diff --check && git diff -- src/modules/communications src/app/'(app)' src/app/api/webhooks/resend tests`

Commit: `git commit -m "feat: add roster decision messaging workflows"`.

---

## Phase 10 — Stripe subscription system

### Task 24: Implement subscription accounts, verified webhooks, and entitlements

**Files:**
- Create: `supabase/migrations/202608280013_subscriptions.sql`
- Create: `supabase/tests/011_subscription_integrity.test.sql`
- Create: `src/modules/subscriptions/domain/plans.ts`
- Create: `src/modules/subscriptions/domain/entitlements.ts`
- Create: `src/modules/subscriptions/application/apply-stripe-event.ts`
- Create: `src/infrastructure/billing/billing-provider.ts`
- Create: `src/infrastructure/billing/stripe-provider.ts`
- Create: `src/infrastructure/billing/fake-billing-provider.ts`
- Create: `src/app/api/webhooks/stripe/route.ts`
- Test: `tests/contract/billing-provider.contract.test.ts`
- Test: `tests/integration/subscriptions/webhooks.test.ts`

**Interfaces:**
- Consumes: organization owner authorization, raw webhook body, configured price mapping, and `Clock`.
- Produces: `PlanKey`, `SubscriptionState`, `Entitlements`, `BillingProvider`, and idempotent `applyStripeEvent`.

- [ ] **Step 1: Write failing webhook-authority tests**

```ts
expect(entitlementsFor({ plan: 'trial', state: 'trialing' }).canPublishTryout).toBe(true);
expect(await applyStripeEvent(replayedEvent)).toEqual(firstApplication);
expect(await applyClientReturnWithoutWebhook()).not.toGrantEntitlements();
```

Test invalid signature, out-of-order events, unknown price ID, active/past_due/canceled, duplicate customer mapping, and cross-organization portal denial.

- [ ] **Step 2: Verify billing tests fail**

Run: `npx supabase db reset && npx supabase test db && npm run test:contract -- tests/contract/billing-provider.contract.test.ts && npm run test:integration -- tests/integration/subscriptions/webhooks.test.ts`

Expected: FAIL because subscription schema and provider boundary are absent.

- [ ] **Step 3: Implement verified provider state and centralized plans**

Store one account per organization, centralize plan/price mapping, verify raw-body signatures, insert provider event ID before applying, and derive entitlements only from verified stored subscription state.

- [ ] **Step 4: Verify subscription transitions**

Run: `npx supabase db reset && npx supabase test db && npm run test:contract -- tests/contract/billing-provider.contract.test.ts && npm run test:integration -- tests/integration/subscriptions`

Expected: every idempotency, ordering, signature, and entitlement test passes.

- [ ] **Step 5: Review and commit**

Run: `git diff --check && git diff -- supabase src/modules/subscriptions src/infrastructure/billing src/app/api/webhooks/stripe`

Commit: `git commit -m "feat: add verified subscription entitlements"`.

### Task 25: Add checkout, customer portal, and billing UI

**Files:**
- Create: `src/modules/subscriptions/application/create-checkout-session.ts`
- Create: `src/modules/subscriptions/application/create-portal-session.ts`
- Create: `src/modules/subscriptions/ui/plan-card.tsx`
- Create: `src/modules/subscriptions/ui/subscription-status.tsx`
- Create: `src/app/(app)/app/[organizationSlug]/organization/billing/page.tsx`
- Create: `src/app/api/organizations/[organizationId]/billing/checkout/route.ts`
- Create: `src/app/api/organizations/[organizationId]/billing/portal/route.ts`
- Test: `tests/integration/subscriptions/sessions.test.ts`
- Test: `tests/e2e/subscriptions.spec.ts`

**Interfaces:**
- Consumes: Task 24 `BillingProvider` and owner capability.
- Produces: `createCheckoutSession`, `createPortalSession`, centralized launch pricing display, and honest trial/past-due/canceled states.

- [ ] **Step 1: Write failing session-authorization tests**

```ts
expect(await createCheckoutSession(teamPlan, adminContext)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
expect(await createPortalSession(ownerContext)).toMatchObject({ ok: true, value: { url: expect.stringMatching(/^https:/) } });
```

Test safe return URLs, unknown plan, repeated click, existing active subscription, and client state not granting access.

- [ ] **Step 2: Verify billing session tests fail**

Run: `npm run test:integration -- tests/integration/subscriptions/sessions.test.ts`

Expected: FAIL because commands, routes, and UI are missing.

- [ ] **Step 3: Implement owner-only billing flows**

Create server-side sessions with organization metadata and idempotency keys, render centralized Team/Club/Association pricing, and explain that provider confirmation may lag until webhook processing.

- [ ] **Step 4: Verify Stripe test-mode scenario**

Run: `npm run test:integration -- tests/integration/subscriptions && npx playwright test tests/e2e/subscriptions.spec.ts --project=chromium`

Expected: checkout, verified activation, portal, cancellation, and entitlement update pass using Stripe test fixtures/fake adapter.

- [ ] **Step 5: Review and commit**

Run: `git diff --check && git diff -- src/modules/subscriptions src/app/'(app)' src/app/api/organizations tests/e2e/subscriptions.spec.ts`

Commit: `git commit -m "feat: add subscription checkout and portal"`.

---

## Phase 11 — The Squad integration adapter and mock provider

### Task 26: Define and contract-test `TeamManagementProvider`

**Files:**
- Create: `src/modules/integrations/domain/provider.ts`
- Create: `src/modules/integrations/domain/contracts.ts`
- Create: `src/infrastructure/integrations/provider-registry.ts`
- Create: `src/infrastructure/integrations/mock-the-squad-provider.ts`
- Create: `tests/contract/team-management-provider.contract.test.ts`
- Fixture: `tests/fixtures/integrations/the-squad/success.json`
- Fixture: `tests/fixtures/integrations/the-squad/partial-failure.json`

**Interfaces:**
- Consumes: finalized roster snapshots and explicit external destination references.
- Produces: the exact `TeamManagementProvider` methods from specification section 14, `ProviderContext`, normalized external references, previews, `SyncJobResult`, and stable error codes.

- [ ] **Step 1: Write the failing provider contract suite**

```ts
await expectTeamManagementProviderContract(
  () => new MockTheSquadProvider({ fixture: 'success' }),
  { repeatExportMustNotDuplicate: true, completedItemsMustSurviveRetry: true },
);
```

Assert connection verification, list destinations, import preview, roster preview, export, repeat export, partial failure, retry, normalized errors, and no invented live endpoint.

- [ ] **Step 2: Verify the contract fails**

Run: `npm run test:contract -- tests/contract/team-management-provider.contract.test.ts`

Expected: FAIL because contract types, registry, and mock are absent.

- [ ] **Step 3: Implement provider-neutral types and deterministic mock**

Implement every contract method, keep the mock disabled by environment feature flag, label it as mock data, and return stable external IDs from fixtures so repeated calls prove idempotency.

- [ ] **Step 4: Verify all provider contract cases**

Run: `npm run test:contract -- tests/contract/team-management-provider.contract.test.ts && npm run typecheck`

Expected: success, duplicate, partial failure, and retry fixtures all pass.

- [ ] **Step 5: Review and commit**

Run: `git diff --check && git diff -- src/modules/integrations src/infrastructure/integrations tests/contract tests/fixtures/integrations`

Commit: `git commit -m "feat: define team management provider contract"`.

### Task 27: Persist integration connections, mappings, sync jobs, and retry UI

**Files:**
- Create: `supabase/migrations/202608280014_integrations.sql`
- Create: `supabase/tests/012_integration_integrity.test.sql`
- Create: `src/modules/integrations/application/preview-roster-export.ts`
- Create: `src/modules/integrations/application/start-roster-export.ts`
- Create: `src/modules/integrations/application/retry-sync-job.ts`
- Create: `src/modules/integrations/ui/integration-card.tsx`
- Create: `src/modules/integrations/ui/roster-export-wizard.tsx`
- Create: `src/app/(app)/app/[organizationSlug]/organization/integrations/page.tsx`
- Create: `src/app/(app)/app/[organizationSlug]/tryouts/[tryoutId]/rosters/[rosterVersionId]/export/page.tsx`
- Test: `tests/integration/integrations/roster-export.test.ts`
- Test: `tests/e2e/mock-roster-export.spec.ts`

**Interfaces:**
- Consumes: Task 26 provider registry, Task 20 finalized roster, integration capability, and durable outbox.
- Produces: `previewRosterExport`, `startRosterExport`, `retrySyncJob`, connection state, external mappings, job/item history, and review-confirm-result UI.

- [ ] **Step 1: Write failing mapping and retry tests**

```ts
const first = await startRosterExport(request, owner);
const second = await startRosterExport(request, owner);
expect(second.jobId).toBe(first.jobId);
expect(await countExternalAthleteMappings()).toBe(first.completedAthleteCount);
```

Test unfinalized roster denial, explicit destination/field review, partial failure, completed item preservation, connection error, mock label, and feature flag off.

- [ ] **Step 2: Verify integration tests fail**

Run: `npx supabase db reset && npx supabase test db && npm run test:integration -- tests/integration/integrations/roster-export.test.ts`

Expected: FAIL because sync schema, commands, and UI are absent.

- [ ] **Step 3: Implement idempotent sync persistence and workflow**

Create connection, mapping, job, and item tables with unique provider/entity keys. Snapshot the finalized roster and approved fields, enqueue export, update item results, derive partial/completed/failed state, and retry failed items only.

- [ ] **Step 4: Verify repeated and partial exports end to end**

Run: `npx supabase db reset && npx supabase test db && npm run test:contract -- tests/contract/team-management-provider.contract.test.ts && npm run test:integration -- tests/integration/integrations && npx playwright test tests/e2e/mock-roster-export.spec.ts --project=chromium`

Expected: repeat creates no duplicate athlete/team mapping and partial failure has a successful retry path.

- [ ] **Step 5: Review and commit**

Run: `git diff --check && git diff -- supabase/migrations/202608280014_integrations.sql supabase/tests/012_integration_integrity.test.sql src/modules/integrations src/app/'(app)' tests`

Commit: `git commit -m "feat: add idempotent mock roster export"`.

---

## Phase 12 — Marketing site, onboarding refinement, reports, and demo data

### Task 28: Build the public marketing, pricing, demo, privacy, and terms experience

**Files:**
- Create: `src/components/layout/marketing-shell.tsx`
- Create: `src/modules/marketing/ui/product-proof.tsx`
- Create: `src/modules/marketing/ui/pricing-table.tsx`
- Create: `src/app/(marketing)/layout.tsx`
- Create: `src/app/(marketing)/page.tsx`
- Create: `src/app/(marketing)/features/page.tsx`
- Create: `src/app/(marketing)/for/teams/page.tsx`
- Create: `src/app/(marketing)/for/clubs/page.tsx`
- Create: `src/app/(marketing)/for/associations/page.tsx`
- Create: `src/app/(marketing)/pricing/page.tsx`
- Create: `src/app/(marketing)/demo/page.tsx`
- Create: `src/app/(marketing)/privacy/page.tsx`
- Create: `src/app/(marketing)/terms/page.tsx`
- Test: `tests/unit/marketing/marketing-pages.test.tsx`
- Test: `tests/e2e/marketing.spec.ts`

**Interfaces:**
- Consumes: Task 2 design system and Task 24 centralized plan configuration.
- Produces: indexable public pages, product-first screenshots/mock UI, clear calls to sign in/start, and privacy/terms content marked for legal approval.

- [ ] **Step 1: Write failing content and navigation tests**

```tsx
expect(renderPage('/')).toHaveTextContent('Stop running tryouts with spreadsheets');
expect(renderPage('/pricing')).toHaveTextContent('$49');
expect(renderPage('/')).not.toHaveTextContent(/AI athlete selection/i);
```

Test all required routes, canonical metadata, keyboard navigation, product proof, no authenticated data fetch, and no stock imagery dependency.

- [ ] **Step 2: Verify marketing tests fail**

Run: `npm run test:unit -- tests/unit/marketing/marketing-pages.test.tsx`

Expected: FAIL because marketing routes and components are absent.

- [ ] **Step 3: Implement bright editorial marketing pages**

Lead with the workflow and real product UI, distinguish Team/Club/Association, avoid unsupported claims, link privacy/terms, and keep JS/image weight low. Legal pages contain concrete draft policy text and a visible prelaunch legal-review status, not lorem ipsum.

- [ ] **Step 4: Verify performance and responsive navigation**

Run: `npm run test:unit -- tests/unit/marketing && npm run build && npx playwright test tests/e2e/marketing.spec.ts --project=chromium --project='Mobile Safari'`

Expected: all routes build, metadata exists, and 375 px navigation has no overflow.

- [ ] **Step 5: Review and commit**

Run: `git diff --check && git diff -- src/app/'(marketing)' src/components/layout/marketing-shell.tsx src/modules/marketing`

Commit: `git commit -m "feat: add TryoutFlow public marketing experience"`.

### Task 29: Add basic reports, CSV exports, onboarding progress, and edge-case demo data

**Files:**
- Create: `src/modules/reports/application/export-athletes-csv.ts`
- Create: `src/modules/reports/application/export-evaluations-csv.ts`
- Create: `src/modules/reports/application/export-roster-csv.ts`
- Create: `src/modules/reports/ui/reports-page.tsx`
- Create: `src/modules/organizations/application/onboarding-progress.ts`
- Create: `src/app/(app)/app/[organizationSlug]/reports/page.tsx`
- Create: `src/app/(app)/app/[organizationSlug]/tryouts/[tryoutId]/reports/page.tsx`
- Create: `src/app/api/organizations/[organizationId]/exports/[exportType]/route.ts`
- Modify: `supabase/seed.sql`
- Test: `tests/unit/reports/csv-export.test.ts`
- Test: `tests/integration/demo-seed.test.ts`
- Test: `tests/e2e/onboarding-and-reports.spec.ts`

**Interfaces:**
- Consumes: tenant-scoped athlete/evaluation/final-roster queries and onboarding events.
- Produces: sanitized CSV download commands, `OnboardingProgress`, report summaries, and deterministic Badlands Hockey Academy fixtures.

- [ ] **Step 1: Write failing export and demo assertions**

```ts
expect(exportRosterCsv(finalizedRoster)).toContain('Athlete number,Preferred name,Decision,Team');
expect(exportRosterCsv(formulaLikeName)).toContain("'=SUM(1,1)");
expect(await demoFacts()).toMatchObject({ genuineTie: true, failedSync: true, successfulSync: true });
```

Test evaluator export permission, private notes omitted from general export, finalized-only roster export, empty report, and checklist completion.

- [ ] **Step 2: Verify report and seed tests fail**

Run: `npm run test:unit -- tests/unit/reports && npm run test:integration -- tests/integration/demo-seed.test.ts`

Expected: FAIL because export functions, pages, and complete seed data are missing.

- [ ] **Step 3: Implement authorized exports and realistic demo fixtures**

Stream bounded CSV with spreadsheet-formula escaping, authorize each export at execution, display empty states, and seed multiple athletes/positions/evaluators/sessions, incomplete evaluations, exact tie, decision variety, draft/final roster, and mock sync outcomes.

- [ ] **Step 4: Verify reset, report, and onboarding behavior**

Run: `npx supabase db reset && npm run test:unit -- tests/unit/reports && npm run test:integration -- tests/integration/demo-seed.test.ts && npx playwright test tests/e2e/onboarding-and-reports.spec.ts --project=chromium`

Expected: deterministic seed and all authorized/denied export cases pass.

- [ ] **Step 5: Review and commit**

Run: `git diff --check && git diff -- src/modules/reports src/modules/organizations/application/onboarding-progress.ts src/app supabase/seed.sql tests`

Commit: `git commit -m "feat: add reports exports and realistic demo data"`.

---

## Phase 13 — Full browser, security, accessibility, and responsive QA

### Task 30: Complete the cross-browser critical-flow suite

**Files:**
- Modify: `playwright.config.ts`
- Create: `tests/e2e/helpers/auth.ts`
- Create: `tests/e2e/helpers/fixtures.ts`
- Create: `tests/e2e/helpers/network.ts`
- Create: `tests/e2e/critical-lifecycle.spec.ts`
- Create: `tests/e2e/role-denials.spec.ts`
- Create: `tests/e2e/concurrency-and-replay.spec.ts`
- Create: `tests/e2e/responsive-and-accessibility.spec.ts`

**Interfaces:**
- Consumes: every prior user-facing workflow and deterministic seed.
- Produces: reusable authenticated role fixtures, network controls, and the specification's 13 complete browser scenarios across configured projects.

- [ ] **Step 1: Write failing lifecycle and denial scenarios**

```ts
test('three evaluators produce an exact aggregate without peer leakage', async ({ browser }) => {
  const sessions = await openThreeEvaluatorSessions(browser);
  await scoreAthleteIndependently(sessions, [82, 86, 84]);
  await expectDirectorAggregate(browser, '84.0', '3 of 3');
  await expectPeerScoresHidden(sessions);
});
```

Implement explicit assertions for onboarding, registration, check-in, offline sync, direct URL denial, roster audit, message separation, mock sync replay/partial retry, Stripe webhook state, and narrow mobile evaluation.

- [ ] **Step 2: Run the suite and record only genuine product failures**

Run: `npx playwright test tests/e2e/critical-lifecycle.spec.ts tests/e2e/role-denials.spec.ts --project=chromium`

Expected: FAIL on uncovered behavior or regressions; fixture problems are fixed before product changes.

- [ ] **Step 3: Make the minimal production fixes revealed by each failing scenario**

For every defect, invoke `superpowers:systematic-debugging`, add or retain the smallest reproducing test, correct the root cause, and keep each fix in the owning domain module. Do not weaken an assertion to make the suite green.

- [ ] **Step 4: Run the complete browser matrix**

Run: `npx playwright test --project=chromium --project=firefox --project=webkit --project='Mobile Chrome' --project='Mobile Safari'`

Expected: all required scenarios pass with traces retained on first retry and no unexpected console errors.

- [ ] **Step 5: Review and commit**

Run: `git diff --check && git diff --stat && git status --short`

Commit: `git commit -m "test: cover TryoutFlow critical browser workflows"`.

### Task 31: Enforce automated accessibility, viewport, and error-state gates

**Files:**
- Create: `tests/e2e/helpers/accessibility.ts`
- Create: `tests/e2e/accessibility.spec.ts`
- Create: `tests/e2e/viewports.spec.ts`
- Create: `tests/e2e/error-states.spec.ts`
- Modify: `.github/workflows/ci.yml`
- Modify: affected `src/components` or owning module files only when tests expose defects.

**Interfaces:**
- Consumes: Playwright pages and `@axe-core/playwright` 4.13.0.
- Produces: `expectNoCriticalAccessibilityViolations(page)`, viewport matrix at 375, 390, 430, tablet, laptop, and large desktop, plus offline/slow/failed-request assertions.

- [ ] **Step 1: Add failing audits for critical screens**

```ts
await expectNoCriticalAccessibilityViolations(page);
expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
  await page.evaluate(() => document.documentElement.clientWidth),
);
```

Audit registration, sign-in, tryout wizard, check-in, mobile evaluation, rankings, roster, messages, billing, and integration review.

- [ ] **Step 2: Run accessibility and viewport tests**

Run: `npx playwright test tests/e2e/accessibility.spec.ts tests/e2e/viewports.spec.ts tests/e2e/error-states.spec.ts --project=chromium`

Expected: FAIL wherever labels, focus, contrast, overflow, recovery, double-click, back/refresh, loading, or error behavior is incomplete.

- [ ] **Step 3: Correct each verified accessibility or responsive defect**

Preserve semantic controls and native tab order; add keyboard alternatives, focus restoration, live-region status, reflow, exact recovery copy, and disabled/idempotent submission behavior as required by the failing test.

- [ ] **Step 4: Run audits across desktop and mobile engines**

Run: `npx playwright test tests/e2e/accessibility.spec.ts tests/e2e/viewports.spec.ts tests/e2e/error-states.spec.ts --project=chromium --project=webkit --project='Mobile Safari'`

Expected: no critical accessibility violation or primary-flow horizontal overflow remains.

- [ ] **Step 5: Review and commit**

Run: `git diff --check && git diff -- .github/workflows/ci.yml tests/e2e src/components src/modules`

Commit: `git commit -m "test: enforce accessibility and responsive quality gates"`.

---

## Phase 14 — Production-readiness verification

### Task 32: Add observability, privacy-safe analytics, and operational runbooks

**Files:**
- Create: `src/modules/observability/domain/app-error.ts`
- Create: `src/modules/observability/application/log-error.ts`
- Create: `src/infrastructure/analytics/analytics-provider.ts`
- Create: `src/infrastructure/analytics/fake-analytics-provider.ts`
- Create: `src/modules/audit/application/list-audit-events.ts`
- Create: `src/modules/organizations/application/begin-support-elevation.ts`
- Create: `src/app/api/health/route.ts`
- Create: `src/app/(app)/app/[organizationSlug]/organization/audit/page.tsx`
- Create: `src/app/(platform)/platform/organizations/page.tsx`
- Create: `src/app/(platform)/platform/subscriptions/page.tsx`
- Create: `src/app/(platform)/platform/health/page.tsx`
- Create: `src/app/(platform)/platform/support/page.tsx`
- Create: `src/app/(platform)/platform/audit/page.tsx`
- Create: `docs/operations/environment.md`
- Create: `docs/operations/deployment.md`
- Create: `docs/operations/privacy-and-retention.md`
- Create: `docs/operations/incidents.md`
- Test: `tests/unit/observability/privacy.test.ts`
- Test: `tests/integration/observability/health.test.ts`
- Test: `tests/integration/observability/platform-administration.test.ts`

**Interfaces:**
- Consumes: typed application errors, request/organization/actor/job correlation IDs, and outbox/provider health.
- Produces: `AppError`, `logError`, `AnalyticsProvider.track`, redaction rules, `listAuditEvents`, time-bound `beginSupportElevation`, protected health result, platform administration surfaces, and operator procedures.

- [ ] **Step 1: Write failing redaction and health tests**

```ts
expect(redactLogContext({ guardianEmail: 'private@example.com', organizationId })).toEqual({ organizationId });
expect(await healthCheck(ownerContext)).toMatchObject({ database: 'ok', failedJobs: expect.any(Number) });
```

Test scores, notes, guardian data, provider secrets, and tokens never enter analytics/log metadata; test unauthorized detailed health/audit/subscription access and reason/expiry requirements for support elevation.

- [ ] **Step 2: Verify observability tests fail**

Run: `npm run test:unit -- tests/unit/observability && npm run test:integration -- tests/integration/observability/health.test.ts`

Expected: FAIL because error taxonomy, redaction, analytics adapter, and health route are missing.

- [ ] **Step 3: Implement structured operational visibility and runbooks**

Separate validation/permission/conflict/network/integration/unexpected errors, redact private fields by construction, expose coarse public health and authorized operational detail, provide organization audit history and platform organization/subscription/health/support/audit views, require audited time-bound support elevation, and document environments, migrations, rollback, job recovery, privacy review, retention decisions, and incident response.

- [ ] **Step 4: Verify privacy and health behavior**

Run: `npm run test:unit -- tests/unit/observability && npm run test:integration -- tests/integration/observability && npm run typecheck`

Expected: redaction and role-aware health assertions pass.

- [ ] **Step 5: Review and commit**

Run: `git diff --check && git diff -- src/modules/observability src/infrastructure/analytics src/app/api/health docs/operations tests`

Commit: `git commit -m "feat: add privacy-safe operations and runbooks"`.

### Task 33: Run the release-candidate verification gate

**Files:**
- Create: `scripts/verify-production-readiness.sh`
- Create: `docs/operations/release-checklist.md`
- Create: `README.md`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: all scripts, local Supabase, test fixtures, Playwright projects, and production build.
- Produces: one deterministic release command, evidence checklist, environment setup guide, and explicit list of manual legal/provider prerequisites.

- [ ] **Step 1: Write the release script with fail-fast commands**

```bash
#!/usr/bin/env bash
set -euo pipefail
npm ci
npm run format:check
npm run lint
npm run typecheck
npx supabase db reset
npx supabase test db
npm run test:unit
npm run test:integration
npm run test:contract
npm run build
npm run test:e2e
```

The checklist maps every specification acceptance criterion to an automated command or a named manual prerequisite; it never marks legal review, domain authentication, or production credentials complete without evidence.

- [ ] **Step 2: Run the release command and capture any failure**

Run: `bash scripts/verify-production-readiness.sh`

Expected: every automated command exits 0 in the test environment. Manual legal, domain-authentication, and production-credential prerequisites remain explicitly incomplete until separate evidence exists.

- [ ] **Step 3: Resolve each failure through its owning workflow**

Invoke `superpowers:systematic-debugging` per defect, add a reproducing test, implement the smallest root-cause fix, rerun the focused test, and then restart the full release script from the beginning.

- [ ] **Step 4: Perform final fresh verification and requirements audit**

Run: `bash scripts/verify-production-readiness.sh && git diff --check && git status --short`

Expected: all automated commands exit 0; the release checklist clearly distinguishes verified software readiness from outstanding human/legal/provider prerequisites.

- [ ] **Step 5: Review and commit the release gate**

Run: `git diff --stat && git log --oneline --decorate -20`

Commit: `git commit -m "chore: add production readiness verification gate"`.

## Phase Completion Checklist

At the end of every phase, before moving to the next phase:

1. Invoke `superpowers:verification-before-completion`.
2. Run `npm run format:check`, `npm run lint`, `npm run typecheck`, all tests changed or affected by the phase, `npx supabase test db` for schema/policy phases, and `npm run build`.
3. Run the phase's proportional Playwright projects at desktop and mobile widths.
4. Read the complete output and resolve every required failure.
5. Review `git diff`, `git diff --check`, and `git status --short` for accidental files, secrets, generated noise, and unrelated changes.
6. Confirm no error is hidden, no security check is weakened, no type is broadened to silence TypeScript, and no failing test is removed without an approved requirement change.
7. Commit the independently working phase and record verification evidence in the task handoff.

## Specification Coverage Map

| Specification area | Implementing tasks |
|---|---|
| Purpose, principles, scope, and exclusions | Global Constraints; Tasks 1, 28, 33 |
| Modular architecture and domain boundaries | Tasks 1–3 and Repository Map |
| Authentication | Task 4 |
| Roles, scoped authorization, support elevation, and RLS | Tasks 5, 13, 32 |
| Organizations, invitations, onboarding, and settings | Task 6 |
| Database conventions, audit foundation, and tenant integrity | Tasks 3, 5, 7–8, 10–14, 17, 19–20, 22, 24, 27 |
| Tryout wizard, divisions, positions, sessions, groups, forms, rubrics, publication, URL, and QR | Tasks 7–9 |
| Athletes, guardians, registration, duplicates, CSV, directory, and check-in | Tasks 10–12 |
| Evaluator staffing, blind projections, evaluations, notes, tags, and flags | Tasks 13–15 |
| Weak-connection device outbox and idempotent synchronization | Tasks 16–17 |
| Deterministic scoring, ties, rankings, live dashboard, and comparison | Tasks 18–19 |
| Teams, decisions, roster versions, finalization, revision, and concurrency | Tasks 20–21 |
| Email templates, batches, delivery state, preferences, and durable jobs | Tasks 22–23 |
| Stripe subscription accounts, webhooks, entitlements, checkout, and portal | Tasks 24–25 |
| Team-management contract, mock The Squad provider, mappings, sync jobs, and retries | Tasks 26–27 |
| Route map, marketing, pricing, demo, privacy, and terms | Tasks 4, 6, 9–15, 19, 21, 23, 25, 27–29, 32 |
| Design system, responsive behavior, accessibility, and motion | Tasks 2, 15, 21, 28, 30–31 |
| Reports, CSV exports, onboarding progress, and demo edge cases | Task 29 |
| Error taxonomy, structured logs, analytics, health, audit UI, and operations | Tasks 22, 27, 32 |
| Security, privacy, performance, and concurrency requirements | Tasks 3, 5, 10–14, 17, 19–20, 22, 24, 27, 30–33 |
| Unit, integration, database, contract, browser, and release verification | Every task; Tasks 30–33 provide final gates |
| Deployment and production-readiness acceptance criteria | Tasks 1, 32–33 |

## Execution Order and Checkpoints

- Tasks execute in numeric order because later interfaces depend on earlier types, schema, and authorization.
- Stop for architecture review if a task requires changing an approved public interface, tenant boundary, scoring rule, offline guarantee, or MVP exclusion.
- Stop for provider clarification rather than inventing Stripe, Resend, Supabase, Vercel, or The Squad behavior.
- Use current official documentation when an installed dependency's API differs from the signatures anticipated here; update this plan and its adjacent tasks consistently before implementation.
- Keep the specification and this plan in every implementation context.
