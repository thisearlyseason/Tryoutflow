# TryoutFlow Frontend Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace TryoutFlow's raw and inconsistent interface with the approved Performance Lab design system, role-aware application shell, focused Game-Day workspaces, deterministic demo access, and visual regression protection without changing backend workflow semantics.

**Architecture:** Build a semantic component layer over the existing CSS variables, Tailwind v4 utilities, Next.js App Router, and server-authorized view models. Migrate route families in independently testable slices, keeping every existing application command and RPC boundary intact. Use canonical Chromium screenshots for pixel comparison and the existing five-project Playwright suite for interaction and accessibility behavior.

**Tech Stack:** Next.js 16.3.3, React 19.2.8, TypeScript 7, Tailwind CSS 4.3.3, Radix UI, Lucide React, Vitest, Testing Library, Playwright 1.62.1, local Supabase 2.116.0.

**Spec:** `docs/superpowers/specs/2026-09-01-frontend-remediation-design.md`

## Global Constraints

- Preserve every existing database migration, RPC contract, execution-time authorization check, idempotency key, CAS version, offline receipt, and audit behavior.
- Keep Performance Lab as the default light visual mode and scope Game-Day mode only to check-in, active evaluation, and live dashboard routes.
- Keep manager/director navigation comprehensive while evaluator and check-in roles receive focused workspaces.
- Maintain minimum 44 CSS pixel targets, visible focus, focus restoration, WCAG AA contrast, semantic landmarks, color-independent state, reduced-motion support, and 320–1920 CSS pixel usability.
- Do not expose PII, secrets, correlation details, provider tokens, or real credentials in markup, screenshots, browser logs, fixtures, or commits.
- Use synthetic Badlands data and the local-only demo identity `demo.owner@badlands.example.test`; never configure that credential outside local Supabase.
- Write and run the owning failing test before each production change. A visual test must fail for the intended visual contract, not because the browser fixture is broken.
- Keep cross-browser Playwright retries at `0`; canonical screenshot comparison runs in Chromium only.
- Do not add a general dark-mode preference, organization theming, or unrelated workflow behavior.

---

## File Structure

### Shared visual foundation

- `src/app/theme.css` — semantic Performance Lab and Game-Day tokens.
- `src/app/globals.css` — base element styles plus the bounded legacy semantic-class bridge.
- `src/components/ui/button.tsx` — button variants and pending behavior.
- `src/components/ui/link-button.tsx` — link actions with the same visual contract as buttons.
- `src/components/ui/input.tsx` — shared text input.
- `src/components/ui/select.tsx` — shared select control.
- `src/components/ui/textarea.tsx` — shared multiline control.
- `src/components/ui/form-field.tsx` — label, description, error, and control association.
- `src/components/ui/surface.tsx` — card, inset, metric, and decision surfaces.
- `src/components/ui/status-badge.tsx` — expanded semantic statuses.
- `src/components/ui/bib-badge.tsx` — athlete number identity.
- `src/components/ui/metric.tsx` — operational metric presentation.
- `src/components/layout/page-header.tsx` — page title, context, description, and actions.
- `src/components/layout/app-shell.tsx` — responsive application frame and visual mode.
- `src/components/layout/mobile-nav.tsx` — primary mobile destinations and More trigger.
- `src/components/layout/app-navigation.tsx` — desktop sidebar and mobile sheet.
- `src/components/feedback/workspace-state.tsx` — empty, unavailable, denied, conflict, offline, pending, and success variants.
- `tests/unit/components/design-system.test.tsx` — primitive and token contracts.
- `tests/unit/components/semantic-css-contract.test.ts` — undefined semantic-class prevention.

### Auth, onboarding, and demo

- `src/components/layout/auth-shell.tsx` — shared signed-out shell.
- `src/app/(auth)/**/page.tsx` — all authentication and onboarding routes.
- `src/modules/identity/ui/bot-challenge.tsx` and `turnstile-client.tsx` — visually complete challenge states.
- `scripts/ensure-local-demo-user.mjs` — idempotent local demo identity bootstrap.
- `tests/unit/identity/authentication-ui.test.tsx` — signed-out compositions.
- `tests/unit/identity/local-demo-user.test.ts` — local-only guard and stable identity contract.
- `tests/e2e/visual/auth-and-onboarding.visual.spec.ts` — canonical signed-out screenshots.

### Authenticated shell and command center

- `src/modules/organizations/components/app-navigation-model.ts` — pure role-aware navigation model.
- `src/modules/organizations/components/organization-navigation.tsx` — desktop/mobile navigation renderer.
- `src/modules/organizations/application/onboarding-progress.ts` — dashboard view model with authoritative facts.
- `src/modules/organizations/infrastructure/supabase-onboarding-progress-gateway.ts` — strict authoritative dashboard projection.
- `src/modules/organizations/components/onboarding-checklist.tsx` — next-action presentation.
- `src/modules/organizations/components/organization-command-center.tsx` — home metrics and milestones.
- `src/app/(app)/app/[organizationSlug]/layout.tsx` and `home/page.tsx` — shell integration.
- `tests/unit/organizations/app-navigation.test.tsx` and `onboarding-progress.test.tsx` — navigation and dashboard contracts.
- `tests/e2e/visual/application-shell.visual.spec.ts` — manager and mobile shell screenshots.

### Route-family remediation

- Tryout lifecycle and people routes under `src/app/(app)/app/[organizationSlug]/tryouts/**` and `athletes/**`.
- `src/modules/tryouts/ui/tryout-lifecycle.tsx` — authoritative lifecycle rail.
- `src/modules/rankings/ui/rankings-workspace.tsx` and `athlete-comparison.tsx` — evidence hierarchy.
- `src/modules/rosters/ui/{roster-builder,athlete-pool,team-roster,move-athlete-dialog,finalize-roster-dialog}.tsx` — decision-room composition.
- `src/modules/checkin/ui/checkin-workspace.tsx` and evaluation UI under `src/modules/evaluations/ui/**` — Game-Day workspaces.
- Secondary modules under communications, reports, staffing, organizations, subscriptions, integrations, and observability.
- Visual tests under `tests/e2e/visual/**` and helpers in `tests/e2e/helpers/visual.ts`.

