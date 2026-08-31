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
