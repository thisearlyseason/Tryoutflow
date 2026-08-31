# Task 28 report — public marketing experience

## Status

Implemented and verified locally.

## TDD and debugging evidence

- The initial focused marketing unit suite was RED because the public route group and its shared marketing components did not exist.
- The completed focused unit suite is GREEN: 18 assertions cover all nine public routes, one H1 per route, index/follow metadata, route-specific canonicals, factual product proof, catalog-derived CAD pricing, semantic keyboard-visible navigation, no authenticated fetch during rendering, and concrete legal-draft content.
- The reduced-motion browser failure was traced to a test-unit conversion issue. The global reduced-motion rule serializes `0.01ms` as `0.00001s`; the browser assertion now converts seconds to milliseconds before applying its `<= 0.011ms` tolerance. The requirement remains near-zero motion rather than being relaxed.

## Delivered

- Replaced the placeholder root route with the `(marketing)` route-group home page, so `/` has exactly one route owner and no App Router conflict.
- Added indexable, canonical public pages for `/`, `/features`, `/for/teams`, `/for/clubs`, `/for/associations`, `/pricing`, `/demo`, `/privacy`, and `/terms`.
- Added a server-rendered, zero-client-component editorial shell with skip navigation, semantic landmarks, visible focus treatment, responsive wrapping navigation, 44px minimum interactive targets, and public CTAs.
- Added CSS/semantic product proof rather than stock imagery: synthetic, non-identifying workflow states, an evaluator view, and an accessible ranking table. No marketing image or video dependency was introduced.
- Centralized the frozen plan facts in `PLAN_CATALOG`; authenticated billing retains its compatible `launchPlans` export, and the public pricing table reads the same authority. Published prices are CAD 49, 129, and 249 per month.
- Added concrete prelaunch privacy and terms drafts. They explicitly identify legal-review status, minor-athlete/privacy decisions, retention and correction work, processor/residency uncertainty, payment terms requiring approval, and unresolved support/privacy contacts. They do not imply live providers, automatic selection, or legally operative commercial terms.

## Verification

```text
npx vitest run --config vitest.config.ts tests/unit/marketing --reporter=dot
  PASS — 1 file, 18 tests

npm run typecheck
  PASS

npm run verify
  PASS — Prettier, ESLint, strict TypeScript, the full unit suite, and a production Next.js build

npx playwright test tests/e2e/marketing.spec.ts --project=chromium --project=webkit --project='Mobile Safari' --reporter=line
  PASS — 36 tests
```

The browser suite exercises every route at 375px in all three engines and checks status 200, canonical metadata, landmarks, no media elements, no horizontal overflow, no tenant/API/Supabase requests, no console errors, axe violations, keyboard navigation, 44px target sizes, factual pricing/legal content, and reduced motion.

## Audit notes

- Source audit found no `use client` directive, authenticated data fetch, Supabase client, image component, stock image, live Stripe/The Squad claim, or automatic-athlete-selection claim under the marketing route/component tree.
- `next-env.d.ts` was temporarily rewritten by the Playwright dev server to reference `.next/dev/types`. That transient generated side effect was restored to its tracked `.next/types` form; no framework declaration change is included.
- `git diff --check` passed. `npm audit --audit-level=high` reported 0 vulnerabilities; the focused source secret scan found none. Every marketing page has an empty React loadable manifest (`{}`), confirming no marketing-specific client bundle was introduced.

## Concerns

- Privacy and terms are intentionally non-operative drafts pending legal approval. They must not be treated as a launch-ready notice or agreement.

## Fix round 1 — public proxy boundary and canonical origin

### Root cause and RED evidence

- `src/proxy.ts` created a Supabase server client and called `auth.getUser()` before it classified a request, so all public marketing requests could trigger session/auth work.
- Marketing metadata silently substituted `https://tryoutflow.example` when `NEXT_PUBLIC_APP_URL` was missing or malformed. The original metadata tests asserted only a pathname, so they could not detect the wrong host or scheme.
- New proxy tests failed on every marketing route, including query-string and trailing-slash forms: `createServerClient` was called and the unset mocked `getUser()` caused the old proxy to fail. A public-session-cookie test also showed a marketing request could receive a refreshed auth cookie.
- New public-origin tests failed because a URL with credentials was accepted, and the pre-fix production build without `NEXT_PUBLIC_APP_URL` failed only with an opaque Zod type error.

### Delivered

- Added an exact public-marketing allowlist at the first proxy branch. Only the nine intended routes (with one framework-style trailing slash normalized) bypass client creation and `getUser`; `/app`, authentication, registration, API, arbitrary dotted routes, near-miss names, and descendant paths still take the auth boundary.
- Added proxy unit coverage for all nine routes, query/trailing-slash behavior, no auth-client construction/user fetch/network/redirect/cookie refresh on public pages, protected route auth calls, and preserved protected session refresh cookies. Existing authentication tests remain green.
- Replaced the placeholder canonical fallback with `getPublicAppOrigin()`. The centralized validator now rejects missing, malformed, credential-bearing, path/query/fragment-bearing, insecure, and production-local origins with explicit messages.
- Test setup, Playwright dev-server configuration, and `npm run verify` now provide explicit non-secret test origins. A direct production `npm run build` requires an explicitly configured origin.
- Canonical assertions now compare full exact absolute URLs for every route. A built `next start` probe returned status 200 and the expected `https://marketing.tryoutflow.test` canonical for all nine marketing pages.

### Verification

```text
npx vitest run --config vitest.config.ts tests/unit/proxy.test.ts tests/unit/marketing/marketing-pages.test.tsx tests/unit/lib/public-app-origin.test.ts
  RED: 14 public-proxy failures, then 1 credentials-validator failure
  GREEN: 3 files / 55 tests

npx vitest run --config vitest.config.ts tests/unit/proxy.test.ts tests/unit/identity/authentication.test.ts tests/unit/marketing tests/unit/lib/public-app-origin.test.ts
  PASS — 4 files / 78 tests

env -u NEXT_PUBLIC_APP_URL npm run build
  EXPECTED FAIL — "NEXT_PUBLIC_APP_URL is required for the public app origin"

NEXT_PUBLIC_APP_URL=http://tryoutflow.test npm run build
  EXPECTED FAIL — "Production public app origin must be a secure non-localhost HTTPS origin"

NEXT_PUBLIC_APP_URL=https://marketing.tryoutflow.test npm run build
  PASS

npx playwright test tests/e2e/marketing.spec.ts --project=chromium --project=webkit --project='Mobile Safari'
  PASS — 36 tests

npm run verify
  PASS — formatting, ESLint, strict TypeScript, full unit suite, and production build using the explicit test origin
```

The production `next start` probe checked all nine status-200 responses and their exact absolute canonical tags. Its generated matcher skips `_next/static`, `_next/image`, `favicon.ico`, and the explicit image extensions while continuing to match `/pricing.json`, `/for/teams.extra`, and `/api/health`; public-route bypass therefore does not broaden static or protected-path exemptions. `npm audit --audit-level=high` again found 0 vulnerabilities, and `git diff --check` passed.
