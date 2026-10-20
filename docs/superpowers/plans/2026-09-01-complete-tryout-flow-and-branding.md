# Complete Tryout Flow and Organization Branding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver consistent spacing and instructional form examples, durable organization-logo upload and public delivery, and an authoritative guided path from organization setup through final roster communication and reporting.

**Architecture:** A private organization-owned PostgreSQL asset stores one normalized WebP logo per tenant behind narrow authenticated RPCs and a byte-only delivery route. Shared example metadata and journey-projection modules keep UI guidance truthful and testable, while existing specialist pages remain the execution surfaces linked from one authoritative tryout overview.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Supabase/PostgreSQL/RLS/pgTAP, Sharp, Zod, Vitest/Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-01-complete-tryout-flow-and-branding-design.md`

## Global Constraints

- Read `node_modules/next/dist/docs/01-app/02-guides/forms.md`, `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`, and `node_modules/next/dist/docs/01-app/01-getting-started/12-images.md` before editing Next.js form, route, or image code.
- Use an additive migration after `202609010098_index_abuse_cleanup.sql`; never edit a shipped migration.
- Accept PNG, JPEG, or WebP raw uploads only; reject SVG and raw files over 2 MiB.
- Normalize logos to metadata-free WebP inside 512×512 without enlargement and enforce the encoded database ceiling.
- Keep logo tables client-inaccessible; use fixed-empty-search-path RPCs for owner/admin mutations and a byte-only server route for delivery.
- Missing or unavailable logos must render the existing `TF` fallback without broken-image UI.
- Form examples are instructional only and must never become submitted values unless the user enters them.
- Native date/datetime controls receive adjacent format/timezone help rather than fake placeholders.
- Journey status comes from bounded authoritative database facts; failed facts render `Unavailable`, never fabricated zeroes.
- Preserve 44-pixel targets, keyboard operation, focus recovery, no 320-pixel horizontal overflow, existing idempotency, and existing authorization semantics.
- Do not change evaluation, ranking, roster, communication, export, or billing business rules.

---

### Task 1: Repair the spacing token and establish the example catalog

**Files:**
- Modify: `src/app/theme.css`
- Create: `src/components/forms/field-examples.ts`
- Modify: `src/modules/tryouts/ui/tryout-card.tsx`
- Modify: `src/app/globals.css`
- Test: `tests/unit/forms/field-examples.test.ts`
- Test: `tests/unit/tryouts/tryout-card.test.tsx`

**Interfaces:**
- Produces: `FIELD_EXAMPLES`, a frozen map of instructional strings used by later form tasks.
- Produces: a valid `--space-5: 1.25rem` token between `--space-4` and `--space-6`.

- [ ] **Step 1: Add failing token and example-catalog tests**

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FIELD_EXAMPLES } from '../../../src/components/forms/field-examples';

describe('field guidance', () => {
  it('defines the spacing token consumed by compact cards', () => {
    expect(readFileSync('src/app/theme.css', 'utf8')).toContain('--space-5: 1.25rem;');
  });

  it('provides exact fictional examples for the core journey', () => {
    expect(FIELD_EXAMPLES).toMatchObject({
      tryoutName: 'U15 Fall Evaluations',
      sport: 'Hockey',
      season: '2026 Fall Season',
      division: 'U15',
      session: 'Skills Session 1',
      rubric: 'Skating and Game Sense',
    });
  });
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `corepack npm exec -- vitest run --config vitest.config.ts tests/unit/forms/field-examples.test.ts tests/unit/tryouts/tryout-card.test.tsx`

Expected: FAIL because `field-examples.ts` and `--space-5` do not exist and computed card padding is invalid.

- [ ] **Step 3: Add the minimal spacing token and frozen catalog**

```ts
export const FIELD_EXAMPLES = Object.freeze({
  organizationName: 'Badlands Hockey Academy',
  tryoutName: 'U15 Fall Evaluations',
  sport: 'Hockey',
  season: '2026 Fall Season',
  timezone: 'America/Edmonton',
  division: 'U15',
  session: 'Skills Session 1',
  group: 'Forward Group',
  position: 'Forward',
  registrationForm: '2026 Player Registration',
  rubric: 'Skating and Game Sense',
  athleteGivenName: 'Jordan',
  athleteFamilyName: 'Lee',
  guardianName: 'Taylor Lee',
  guardianEmail: 'taylor@example.com',
  guardianPhone: '780-555-0142',
  sports: 'Hockey, Ringette',
  quickTags: 'High compete, Strong skating',
} as const);
```

Add `--space-5: 1.25rem;` and keep `.tryout-card` padding/gaps on the shared scale. Add a test-visible class only when needed to assert layout; do not duplicate numeric padding in JSX.

- [ ] **Step 4: Verify GREEN and responsive computed styles**

Run: `corepack npm exec -- vitest run --config vitest.config.ts tests/unit/forms/field-examples.test.ts tests/unit/tryouts/tryout-card.test.tsx`

Expected: PASS with card content separated from every edge.

- [ ] **Step 5: Commit the spacing and catalog slice**

```bash
git add src/app/theme.css src/app/globals.css src/components/forms/field-examples.ts src/modules/tryouts/ui/tryout-card.tsx tests/unit/forms/field-examples.test.ts tests/unit/tryouts/tryout-card.test.tsx
git commit -m "fix: restore card spacing and field guidance"
```

---

### Task 2: Add the private organization-logo database boundary

**Files:**
- Create: `supabase/migrations/202609010099_organization_brand_assets.sql`
- Create: `supabase/tests/079_organization_brand_assets.test.sql`
- Modify generated: `src/infrastructure/supabase/database.types.ts`

**Interfaces:**
- Produces table: `private.organization_brand_assets(organization_id, content, content_type, byte_length, sha256, updated_by_user_id, created_at, updated_at)`.
- Produces RPC: `public.upsert_organization_logo(p_organization_id uuid, p_content_base64 text, p_sha256 text) returns text`.
- Produces RPC: `public.remove_organization_logo(p_organization_id uuid) returns text`.
- Produces RPC: `public.read_organization_logo_service(p_organization_slug text)` executable only by `service_role` and returning one byte payload plus digest metadata.
- Produces RPC: `public.get_organization_logo_metadata(p_organization_id uuid)` executable by authenticated active members and returning existence/digest/version without bytes.

- [ ] **Step 1: Write failing pgTAP coverage**

Cover exact table columns/checks, one-row-per-organization ownership, WebP-only decoded bytes, encoded-size ceiling, 64-lowercase-hex digest, immutable organization identity, owner/admin success, member/offboarded/cross-tenant denial, append-only audit evidence, direct DML denial, normal/replica truncation denial, fixed empty search paths, and exact RPC ACLs.

```sql
select has_table('private','organization_brand_assets','private brand assets exist');
select table_privs_are('private','organization_brand_assets','authenticated',array[]::text[],'clients have no direct logo access');
select function_privs_are('public','upsert_organization_logo',array['uuid','text','text'],'authenticated',array['EXECUTE'],'authenticated uses the guarded mutation RPC');
select function_privs_are('public','read_organization_logo_service',array['text'],'service_role',array['EXECUTE'],'only the server delivery boundary reads bytes');
select function_privs_are('public','get_organization_logo_metadata',array['uuid'],'authenticated',array['EXECUTE'],'active members can load byte-free branding metadata');
```

- [ ] **Step 2: Run the new pgTAP file and verify RED**

Run: `npm run supabase:reset && npm run test:db -- supabase/tests/079_organization_brand_assets.test.sql`

Expected: FAIL because the table and RPCs are absent.

- [ ] **Step 3: Implement migration 099 with strict authorization and guards**

Use `public.is_active_organization_member(p_organization_id,array['owner','administrator'])`, snapshot `auth.uid()` once, lock the organization row before mutation, decode base64 once, validate WebP RIFF/WEBP header and `octet_length`, upsert atomically, and append `organization.logo_updated` or `organization.logo_removed` to `audit_logs`.

Return only `updated`, `removed`, `not_found`, or `forbidden`; never return bytes from public RPCs. Revoke all default/table/function privileges before adding the exact grants.

- [ ] **Step 4: Run focused and full database tests**

Run: `npm run supabase:reset && npm run test:db -- supabase/tests/079_organization_brand_assets.test.sql`

Expected: focused PASS.

Run: `npm run test:db`

Expected: all pgTAP files PASS with no legacy ACL regression.

- [ ] **Step 5: Regenerate types twice and prove byte stability**

Run: `npm run db:types && shasum -a 256 src/infrastructure/supabase/database.types.ts && npm run db:types && shasum -a 256 src/infrastructure/supabase/database.types.ts`

Expected: identical hashes.

- [ ] **Step 6: Commit the database boundary**

```bash
git add supabase/migrations/202609010099_organization_brand_assets.sql supabase/tests/079_organization_brand_assets.test.sql src/infrastructure/supabase/database.types.ts
git commit -m "feat: add secure organization logo storage"
```

---

### Task 3: Normalize logo files and implement owner/admin settings actions

**Files:**
- Create: `src/modules/organizations/application/normalize-organization-logo.ts`
- Create: `src/modules/organizations/application/update-organization-logo.ts`
- Create: `src/modules/organizations/components/organization-logo-settings.tsx`
- Modify: `src/app/(app)/app/[organizationSlug]/organization/settings/page.tsx`
- Test: `tests/unit/organizations/normalize-organization-logo.test.ts`
- Test: `tests/unit/organizations/organization-logo-settings.test.tsx`
- Test: `tests/integration/organizations/organization-logo.test.ts`

**Interfaces:**
- Produces: `normalizeOrganizationLogo(file: File): Promise<{ base64: string; sha256: string; byteLength: number }>`.
- Produces: `updateOrganizationLogo(input, actor, dependencies): Promise<AppResult<LogoMutation, LogoError>>`.
- Consumes: migration 099 RPCs.

- [ ] **Step 1: Write RED tests for decoder and action behavior**

```ts
it('normalizes a valid PNG to bounded metadata-free WebP', async () => {
  const result = await normalizeOrganizationLogo(pngFile({ width: 900, height: 300 }));
  expect(result.byteLength).toBeLessThanOrEqual(350_000);
  expect(Buffer.from(result.base64, 'base64').subarray(8, 12).toString()).toBe('WEBP');
  expect(result.sha256).toMatch(/^[a-f0-9]{64}$/u);
});