---

### Task 1: Establish the Performance Lab semantic foundation

**Files:**

- Modify: `src/app/theme.css`
- Modify: `src/app/globals.css`
- Modify: `src/components/ui/button.tsx`
- Modify: `src/components/ui/input.tsx`
- Modify: `src/components/ui/status-badge.tsx`
- Modify: `src/components/feedback/empty-state.tsx`
- Modify: `src/components/feedback/error-state.tsx`
- Modify: `src/components/feedback/loading-state.tsx`
- Create: `src/components/ui/link-button.tsx`
- Create: `src/components/ui/select.tsx`
- Create: `src/components/ui/textarea.tsx`
- Create: `src/components/ui/form-field.tsx`
- Create: `src/components/ui/surface.tsx`
- Create: `src/components/ui/bib-badge.tsx`
- Create: `src/components/ui/metric.tsx`
- Create: `src/components/layout/page-header.tsx`
- Create: `src/components/feedback/workspace-state.tsx`
- Modify: `tests/unit/components/design-system.test.tsx`
- Create: `tests/unit/components/semantic-css-contract.test.ts`

**Interfaces:**

- Produces: `Button` with `variant: 'primary' | 'secondary' | 'quiet' | 'destructive'`.
- Produces: `LinkButton({ href, variant, children, ...anchorProps })` with the same variants.
- Produces: `FormField({ label, description, error, htmlFor, required, children })`.
- Produces: `Surface({ variant: 'card' | 'inset' | 'metric' | 'decision', as, children })`.
- Produces: `PageHeader({ eyebrow, title, description, actions, context })`.
- Produces: `WorkspaceState({ variant, title, description, action })` where `variant` is `empty | unavailable | denied | conflict | offline | pending | success`.
- Produces: `.theme-game-day` as the only route-level dark token override.

- [ ] **Step 1: Write the RED semantic-class and primitive contracts**

Add a source scanner that finds reserved semantic class names in TSX and proves each has a CSS definition. Keep the reserved prefixes bounded so Tailwind utilities are not treated as global CSS:

```ts
const reserved = /^(auth-|app-|button-|field-|workspace-|game-day$|card$|eyebrow$)/u;
const used = scanClassLiterals(resolve('src')).filter((name) => reserved.test(name));
const css = `${readFileSync('src/app/globals.css', 'utf8')}\n${readFileSync('src/app/theme.css', 'utf8')}`;

for (const className of used) {
  expect(css, `missing semantic CSS for .${className}`).toMatch(
    new RegExp(`\\.${escapeRegExp(className)}(?:[\\s:{,.#>]|$)`, 'u'),
  );
}
```

Extend `design-system.test.tsx` to render every new primitive and assert variant classes, accessible names, descriptions/errors, 44px targets, focus classes, Game-Day token presence, and color-independent labels.

- [ ] **Step 2: Run the RED tests and confirm the current defect**

Run:

```bash
corepack npm exec -- vitest run --config vitest.config.ts \
  tests/unit/components/semantic-css-contract.test.ts \
  tests/unit/components/design-system.test.tsx
```

Expected: FAIL because `auth-page`, `auth-card`, `card`, `eyebrow`, and button classes are undefined and the new primitives do not exist.

- [ ] **Step 3: Expand tokens and base element behavior**

Add semantic tokens without removing the approved base colors:

```css
:root {
  --color-canvas: #f7f3ea;
  --color-surface: #ffffff;
  --color-surface-raised: #fffdfa;
  --color-surface-inset: #eee8dc;
  --color-ink: #172131;
  --color-primary: #0057ff;
  --color-performance: #c7f000;
  --color-selection: #ff6b5f;
  --color-success: #177245;
  --color-warning: #9a5b00;
  --font-display: ui-sans-serif, system-ui, sans-serif;
  --font-score: ui-monospace, SFMono-Regular, Menlo, monospace;
  --font-bib: "Arial Black", "Arial Narrow", Impact, sans-serif;
  --content-reading: 72rem;
  --content-wide: 96rem;
}

.theme-game-day {
  --color-canvas: #07182b;
  --color-surface: #0d223b;
  --color-surface-raised: #132b47;
  --color-text: #f8fbff;
  --color-text-muted: #b9c7d7;
  --color-border: #36506d;
}
```

In `globals.css`, style `html`, `body`, headings, links, form inheritance, selection, and the bounded legacy classes. The legacy bridge makes existing routes coherent while later tasks replace ad hoc use with components.

- [ ] **Step 4: Implement the shared primitives**

Use focused components rather than a general class-variance dependency. For example:

```tsx
export function FormField({ label, description, error, htmlFor, required, children }: FormFieldProps) {
  const descriptionId = description ? `${htmlFor}-description` : undefined;
  const errorId = error ? `${htmlFor}-error` : undefined;
  return (
    <div className="field-group">
      <label className="field-label" htmlFor={htmlFor}>
        {label}{required ? <span aria-hidden="true"> *</span> : null}
      </label>
      {description ? <p id={descriptionId} className="field-description">{description}</p> : null}
      {children({ describedBy: [descriptionId, errorId].filter(Boolean).join(' ') || undefined })}
      {error ? <p id={errorId} className="field-error">{error}</p> : null}
    </div>
  );
}
```

Keep ref forwarding for native controls and retain accessible button names while busy.

- [ ] **Step 5: Run focused and full component tests**

Run:

```bash
corepack npm exec -- vitest run --config vitest.config.ts tests/unit/components
corepack npm run typecheck
corepack npm run lint
```

Expected: all component tests pass with no lint or type errors.

- [ ] **Step 6: Commit the foundation**

```bash
git add src/app/theme.css src/app/globals.css src/components tests/unit/components
git commit -m "feat: establish Performance Lab design system"
```

---

### Task 2: Redesign authentication, onboarding, and repeatable demo access

**Files:**

- Create: `src/components/layout/auth-shell.tsx`
- Modify: `src/app/(auth)/sign-in/page.tsx`
- Modify: `src/app/(auth)/sign-up/page.tsx`
- Modify: `src/app/(auth)/forgot-password/page.tsx`
- Modify: `src/app/(auth)/reset-password/page.tsx`
- Modify: `src/app/(auth)/verify-email/page.tsx`
- Modify: `src/app/(auth)/invite/[token]/page.tsx`
- Modify: `src/app/(auth)/start/page.tsx`
- Modify: `src/modules/identity/ui/bot-challenge.tsx`
- Modify: `src/modules/identity/ui/turnstile-client.tsx`
- Create: `scripts/ensure-local-demo-user.mjs`
- Modify: `package.json`
- Create: `tests/unit/identity/authentication-ui.test.tsx`
- Create: `tests/unit/identity/local-demo-user.test.ts`
- Modify: `tests/unit/identity/turnstile-client.test.tsx`
- Create: `tests/e2e/visual/auth-and-onboarding.visual.spec.ts`
- Create: `playwright.visual.config.ts`

**Interfaces:**

- Consumes: Task 1 primitives.
- Produces: `AuthShell({ eyebrow, title, description, children, footer, proofItems })`.
- Produces: `npm run demo:local` which idempotently provisions the local synthetic owner, requires the password through an untracked environment variable, and prints only the fixed local email plus a reminder that the password is local test data.
- Produces: canonical Chromium screenshots in `tests/e2e/visual/__screenshots__/`.

- [ ] **Step 1: Write RED auth composition and demo-safety tests**

Render the signed-out routes or extracted compositions and assert branded landmarks, one `h1`, field associations, explicit bot states, and recovery links. Test the demo script through an exported pure guard:

```ts
expect(assertLocalSupabaseUrl('http://127.0.0.1:54321')).toEqual(new URL('http://127.0.0.1:54321'));
expect(() => assertLocalSupabaseUrl('https://project.supabase.co')).toThrow('local Supabase only');
expect(DEMO_USER).toEqual({
  email: 'demo.owner@badlands.example.test',
  organizationId: '29000000-0000-4000-8000-000000000001',
  role: 'owner',
});
```

Add a visual test that masks the Turnstile iframe but not the form:

```ts
test('sign-in matches Performance Lab', async ({ page }) => {
  await page.goto('/sign-in');
  await expect(page.getByRole('heading', { name: 'Sign in to your organization' })).toBeVisible();
  await expect(page).toHaveScreenshot('sign-in-performance-lab.png', {
    animations: 'disabled',
    mask: [page.locator('iframe[title*="challenge" i]')],
  });
});
```

- [ ] **Step 2: Run RED unit and screenshot tests**

Run:

```bash
corepack npm exec -- vitest run --config vitest.config.ts \
  tests/unit/identity/authentication-ui.test.tsx \
  tests/unit/identity/local-demo-user.test.ts \
  tests/unit/identity/turnstile-client.test.tsx
corepack npm exec -- playwright test --config=playwright.visual.config.ts \
  tests/e2e/visual/auth-and-onboarding.visual.spec.ts --project=chromium
```

Expected: unit failures for missing shell/demo guard and screenshot mismatch showing the raw layout.

- [ ] **Step 3: Implement `AuthShell` and migrate every signed-out page**

Use one layout with a proof panel and a form panel:

```tsx
<main className="auth-page">
  <section className="auth-proof" aria-label="TryoutFlow product summary">
    <BrandMark />
    <p className="eyebrow">From registration to final roster</p>
    <h2>Run every tryout decision from one durable workspace.</h2>
    <ul>{proofItems.map((item) => <li key={item}>{item}</li>)}</ul>
  </section>
  <section className="auth-card" aria-labelledby={headingId}>
    {children}
  </section>
</main>
```

Replace raw inputs/buttons with Task 1 primitives while preserving form actions, field names, `next`, server redirects, and exact error-code mappings.

- [ ] **Step 4: Complete Turnstile visual states**

Render explicit `loading`, `ready`, `expired`, `failed`, and `unavailable` status copy in the existing dynamic lifecycle. Do not change verification order, token handling, or production configuration requirements.

- [ ] **Step 5: Implement repeatable local demo bootstrap**

Use local Supabase status output, service-role GoTrue Admin, and idempotent profile/membership upserts. Refuse non-loopback Supabase hosts before making requests. The script must create or update only `demo.owner@badlands.example.test`, confirm the email locally, bind it to Badlands as owner, and never write the password to tracked files or the database seed.

Add:

```json
"demo:local": "node scripts/ensure-local-demo-user.mjs"
```

Require the password through `TRYOUTFLOW_LOCAL_DEMO_PASSWORD`; fail before any request if it is missing. The known local walkthrough value remains `TryoutFlowDemo!2026`, but the script and documentation must show it only as a shell environment value, never as a production default or stored database value.

- [ ] **Step 6: Run focused tests and update canonical screenshots**

Run unit tests, then run the visual spec once without update to confirm mismatch, inspect the artifact, and run:

```bash
corepack npm exec -- playwright test --config=playwright.visual.config.ts \
  tests/e2e/visual/auth-and-onboarding.visual.spec.ts --project=chromium --update-snapshots
corepack npm exec -- playwright test --config=playwright.visual.config.ts \
  tests/e2e/visual/auth-and-onboarding.visual.spec.ts --project=chromium
```

- [ ] **Step 7: Prove the demo identity works after reset**

Run:

```bash
corepack npm exec -- supabase db reset --local
TRYOUTFLOW_LOCAL_DEMO_PASSWORD='TryoutFlowDemo!2026' corepack npm run demo:local
```

Use the GoTrue password endpoint in an automated integration test or script assertion and verify the owner can load `/app/badlands-hockey-academy/home` without changing seeded domain rows.

- [ ] **Step 8: Commit auth and onboarding**

```bash
git add src/components/layout/auth-shell.tsx 'src/app/(auth)' src/modules/identity/ui \
  scripts/ensure-local-demo-user.mjs package.json tests/unit/identity tests/e2e/visual \
  playwright.visual.config.ts
git commit -m "feat: redesign authentication and onboarding"
```

---

### Task 3: Build the role-aware application shell and command center

**Files:**

- Modify: `src/components/layout/app-shell.tsx`
- Modify: `src/components/layout/mobile-nav.tsx`
- Create: `src/components/layout/app-navigation.tsx`
- Create: `src/modules/organizations/components/app-navigation-model.ts`
- Modify: `src/modules/organizations/components/organization-navigation.tsx`
- Modify: `src/modules/organizations/application/onboarding-progress.ts`
- Modify: `src/modules/organizations/infrastructure/supabase-onboarding-progress-gateway.ts`
- Modify: `src/modules/organizations/components/onboarding-checklist.tsx`
- Create: `src/modules/organizations/components/organization-command-center.tsx`
- Modify: `src/app/(app)/app/[organizationSlug]/layout.tsx`
- Modify: `src/app/(app)/app/[organizationSlug]/home/page.tsx`
- Create: `tests/unit/organizations/app-navigation.test.tsx`
- Modify: `tests/unit/organizations/onboarding-progress.test.tsx`
- Create: `tests/e2e/visual/application-shell.visual.spec.ts`

**Interfaces:**

- Consumes: Task 1 primitives and existing `AuthorizationContext`.
- Produces: `buildAppNavigation({ authorization, organizationSlug }) => NavigationGroup[]`.
- Produces: `AppShell({ children, organization, roleLabel, navigation, mode?: 'lab' | 'game-day' })`.
- Produces: `OrganizationDashboardProjection = { facts: OnboardingFacts; progress: OnboardingProgress }`.

- [ ] **Step 1: Write RED navigation and dashboard tests**

Prove exact role behavior through the pure model:

```ts
expect(buildAppNavigation({ authorization: owner, organizationSlug: 'badlands' }))
  .toEqual(expect.arrayContaining([
    expect.objectContaining({ label: 'Overview' }),
    expect.objectContaining({ label: 'Organization' }),
  ]));
expect(flattenNavigation(evaluator)).toEqual([
  expect.objectContaining({ label: 'Evaluate', href: '/app/badlands/evaluate' }),
]);
expect(flattenNavigation(checkin)).not.toEqual(
  expect.arrayContaining([expect.objectContaining({ label: 'Billing' })]),
);
```

Update onboarding tests to assert metrics come from exact durable facts and missing projection remains unavailable rather than zero.

- [ ] **Step 2: Run RED tests**

```bash
corepack npm exec -- vitest run --config vitest.config.ts \
  tests/unit/organizations/app-navigation.test.tsx \
  tests/unit/organizations/onboarding-progress.test.tsx
```

Expected: FAIL because grouped navigation, mobile More behavior, and dashboard projection do not exist.

- [ ] **Step 3: Implement the pure navigation model**

Return groups with stable IDs and role-authorized items:

```ts
export type NavigationItem = Readonly<{
  href: string;
  label: string;
  accessibleLabel?: string;
  icon: 'home' | 'tryouts' | 'athletes' | 'evaluate' | 'reports' | 'organization';
}>;
export type NavigationGroup = Readonly<{ id: string; label: string; items: readonly NavigationItem[] }>;
```

Preserve the exact existing scoped tryout URLs for directors, reviewers, evaluators, and check-in users.

- [ ] **Step 4: Implement desktop sidebar and mobile navigation**

Render organization identity, role label, grouped links, current-page state, account controls, and the mobile primary bar/More sheet. Use `prefetch={false}` where the existing route intentionally avoids superseded Server Action requests.

- [ ] **Step 5: Upgrade the authoritative home projection**

Change the gateway to return both parsed facts and derived progress:

```ts
export type OrganizationDashboardProjection = Readonly<{
  facts: OnboardingFacts;
  progress: OnboardingProgress;
}>;

return facts ? { facts, progress: deriveOnboardingProgress(facts) } : null;
```

Compose metric cards for staff, sessions, completed evaluations, and finalized rosters, followed by the setup checklist and its exact next action. Do not infer active tryout state not present in the RPC.

- [ ] **Step 6: Run unit and shell visual tests**

Generate and inspect desktop and 390px mobile screenshots for an owner and an evaluator. Confirm navigation content is based on role, not CSS hiding.

- [ ] **Step 7: Run affected browser behavior**

```bash
corepack npm exec -- playwright test --project=chromium --retries=0 \
  tests/e2e/role-denials.spec.ts tests/e2e/responsive-and-accessibility.spec.ts
```

- [ ] **Step 8: Commit shell and home**

```bash
git add src/components/layout src/modules/organizations 'src/app/(app)/app/[organizationSlug]/layout.tsx' \
  'src/app/(app)/app/[organizationSlug]/home/page.tsx' tests/unit/organizations \
  tests/e2e/visual/application-shell.visual.spec.ts
git commit -m "feat: add role-aware application shell"
```

---

### Task 4: Remediate tryout lifecycle, registration, athlete, staffing, and report routes

**Files:**

- Create: `src/modules/tryouts/ui/tryout-lifecycle.tsx`
- Modify: `src/modules/tryouts/ui/tryout-wizard.tsx`
- Modify: `src/modules/tryouts/ui/registration-share.tsx`
- Modify: `src/modules/staffing/ui/assignment-workspace.tsx`
- Modify: `src/modules/registration/ui/csv-import-wizard.tsx`
- Modify: `src/modules/registration/ui/duplicate-review-action.tsx`
- Modify: `src/modules/reports/ui/reports-page.tsx`
- Modify: `src/app/(app)/app/[organizationSlug]/tryouts/page.tsx`
- Modify: `src/app/(app)/app/[organizationSlug]/tryouts/new/page.tsx`
- Modify: `src/app/(app)/app/[organizationSlug]/tryouts/[tryoutId]/overview/page.tsx`
- Modify: `src/app/(app)/app/[organizationSlug]/tryouts/[tryoutId]/setup/[step]/page.tsx`
- Modify: `src/app/(app)/app/[organizationSlug]/tryouts/[tryoutId]/registration/page.tsx`
- Modify: `src/app/(app)/app/[organizationSlug]/tryouts/[tryoutId]/sessions/page.tsx`
- Modify: `src/app/(app)/app/[organizationSlug]/tryouts/[tryoutId]/staff/page.tsx`
- Modify: `src/app/(app)/app/[organizationSlug]/athletes/page.tsx`
- Modify: `src/app/(app)/app/[organizationSlug]/athletes/[athleteId]/page.tsx`
- Modify: `src/app/(app)/app/[organizationSlug]/athletes/import/page.tsx`
- Modify: `src/app/(app)/app/[organizationSlug]/athletes/duplicates/page.tsx`
- Modify: `src/app/(app)/app/[organizationSlug]/evaluators/page.tsx`
- Modify: `src/app/(app)/app/[organizationSlug]/reports/page.tsx`
- Modify: `src/app/(app)/app/[organizationSlug]/tryouts/[tryoutId]/reports/page.tsx`
- Modify: `src/app/(registration)/register/[tryoutSlug]/page.tsx`
- Modify: `src/app/(registration)/register/[tryoutSlug]/registration-form.tsx`
- Modify: `src/app/(registration)/register/[tryoutSlug]/confirmation/page.tsx`
- Modify: `src/app/(registration)/register/[tryoutSlug]/confirmation/registration-confirmation-client.tsx`
- Create: `tests/unit/tryouts/tryout-lifecycle-ui.test.tsx`
- Modify: `tests/unit/tryouts/tryout-overview-loader.test.tsx`
- Modify: `tests/unit/reports/reports-page.test.tsx`
- Modify: `tests/unit/registration/confirmation-page.test.tsx`
- Modify: `tests/unit/registration/public-registration-loader.test.ts`
- Create: `tests/e2e/visual/tryout-administration.visual.spec.ts`

**Interfaces:**

- Consumes: Tasks 1 and 3 layout primitives.
- Produces: `TryoutLifecycle({ current, hrefs, counts? })` where `current` is `draft | published | registration | evaluation | decisions | finalized`.
- Preserves: all existing server actions, route loaders, test-failure injection, and non-oracular behavior.

- [ ] **Step 1: Write RED lifecycle and route-state tests**

Assert the lifecycle uses an ordered list with current-step semantics and never marks a stage complete without authoritative input:

```tsx
render(<TryoutLifecycle current="evaluation" hrefs={authorizedHrefs} />);
expect(screen.getByRole('list', { name: 'Tryout lifecycle' })).toBeVisible();
expect(screen.getByText('Evaluation')).toHaveAttribute('aria-current', 'step');
expect(screen.getByText('Finalized')).not.toHaveAttribute('data-complete', 'true');
```

Add route component assertions for filtered-empty versus true-empty, retry actions, exact display names, report unavailable warnings, and the public registration/confirmation states.

- [ ] **Step 2: Run RED tests**

Run the new lifecycle test plus current tryout, reports, registration, and staffing unit suites. Confirm failures are presentation-contract failures only.

- [ ] **Step 3: Implement lifecycle and shared administration patterns**

Use `PageHeader`, `Surface`, `FormField`, `WorkspaceState`, `Metric`, and `LinkButton` throughout. The lifecycle rail receives only route-authorized links. Replace raw status strings with labeled badges while preserving exact underlying state.

- [ ] **Step 4: Migrate tryout setup and operations routes**

Give create/setup screens a clear step frame, bounded form width, persistent progress context, local validation adjacency, and one primary action. Give registration, sessions, and staff routes responsive operational cards/tables with truthful counts and empty states.

- [ ] **Step 5: Migrate people and report routes**

Use bib-forward athlete rows, exact authorized identity, responsive details, safe CSV affordances, and explicit unavailable/partial report states. Preserve current projection privacy and maximum-row behavior.

- [ ] **Step 6: Migrate public registration and confirmation**

Use a branded public shell aligned with Performance Lab, a clear tryout summary, grouped guardian/athlete fields, explicit consent and Turnstile states, local validation adjacency, safe submission pending state, and a confirmation timeline. Preserve the bounded request parser, bot-before-write order, idempotency token handling, reissue limits, and non-oracular responses.

- [ ] **Step 7: Add canonical administration screenshots**

Capture owner tryout list, published overview/lifecycle, registration administration, public registration, confirmation, athlete directory, and reports at 1440×1000 and 390×844. Mask only unpredictable browser-owned content; keep all seeded product data visible.

- [ ] **Step 8: Run affected behavior suites**

```bash
corepack npm exec -- vitest run --config vitest.config.ts \
  tests/unit/tryouts tests/unit/reports tests/unit/organizations tests/unit/registration
corepack npm exec -- playwright test --project=chromium --retries=0 \
  tests/e2e/critical-lifecycle.spec.ts tests/e2e/onboarding-and-reports.spec.ts \
  tests/e2e/guardian-registration.spec.ts tests/e2e/viewports.spec.ts
```

- [ ] **Step 9: Commit lifecycle administration**

```bash
git add src/modules/tryouts src/modules/staffing src/modules/registration src/modules/reports \
  'src/app/(app)/app/[organizationSlug]/tryouts' \
  'src/app/(app)/app/[organizationSlug]/athletes' \
  'src/app/(app)/app/[organizationSlug]/evaluators/page.tsx' \
  'src/app/(app)/app/[organizationSlug]/reports/page.tsx' \
  'src/app/(registration)' \
  tests/unit/tryouts tests/unit/reports tests/e2e/visual/tryout-administration.visual.spec.ts
git commit -m "feat: redesign tryout administration workflows"
```

---

### Task 5: Build rankings evidence and roster decision-room experiences

**Files:**

- Modify: `src/modules/rankings/ui/rankings-workspace.tsx`
- Modify: `src/modules/rankings/ui/athlete-comparison.tsx`
- Modify: `src/modules/rosters/ui/roster-builder.tsx`
- Modify: `src/modules/rosters/ui/athlete-pool.tsx`
- Modify: `src/modules/rosters/ui/team-roster.tsx`
- Modify: `src/modules/rosters/ui/move-athlete-dialog.tsx`
- Modify: `src/modules/rosters/ui/finalize-roster-dialog.tsx`
- Modify: `src/app/(app)/app/[organizationSlug]/tryouts/[tryoutId]/rankings/page.tsx`
- Modify: `src/app/(app)/app/[organizationSlug]/tryouts/[tryoutId]/rankings/loading.tsx`
- Modify: `src/app/(app)/app/[organizationSlug]/tryouts/[tryoutId]/compare/page.tsx`
- Modify: `src/app/(app)/app/[organizationSlug]/tryouts/[tryoutId]/compare/loading.tsx`
- Modify: `src/app/(app)/app/[organizationSlug]/tryouts/[tryoutId]/rosters/page.tsx`
- Modify: `tests/unit/rankings/rankings-workspace.test.tsx`
- Modify: `tests/unit/rosters/roster-builder.test.tsx`
- Create: `tests/e2e/visual/decisions.visual.spec.ts`

**Interfaces:**

- Consumes: existing `RankingPage` and `RosterWorkspaceSnapshot` without broadening either schema.
- Preserves: exact display names, ranking unavailable semantics, DnD plus explicit control parity, CAS versions, focus restoration, immutable finalized views, revision history, and action result discriminators.

- [ ] **Step 1: Write RED evidence-hierarchy and decision-room tests**

Assert bib/identity, score/evidence labels, selected-comparison state, unavailable evidence, draft/finalized distinction, team targets, decision state, and dialog focus recovery. Example:

```tsx
const card = screen.getByTestId(`ranking-athlete-${athleteId}`);
expect(within(card).getByText('92.0000')).toHaveClass('score-value');
expect(within(card).getByText('3 of 3 evaluators')).toBeVisible();
expect(within(card).getByText('Ranking evidence unavailable')).not.toHaveTextContent('0');
```

- [ ] **Step 2: Run RED ranking and roster unit tests**

Confirm new structural assertions fail while existing mutation and concurrency assertions remain green.

- [ ] **Step 3: Remediate rankings and compare**

Use a sticky/filterable evidence toolbar on wide screens, responsive athlete evidence cards/rows, strong score typography, bib identity, completion/range labels, decision state, and clear comparison selection. Do not calculate new scores in UI code.

- [ ] **Step 4: Remediate the roster decision room**

Create a responsive three-zone composition: athlete pool, team destinations, and decision/action context. Keep DnD sensors and handlers unchanged; make explicit Move and decision controls equally prominent and keyboard complete. Finalized mode removes edit affordances and emphasizes snapshot time, revision, and audit truth.

- [ ] **Step 5: Add visual baselines and affected E2E**

Capture rankings desktop/mobile, compare desktop, roster draft desktop/mobile, and finalized roster. Then run ranking, roster finalization, concurrency, replay, accessibility, and viewport specs in Chromium.

- [ ] **Step 6: Run focused verification**

```bash
corepack npm exec -- vitest run --config vitest.config.ts tests/unit/rankings tests/unit/rosters
corepack npm exec -- playwright test --project=chromium --retries=0 \
  tests/e2e/rankings-and-comparison.spec.ts tests/e2e/roster-finalization.spec.ts \
  tests/e2e/concurrency-and-replay.spec.ts tests/e2e/accessibility.spec.ts
```

- [ ] **Step 7: Commit decision workflows**

```bash
git add src/modules/rankings src/modules/rosters \
  'src/app/(app)/app/[organizationSlug]/tryouts/[tryoutId]/rankings' \
  'src/app/(app)/app/[organizationSlug]/tryouts/[tryoutId]/compare' \
  'src/app/(app)/app/[organizationSlug]/tryouts/[tryoutId]/rosters/page.tsx' \
  tests/unit/rankings tests/unit/rosters tests/e2e/visual/decisions.visual.spec.ts
git commit -m "feat: add evidence-first decision workspaces"
```

---

### Task 6: Add focused Game-Day check-in, evaluation, and live workspaces

**Files:**

- Modify: `src/components/layout/app-shell.tsx`
- Modify: `src/modules/checkin/ui/checkin-workspace.tsx`
- Modify: `src/modules/checkin/ui/issue-qr-button.tsx`
- Modify: `src/modules/evaluations/ui/athlete-pager.tsx`
- Modify: `src/modules/evaluations/ui/evaluation-form.tsx`
- Modify: `src/modules/evaluations/ui/save-state.tsx`
- Modify: `src/modules/evaluations/ui/score-control.tsx`
- Modify: `src/modules/evaluations/ui/session-state.tsx`
- Modify: `src/modules/evaluations/ui/synchronized-evaluation-form.tsx`
- Modify: `src/app/(app)/app/[organizationSlug]/tryouts/[tryoutId]/check-in/page.tsx`
- Modify: `src/app/(app)/app/[organizationSlug]/tryouts/[tryoutId]/live/page.tsx`
- Modify: `src/app/(app)/app/[organizationSlug]/tryouts/[tryoutId]/live/loading.tsx`
- Modify: `src/app/(app)/app/[organizationSlug]/evaluate/page.tsx`
- Modify: `src/app/(app)/app/[organizationSlug]/evaluate/profile/page.tsx`
- Modify: `src/app/(app)/app/[organizationSlug]/evaluate/session/[sessionId]/page.tsx`
- Modify: `src/app/(app)/app/[organizationSlug]/evaluate/session/[sessionId]/athletes/page.tsx`
- Modify: `src/app/(app)/app/[organizationSlug]/evaluate/session/[sessionId]/athletes/[registrationId]/page.tsx`
- Modify: `src/app/(app)/app/[organizationSlug]/evaluate/session/[sessionId]/progress/page.tsx`
- Modify: `src/app/(app)/app/[organizationSlug]/evaluate/session/[sessionId]/loading.tsx`
- Modify: `tests/unit/checkin/checkin.test.tsx`
- Modify: `tests/unit/evaluations/evaluation-form.test.tsx`
- Create: `tests/e2e/visual/game-day.visual.spec.ts`

**Interfaces:**

- Consumes: `.theme-game-day` and existing check-in/evaluation application contracts.
- Produces: Game-Day presentation only when a route explicitly passes `mode="game-day"` or wraps content in the bounded class.
- Preserves: duplicate-action guards, offline queue, save-state truth, conflict resolution, exact request keys, progress, and role authorization.

- [ ] **Step 1: Write RED Game-Day state tests**

Assert theme scoping, large participant identity, pending/search/check-in states, offline/pending/durable save distinctions, conflict recovery, and progress. Ensure the rest of the app does not inherit `.theme-game-day`.

- [ ] **Step 2: Run RED tests**

Run check-in and evaluation UI tests. The new mode and structural expectations must fail without changing existing behavior assertions.

- [ ] **Step 3: Implement Game-Day route scoping**

Add an explicit shell mode:

```tsx
export function AppShell({ mode = 'lab', ...props }: AppShellProps) {
  return <div className={mode === 'game-day' ? 'theme-game-day app-frame' : 'app-frame'}>{/* ... */}</div>;
}
```

Route layouts or page compositions pass the mode only for check-in, active evaluation, and live dashboard content.

- [ ] **Step 4: Remediate check-in and live dashboard**

Use a prominent search/scan control, placement context, bib-forward results, unmistakable eligibility, and local action feedback. Live metrics use high-contrast operational cards and truthful explanatory copy. Keep search and check-in locking code untouched.

- [ ] **Step 5: Remediate evaluation workspace**

Use large athlete identity, session progress, rubric sections, score controls, private-note boundary, sticky save/completion action area, and explicit local/sync/conflict status. Preserve existing controlled form state and offline repository calls.

- [ ] **Step 6: Add Game-Day screenshots and run high-risk repeats**

Capture check-in search/results, evaluator form with saved state, evaluator offline state, and live dashboard at desktop/mobile. Then run check-in, mobile evaluation, offline, viewport, and high-risk repeat scenarios with retries disabled.

- [ ] **Step 7: Verify focused behavior**

```bash
corepack npm exec -- vitest run --config vitest.config.ts tests/unit/checkin tests/unit/evaluations
corepack npm exec -- playwright test --project=chromium --project=webkit \
  --project='Mobile Chrome' --project='Mobile Safari' --retries=0 \
  tests/e2e/checkin.spec.ts tests/e2e/mobile-evaluation.spec.ts \
  tests/e2e/responsive-and-accessibility.spec.ts
```

- [ ] **Step 8: Commit Game-Day workflows**

```bash
git add src/components/layout/app-shell.tsx src/modules/checkin src/modules/evaluations/ui \
  'src/app/(app)/app/[organizationSlug]/tryouts/[tryoutId]/check-in/page.tsx' \
  'src/app/(app)/app/[organizationSlug]/tryouts/[tryoutId]/live' \
  'src/app/(app)/app/[organizationSlug]/evaluate' tests/unit/checkin tests/unit/evaluations \
  tests/e2e/visual/game-day.visual.spec.ts
git commit -m "feat: add focused Game-Day workspaces"
```

---

### Task 7: Unify communications and secondary administration

**Files:**

- Modify: `src/modules/communications/ui/message-composer.tsx`
- Modify: `src/modules/communications/ui/delivery-status.tsx`
- Modify: `src/modules/integrations/ui/integration-card.tsx`
- Modify: `src/modules/integrations/ui/roster-export-wizard.tsx`
- Modify: `src/modules/integrations/ui/roster-export-link.tsx`
- Modify: `src/modules/subscriptions/ui/plan-card.tsx`
- Modify: `src/modules/subscriptions/ui/plan-grid.tsx`
- Modify: `src/modules/organizations/components/invite-member-form.tsx`
- Modify: `src/modules/observability/ui/platform-administration.tsx`
- Modify: `src/app/(app)/app/[organizationSlug]/tryouts/[tryoutId]/messages/page.tsx`
- Modify: `src/app/(app)/app/[organizationSlug]/organization/members/page.tsx`
- Modify: `src/app/(app)/app/[organizationSlug]/organization/integrations/page.tsx`
- Modify: `src/app/(app)/app/[organizationSlug]/organization/billing/page.tsx`
- Modify: `src/app/(app)/app/[organizationSlug]/organization/audit/page.tsx`
- Modify: `src/app/(app)/app/[organizationSlug]/organization/settings/page.tsx`
- Modify: `src/app/(app)/app/[organizationSlug]/tryouts/[tryoutId]/rosters/[rosterVersionId]/export/page.tsx`
- Modify: `src/app/(platform)/platform/layout.tsx`
- Modify: `src/app/(platform)/platform/error.tsx`
- Modify: `src/app/(platform)/platform/health/page.tsx`
- Modify: `src/app/(platform)/platform/organizations/page.tsx`
- Modify: `src/app/(platform)/platform/subscriptions/page.tsx`
- Modify: `src/app/(platform)/platform/audit/page.tsx`
- Modify: `src/app/(platform)/platform/support/page.tsx`
- Modify: existing focused UI tests under `tests/unit/communications`, `integrations`, `subscriptions`, `organizations`, and `observability`
- Create: `tests/e2e/visual/administration.visual.spec.ts`

**Interfaces:**

- Consumes: Tasks 1 and 3 workspace patterns.
- Preserves: exact message preview/confirmation, template CAS, delivery truth, integration idempotency, provider uncertainty, billing intent fencing, membership authority, audit privacy, and platform 404/unavailable behavior.

- [ ] **Step 1: Write RED secondary-workspace composition tests**

For each module, assert `PageHeader`, bounded panels, local action status, true empty/unavailable distinctions, and one dominant action. Retain all existing strict schema and exact-result assertions.

- [ ] **Step 2: Run focused RED suites**

Run the existing communication, integration, billing, membership, reports, and platform UI tests with the new structural assertions.

- [ ] **Step 3: Migrate communication and integration surfaces**

Present recipients, preview content, confirmation proof, batch state, delivery state, provider connection, export mapping, partial failure, retry, and manual-attention state through shared panels. Never collapse `delivery_uncertain` into ordinary failure.

- [ ] **Step 4: Migrate organization and billing surfaces**

Use responsive member rows, role/status badges, guarded ownership transfer, invitation actions, plan comparison, subscription truth, audit entries, and settings forms. Preserve current route action payloads and focus behavior.

- [ ] **Step 5: Migrate platform administration**

Use the same primitives with a restricted-operations visual marker. Preserve coarse public health, platform authorization, safe projections, support elevation bounds, and false-404 behavior.

- [ ] **Step 6: Add representative administration screenshots**

Capture messages preview, members, billing active state, integration partial/retry state, and platform overview. Use only synthetic seeded data.

- [ ] **Step 7: Run focused verification**

```bash
corepack npm exec -- vitest run --config vitest.config.ts \
  tests/unit/communications tests/unit/integrations tests/unit/subscriptions \
  tests/unit/organizations tests/unit/observability
corepack npm exec -- playwright test --project=chromium --retries=0 \
  tests/e2e/decision-messages.spec.ts tests/e2e/mock-roster-export.spec.ts \
  tests/e2e/subscriptions.spec.ts tests/e2e/platform-administration.spec.ts
```

- [ ] **Step 8: Commit secondary administration**

```bash
git add src/modules/communications src/modules/integrations src/modules/subscriptions \
  src/modules/organizations/components src/modules/observability/ui \
  'src/app/(app)/app/[organizationSlug]/organization' \
  'src/app/(app)/app/[organizationSlug]/tryouts/[tryoutId]/messages/page.tsx' \
  'src/app/(app)/app/[organizationSlug]/tryouts/[tryoutId]/rosters/[rosterVersionId]/export/page.tsx' \
  'src/app/(platform)' tests/unit tests/e2e/visual/administration.visual.spec.ts
git commit -m "feat: unify administration workspaces"
```

---

### Task 8: Close visual regression, accessibility, and release verification

**Files:**

- Create: `tests/e2e/helpers/visual.ts`
- Modify: `playwright.visual.config.ts`
- Modify: all files under `tests/e2e/visual/`
- Modify: `playwright.config.ts`
- Modify: `package.json`
- Modify: `scripts/verify-production-readiness.sh`
- Modify: `README.md`
- Create: `docs/runbooks/frontend-visual-regression.md`
- Modify: `docs/superpowers/specs/2026-09-01-frontend-remediation-design.md` only if implementation evidence reveals a clarified, non-behavioral constraint; otherwise leave the approved spec unchanged.

**Interfaces:**

- Produces: `npm run test:visual` for canonical Chromium comparison.
- Produces: `npm run test:visual:update` for intentional baseline review.
- Produces: a release stage that runs comparison only, never updates snapshots.
- Preserves: the existing strict five-project `test:e2e` gate and release cleanup behavior.

- [ ] **Step 1: Write RED visual-gate script tests**

Extend the release-contract unit test to require a visual comparison stage after build and before the full interaction matrix. Assert update mode is absent from the release script:

```ts
expect(releaseScript).toContain("run_stage 'canonical visual regression' npm run test:visual");
expect(releaseScript).not.toContain('--update-snapshots');
```

- [ ] **Step 2: Run RED release-contract tests**

Run the owning release-script test and confirm it fails because the visual stage and npm commands are missing.

- [ ] **Step 3: Stabilize visual fixtures**

In `tests/e2e/helpers/visual.ts`, provide fixed viewport, reduced-motion, locale/timezone, font-ready wait, animation disabling, deterministic seeded login, and screenshot options:

```ts
export async function prepareVisualPage(page: Page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addStyleTag({ content: '*,*::before,*::after{caret-color:transparent!important}' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState('networkidle');
}
```

Do not mask product content that should be stable; fix unstable fixtures at their source.

- [ ] **Step 4: Add package and release commands**

Add:

```json
"test:visual": "playwright test --config=playwright.visual.config.ts --project=chromium --retries=0",
"test:visual:update": "npm run test:visual -- --update-snapshots"
```

Insert `canonical visual regression` into `scripts/verify-production-readiness.sh` after production builds and before the five-project E2E stage. Ensure existing failure cleanup still resets local Supabase and proves zero owned residue.

- [ ] **Step 5: Run the canonical visual suite twice**

```bash
corepack npm run test:visual
corepack npm run test:visual
```

Expected: identical source passes twice with no updated files and no retries.

- [ ] **Step 6: Run full component and behavior verification**

```bash
corepack npm run verify
corepack npm run test:integration
corepack npm run test:integration
corepack npm run test:contract
corepack npm run test:e2e -- --retries=0
corepack npm audit --audit-level=high
git diff --check
```

Expected: unit, integration, contract, five-project browser, accessibility, build, audit, and diff gates pass. No skipped critical visual scenario is acceptable.

- [ ] **Step 7: Run the exact production-readiness controller twice**

```bash
bash scripts/verify-production-readiness.sh
bash scripts/verify-production-readiness.sh
```

Both runs must start at stage 1, exit 0 on identical source, compare screenshots without updating, finish with an unseeded local reset, and report zero owned auth/database/process/port residue.

- [ ] **Step 8: Document intentional baseline updates**

The runbook must require:

1. Run the visual test without update and inspect every diff.
2. Confirm the change matches the approved design and contains synthetic data only.
3. Run `npm run test:visual:update` intentionally.
4. Review the staged PNG diff.
5. Re-run `npm run test:visual` twice before commit.

- [ ] **Step 9: Commit final regression and documentation**

```bash
git add tests/e2e/visual tests/e2e/helpers/visual.ts playwright.visual.config.ts \
  playwright.config.ts package.json scripts/verify-production-readiness.sh \
  README.md docs/runbooks/frontend-visual-regression.md
git commit -m "test: enforce frontend visual quality"
```

- [ ] **Step 10: Final repository audit**

Run:

```bash
git status --short
git diff --check HEAD~8..HEAD
git log --oneline -8
```

Expected: clean tracked worktree, no unreviewed generated artifacts, and one independently reviewable commit per delivery slice.