it.each(['image/svg+xml', 'application/pdf'])('rejects %s without calling the RPC', async (type) => {
  const result = await updateOrganizationLogo({ organizationId, file: hostileFile(type) }, actor, dependencies);
  expect(result).toEqual({ ok: false, error: { code: 'invalid_file' } });
  expect(dependencies.gateway.upsert).not.toHaveBeenCalled();
});
```

Also cover magic-byte spoofing, malformed image bytes, empty input, raw >2 MiB, encoded output too large, owner/admin success, member denial, replacement, removal, RPC conflict, and retention of the old logo when processing fails.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `corepack npm exec -- vitest run --config vitest.config.ts tests/unit/organizations/normalize-organization-logo.test.ts tests/unit/organizations/organization-logo-settings.test.tsx`

Expected: FAIL because normalizer/action/component are absent.

- [ ] **Step 3: Implement Sharp normalization and application boundary**

Use `sharp(await file.arrayBuffer(), { failOn: 'warning', limitInputPixels: 16_000_000 })`, call `.rotate().resize(512,512,{fit:'inside',withoutEnlargement:true}).webp({quality:88,effort:4}).toBuffer()`, verify the final ceiling, hash with `createHash('sha256')`, and call the RPC through the authenticated server client.

Map errors exactly to `invalid_file`, `forbidden`, `too_large`, or `unavailable`. Never include original bytes, filenames, or decoder errors in logs or redirects.

- [ ] **Step 4: Add settings UI with upload, replace, and remove actions**

Use `encType="multipart/form-data"`, `accept="image/png,image/jpeg,image/webp"`, explicit `2 MiB` and recommended-square copy, current logo preview/fallback, and separate replace/remove buttons. Preserve the existing settings form and add realistic placeholders from `FIELD_EXAMPLES`.

- [ ] **Step 5: Verify focused unit and real PostgreSQL integration GREEN**

Run: `corepack npm exec -- vitest run --config vitest.config.ts tests/unit/organizations/normalize-organization-logo.test.ts tests/unit/organizations/organization-logo-settings.test.tsx`

Run: `npm run test:integration -- tests/integration/organizations/organization-logo.test.ts`

Expected: all focused tests PASS, with exact authorization and audit rows.

- [ ] **Step 6: Commit the upload/settings slice**

```bash
git add src/modules/organizations/application/normalize-organization-logo.ts src/modules/organizations/application/update-organization-logo.ts src/modules/organizations/components/organization-logo-settings.tsx 'src/app/(app)/app/[organizationSlug]/organization/settings/page.tsx' tests/unit/organizations tests/integration/organizations/organization-logo.test.ts
git commit -m "feat: add organization logo management"
```

---

### Task 4: Deliver logos safely to staff and public registration surfaces

**Files:**
- Create: `src/app/api/organizations/[organizationSlug]/logo/route.ts`
- Create: `src/modules/organizations/components/organization-mark.tsx`
- Modify: `src/modules/organizations/application/current-organization.ts`
- Modify: `src/components/layout/app-shell.tsx`
- Modify: `src/components/layout/app-navigation.tsx`
- Modify: `src/components/layout/mobile-nav.tsx`
- Modify: `src/app/api/public/registrations/route.ts`
- Modify: `src/app/(registration)/register/[tryoutSlug]/registration-form.tsx`
- Test: `tests/unit/organizations/organization-logo-route.test.ts`
- Test: `tests/unit/organizations/app-navigation.test.tsx`
- Test: `tests/unit/registration/public-registration-loader.test.ts`
- Test: `tests/unit/registration/public-registration-branding.test.tsx`

**Interfaces:**
- Produces: `GET /api/organizations/:slug/logo` with `image/webp`, ETag, `nosniff`, bounded length, and conditional 304.
- Produces: `OrganizationMark({ name, logoUrl, size })` that owns fallback behavior.
- Extends organization view models with `logoUrl?: string` only, never raw metadata or bytes.

- [ ] **Step 1: Write route and branding RED tests**

Assert existing asset `200`, missing asset `404`, matching `If-None-Match` `304`, malformed/duplicate rows `503`, no content disposition, exact MIME and cache headers, and no service/database error leakage.

Assert app desktop/mobile navigation renders organization alt text, missing logo renders `TF`, public loader returns a logo URL only for the exact published tryout organization, and registration heading renders organization name before tryout name.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `corepack npm exec -- vitest run --config vitest.config.ts tests/unit/organizations/organization-logo-route.test.ts tests/unit/organizations/app-navigation.test.tsx tests/unit/registration/public-registration-loader.test.ts tests/unit/registration/public-registration-branding.test.tsx`

Expected: FAIL because the route, component, and response fields are absent.

- [ ] **Step 3: Implement byte-only route and reusable mark**

The route validates one slug, calls only `public.read_organization_logo_service` through the admin client, rejects unexpected cardinality, compares quoted ETags, and returns the exact bytes. `OrganizationMark` uses local state only to replace a failed image with `TF`; it does not retry or expose a broken icon.

- [ ] **Step 4: Wire staff and public surfaces**

Extend current organization selection with a bounded logo-existence/version projection. Add `logoUrl` to `AppShell`/`AppNavigation`/`MobileNav`. Extend the existing public registration GET response schema with `organization: { name, logoUrl? }` and render it through `OrganizationMark`.

- [ ] **Step 5: Verify focused tests and public-route integration**

Run the focused command from Step 2, then:

Run: `npm run test:integration -- tests/integration/registration/public-registration-routes.test.ts tests/integration/organizations/organization-logo.test.ts`

Expected: all PASS, including public exact-tenant branding and missing-logo fallback.

- [ ] **Step 6: Commit the delivery/display slice**

```bash
git add src/app/api/organizations src/app/api/public/registrations src/app/'(registration)'/register src/components/layout src/modules/organizations tests/unit/organizations tests/unit/registration tests/integration
git commit -m "feat: display organization branding across workflows"
```

---

### Task 5: Add instructional examples and field-specific validation throughout the core journey

**Files:**
- Modify: `src/app/(auth)/sign-up/page.tsx`
- Modify: `src/app/(app)/app/[organizationSlug]/tryouts/new/page.tsx`
- Modify: `src/modules/tryouts/ui/tryout-wizard.tsx`
- Modify: `src/app/(app)/app/[organizationSlug]/tryouts/[tryoutId]/registration/page.tsx`
- Modify: `src/app/(registration)/register/[tryoutSlug]/registration-form.tsx`
- Modify: `src/modules/organizations/components/invite-member-form.tsx`
- Modify: `src/modules/communications/ui/message-composer.tsx`
- Modify: `src/modules/checkin/ui/checkin-workspace.tsx`
- Create: `src/modules/tryouts/application/validate-tryout-basics.ts`
- Test: `tests/unit/forms/core-workflow-guidance.test.tsx`
- Test: `tests/unit/tryouts/validate-tryout-basics.test.ts`
- Test: existing owning tests under `tests/unit/tryouts`, `tests/unit/registration`, `tests/unit/organizations`, `tests/unit/communications`, and `tests/unit/checkin`

**Interfaces:**
- Consumes: `FIELD_EXAMPLES` from Task 1.
- Produces: stable IDs for date/time help and field-error descriptions used by browser tests.
- Produces: `validateTryoutBasics(input): { ok: true; value: TryoutBasicsInput } | { ok: false; fieldErrors: Partial<Record<TryoutBasicsField, string>> }`.

- [ ] **Step 1: Write RED assertions for exact form examples and help**

Render every form with its normal minimal inputs and assert placeholder text for free-text controls, a disabled instructional option for required empty selects, and `aria-describedby` help for date/timezone controls. Assert placeholders do not appear as submitted `FormData` values.

- [ ] **Step 2: Run focused owning tests and verify RED**

Run: `corepack npm exec -- vitest run --config vitest.config.ts tests/unit/forms/core-workflow-guidance.test.tsx tests/unit/tryouts tests/unit/registration tests/unit/organizations tests/unit/communications tests/unit/checkin --maxWorkers=2`

Expected: new guidance assertions FAIL without breaking existing form semantics.

- [ ] **Step 3: Wire catalog values and accessible help**

Apply only relevant catalog values. Keep `defaultValue` for saved data, use `placeholder` only when the value is genuinely empty, and add text such as `Example: September 15, 2026 at 6:00 PM in America/Edmonton` next to datetime fields.

Use `validateTryoutBasics` before the persistence gateway and return its exact field-error map through a `useActionState`-compatible server action result. Associate each message with the owning input through `aria-describedby` and `aria-invalid`. Preserve bounded entered values in action state; do not echo raw input in URLs. Database/gateway rejections that cannot be assigned to a field remain a form-level `Could not save this step` error without claiming which field failed.

- [ ] **Step 4: Verify GREEN and no accidental sample submission**

Run the focused command from Step 2.

Expected: all PASS; empty submissions remain invalid, and examples are not stored.

- [ ] **Step 5: Commit the guidance slice**

```bash
git add src/app src/modules src/components/forms tests/unit
git commit -m "feat: guide core workflow form entry"
```

---

### Task 6: Build the authoritative journey projection and actionable overview

**Files:**
- Create: `src/modules/tryouts/application/load-tryout-journey.ts`
- Create: `src/modules/tryouts/ui/tryout-journey.tsx`
- Modify: `src/app/(app)/app/[organizationSlug]/tryouts/[tryoutId]/overview/page.tsx`
- Modify: `src/modules/registration/ui/participant-workspace-header.tsx`
- Modify: selected stage pages under `src/app/(app)/app/[organizationSlug]/tryouts/[tryoutId]/`
- Test: `tests/unit/tryouts/load-tryout-journey.test.ts`
- Test: `tests/unit/tryouts/tryout-journey.test.tsx`
- Test: `tests/integration/tryouts/tryout-journey.test.ts`

**Interfaces:**
- Produces: `loadTryoutJourney(client, scope): Promise<TryoutJourney>`.
- Produces: five `JourneyStage` records with `status`, `supportingText`, `primaryAction`, `secondaryActions`, and optional `blocker`.
- Consumes only authorized bounded counts and existing immutable states.

- [ ] **Step 1: Write RED projection matrices**

```ts
it.each([
  ['draft', 'prepare', 'Continue setup'],
  ['published-empty', 'participants', 'Add first participant'],
  ['participants-ready', 'run', 'Open check-in'],
  ['evaluations-ready', 'decide', 'Review rankings'],
  ['roster-finalized', 'complete', 'Review communication'],
] as const)('recommends the exact next stage for %s', async (fixture, stage, label) => {
  expect(await loadFixtureJourney(fixture)).toMatchObject({ nextStage: stage, primaryAction: { label } });
});
```

Add separate dependency-failure cases that produce stage-level `unavailable` without changing known stages or fabricating counts.

- [ ] **Step 2: Run focused unit tests and verify RED**

Run: `corepack npm exec -- vitest run --config vitest.config.ts tests/unit/tryouts/load-tryout-journey.test.ts tests/unit/tryouts/tryout-journey.test.tsx`

Expected: FAIL because the projection and component are absent.

- [ ] **Step 3: Implement bounded data loading**

Use exact `head: true, count: 'exact'` queries where counts are required and bounded `limit(1)` existence queries where only state is required. Authorize scope before every branch, parse every row strictly, and keep query failures isolated per stage.

- [ ] **Step 4: Replace the static action plan with authoritative actions**

Render five stages, one recommended-next banner, real blockers, counts, and specialist links. Add compact `Back to overview`/stage-next navigation to participants, sessions, check-in, live, rankings, rosters, messages, and reports without hiding their existing controls.

- [ ] **Step 5: Verify unit and PostgreSQL integration GREEN**

Run the focused command from Step 2.

Run: `npm run test:integration -- tests/integration/tryouts/tryout-journey.test.ts`

Expected: all state matrices and cross-tenant denials PASS.

- [ ] **Step 6: Commit the journey slice**

```bash
git add src/modules/tryouts src/modules/registration 'src/app/(app)/app/[organizationSlug]/tryouts' tests/unit/tryouts tests/integration/tryouts/tryout-journey.test.ts
git commit -m "feat: guide the complete tryout journey"
```

---

### Task 7: Prove the complete branded journey in a real browser

**Files:**
- Create: `tests/e2e/complete-branded-journey.spec.ts`
- Modify: `playwright.config.ts`
- Modify: `tests/e2e/helpers/fixtures.ts`
- Create: `tests/fixtures/branding/organization-logo.png`

**Interfaces:**
- Consumes all previous tasks.
- Produces one production-bound acceptance spec included in the canonical five-project matrix.

- [ ] **Step 1: Add the zero-retry browser test and observe RED**

The test signs in as an isolated owner, uploads the fixture logo, verifies desktop/mobile staff branding, creates a cycle-backed tryout using guided fields, reloads saved values, completes setup, publishes, opens branded public registration, creates a participant, verifies staff visibility, traverses check-in/evaluation/decision/roster/message/report actions, replaces/removes the logo, and confirms `TF` fallback.

Use the strict request/console monitor already owned by Task 30; do not add blanket network allowances.

- [ ] **Step 2: Run focused Chromium and verify RED at the first missing boundary**

Run: `corepack npm exec -- playwright test tests/e2e/complete-branded-journey.spec.ts --project=chromium --retries=0`

Expected: FAIL until every slice is wired through the production build.

- [ ] **Step 3: Close only fixture/test integration gaps**

Add exact cleanup for the isolated organization logo row and generated auth/organization records. Do not weaken assertions or bypass real routes/RPCs.

- [ ] **Step 4: Run focused five-project browser acceptance**

Run: `corepack npm exec -- playwright test tests/e2e/complete-branded-journey.spec.ts --project=chromium --project=firefox --project=webkit --project='Mobile Chrome' --project='Mobile Safari' --retries=0`

Expected: 5/5 PASS, no retries, no skips, no horizontal overflow, no unexpected console/request errors.

- [ ] **Step 5: Commit browser acceptance**

```bash
git add tests/e2e playwright.config.ts tests/fixtures/branding/organization-logo.png
git commit -m "test: prove the complete branded tryout journey"
```

---

### Task 8: Run release gates, document evidence, and prepare integration

**Files:**
- Create: `.superpowers/sdd/2026-09-01-complete-tryout-flow-and-branding/report.md`
- Modify only if evidence finds a defect: owning source/test files from Tasks 1–7

**Interfaces:**
- Consumes the completed implementation.
- Produces a clean, reviewable branch and reproducible evidence ledger.

- [ ] **Step 1: Run formatting, lint, and type checks**

Run: `corepack npm run format:check && corepack npm run lint && corepack npm run typecheck`

Expected: exit 0.

- [ ] **Step 2: Run clean database and integration gates**

Run: `npm run supabase:reset && npm run test:db`

Run twice: `npm run test:integration`

Expected: full pgTAP PASS and both supervised integration passes PASS with zero harness residue.

- [ ] **Step 3: Run full bounded unit and contract gates**

Run: `corepack npm exec -- vitest run --config vitest.config.ts tests/unit --maxWorkers=2`

Run: the repository's provider-contract commands from `package.json`.

Expected: all units and contracts PASS.

- [ ] **Step 4: Run production build, marketing artifact, and focused browser matrix**

Run: `corepack npm run build && corepack npm run test:marketing:production`

Run the five-project command from Task 7.

Expected: production build and all five browser projects PASS with zero retries.

- [ ] **Step 5: Run dependency, secret, diff, and residue checks**

Run: `corepack npm audit --audit-level=high && git diff --check && git status --short`

Verify no owned processes listen on the E2E port and no isolated harness database/role/schema/session remains. Preserve unrelated processes and rows.

- [ ] **Step 6: Write the evidence report and commit it**

Record RED causes, GREEN commands/counts, migration/type hashes, browser projects, limitations, and external production prerequisites. Do not claim production logo delivery until deployed smoke testing occurs.

```bash
git add -f .superpowers/sdd/2026-09-01-complete-tryout-flow-and-branding/report.md
git commit -m "docs: record complete branded flow verification"
```

- [ ] **Step 7: Request fresh code review before merging**

Review the entire range from the design commit through the final evidence commit, with special attention to logo byte delivery, ACLs, cross-tenant scope, public branding cardinality, journey truthfulness, and responsive layout.
