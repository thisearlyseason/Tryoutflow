# Task 4 report: safe organization-logo delivery and display

## Commit

- Implementation commit: `22f85fa6427c10ac8d9a9f778d4b870cf2cf10cb`
- Exact base: `1517f24749932d396013d78f06a4526bc84345db`
- Implementation range: `1517f24749932d396013d78f06a4526bc84345db..22f85fa6427c10ac8d9a9f778d4b870cf2cf10cb`

## Interface ruling

The existing `public_registration_tryout_v2(text)` returned no organization identity or logo presence. The authenticated `get_organization_logo_metadata(uuid)` RPC correctly rejects public callers, while `read_organization_logo_service(text)` returns bytes and must remain exclusive to the logo route. With controller approval, Task 4 therefore adds migration `202609010100_public_registration_branding.sql`, which exposes only `organization_name`, `organization_slug`, and `logo_exists` through the already service-role-only published-registration projection. No logo-table grant or second byte reader was added.

## Implementation

- Added `GET /api/organizations/[organizationSlug]/logo`. It validates the slug, calls only `read_organization_logo_service`, requires zero or one result, validates the PostgREST bytea representation, length, WebP header, and SHA-256, and returns the exact normalized bytes.
- Successful responses use `image/webp`, exact `Content-Length`, a strong quoted digest ETag, `Cache-Control: public, max-age=0, must-revalidate`, and `X-Content-Type-Options: nosniff`. A weakly matching `If-None-Match` validator, valid validator list, or wildcard returns a bodyless 304. No response has `Content-Disposition`.
- Missing assets return generic 404; invalid cardinality, malformed service data, RPC failures, and exceptions return generic 503. Error responses are `no-store` and expose no tenant identity, bytes, digest, or database/provider message.
- Added client-owned `OrganizationMark({ name, logoUrl, size })`. A missing URL or one image-load failure switches locally to the accessible `TF` fallback; the failed URL is not retried. Replacing the URL naturally resets the failure boundary.
- Extended authenticated organization view models with only optional `logoUrl`. The byte-free metadata RPC provides existence, digest validation, and `updated_at` cache version. Malformed, duplicate, denied, or temporarily unavailable metadata fails closed to the fallback.
- Rendered organization marks in desktop navigation, mobile navigation, and the existing organization-logo settings preview. Product-level TryoutFlow identity remains separate.
- Extended public registration configuration with the published tryout organization's safe name and conditional same-origin logo URL. The client renders organization identity before the tryout name and uses `OrganizationMark` for missing/unavailable artwork.
- Regenerated Supabase types twice; both outputs had SHA-256 `7e2ed5fbaa222ccee678e90eb5f48e0bda85ee28d61d833368d7f784c2808572`.

## TDD evidence

### RED

- `corepack npm exec -- vitest run --config vitest.config.ts tests/unit/organizations/organization-logo-route.test.ts tests/unit/organizations/app-navigation.test.tsx tests/unit/registration/public-registration-loader.test.ts tests/unit/registration/public-registration-branding.test.tsx tests/unit/organizations/organization-logo-settings.test.tsx`
  - Exit 1: 5 files failed, 8 tests failed and 17 passed.
  - The route import was absent; staff marks, public organization response fields, public branding, and failed-image fallback assertions all failed for their intended missing behavior.
- `corepack npm run test:db -- supabase/tests/080_public_registration_branding.test.sql`
  - Exit 1 after correcting one test-harness-only PUBLIC-role assertion: 1/11 failed because the function returned the old six-column table rather than the approved nine-column safe branding projection.
- `corepack npm exec -- vitest run --config vitest.config.ts tests/unit/organizations/current-organization-branding.test.ts`
  - Exit 1: malformed `updated_at` was incorrectly accepted as a public cache version. The minimal follow-up added strict timestamp validation and exception fallback.

### GREEN

- Final focused unit command: 6 files passed, 35 tests passed.
- Focused pgTAP command for tests 031, 073, 079, and 080: 4 files passed, 124 assertions passed.
- Real PostgreSQL route/public integration command: 2 files passed, 21 tests passed. It covers byte delivery, ETag/304, removal/404, exact published organization branding, and absent/present logo URL behavior.
- The first logo-route integration attempt returned generic 503. Systematic tracing proved production bytea decoding was correct and identified missing existing Supabase environment values in that test file; aligning its harness with the repository's working public-route pattern made the unchanged production route pass.

## Verification

- `corepack npm run test:unit`: 105 files passed, 1,164 tests passed.
- `corepack npm exec -- supabase db reset --no-seed && corepack npm run test:db`: migration 100 applied cleanly; 80 files passed, 2,166 assertions passed.
- `corepack npm run format:check`: passed.
- `corepack npm run lint`: passed.
- `corepack npm run typecheck -- --incremental false`: passed. The flag avoided an ignored stale incremental cache left before the new route was type-generated.
- Production build with documented synthetic public Supabase/app placeholders: passed; Next 16 listed `/api/organizations/[organizationSlug]/logo` as a dynamic route.
- `git diff --check`: passed before commit.

## Files

Created:

- `src/app/api/organizations/[organizationSlug]/logo/route.ts`
- `src/modules/organizations/components/organization-mark.tsx`
- `supabase/migrations/202609010100_public_registration_branding.sql`
- `supabase/tests/080_public_registration_branding.test.sql`
- `tests/unit/organizations/current-organization-branding.test.ts`
- `tests/unit/organizations/organization-logo-route.test.ts`
- `tests/unit/registration/public-registration-branding.test.tsx`

Modified:

- `src/modules/organizations/application/current-organization.ts`
- `src/modules/organizations/application/organization-route-context.ts`
- `src/components/layout/app-shell.tsx`
- `src/components/layout/app-navigation.tsx`
- `src/components/layout/mobile-nav.tsx`
- `src/app/globals.css`
- `src/app/api/public/registrations/route.ts`
- `src/app/(registration)/register/[tryoutSlug]/registration-form.tsx`
- `src/modules/organizations/components/organization-logo-settings.tsx`
- `src/infrastructure/supabase/database.types.ts`
- `tests/unit/organizations/app-navigation.test.tsx`
- `tests/unit/organizations/organization-logo-settings.test.tsx`
- `tests/unit/registration/public-registration-loader.test.ts`
- `tests/integration/organizations/organization-logo.test.ts`
- `tests/integration/registration/public-registration-routes.test.ts`

## Security and mutation review

- Removing slug validation, service-RPC exclusivity, cardinality validation, WebP/length/digest validation, generic response mapping, ETag comparison, or cache/nosniff headers breaks focused route coverage.
- Returning the public logo URL unconditionally, sourcing branding from another organization, adding raw logo fields, or broadening public RPC ACLs breaks unit, integration, generated-type, or pgTAP coverage.
- Removing the mark's image-error state, staff/mobile wiring, settings reuse, or public heading order breaks component coverage.
- Direct private logo-table privileges remain empty for anon, authenticated, and service roles; bytes remain available only through `read_organization_logo_service` inside the delivery route.

## Concerns

- The integration suite creates short-lived abuse, bot-receipt, and legacy registration-rate rows that its existing supervisor does not remove. Because the database had just been reset unseeded and all organization/user roots were zero, the exact task-owned rows were deleted from only those three tables after final integration verification; database residue is zero.
- The repository residue checker still reports port 3112 because PID 54263 is an unrelated Next server rooted at `/Users/tylerans/Documents/ChatGPT/TryoutFlow`, started at 17:35 before this task. It was deliberately preserved. No Task 4 process remains.
- No subagent or reviewer was spawned because the controller explicitly prohibited delegation/reviewers; the implementation received a local line-by-line and mutation-oriented self-review.

## Review fix round 1

The independent review found that the route decoded and hashed bytea text before comparing its real length, so an upstream response could force an allocation and digest pass beyond the normalized 350,000-byte boundary. It also found that conditional GET handled only exact whole-header equality rather than `If-None-Match` list, wildcard, and weak-comparison semantics.

### RED

- Added oversized and declared-length-mismatch regressions that instrument `Buffer.from` and `createHash` at the route boundary.
- Added wildcard, weak validator, validator-list, comma-inside-opaque-tag, malformed-list, and nonmatching conditional request cases.
- `corepack npm exec -- vitest run --config vitest.config.ts tests/unit/organizations/organization-logo-route.test.ts`
  - Exit 1: 6 failed and 14 passed.
  - Four valid conditional requests returned 200 instead of 304; both invalid payload shapes invoked decoding before returning the generic 503.

### GREEN

- Bounded `content` to the exact maximum PostgREST bytea text size of 700,002 characters and required `content.length === 2 + 2 * byte_length` before `Buffer.from` or SHA-256.
- Added a strict quote-aware validator parser. It accepts exact `*`, valid comma-separated entity-tag lists, and weak validators using weak comparison; malformed or nonmatching fields continue to receive the 200 representation. The emitted ETag remains strong.
- Focused route unit command: 1 file passed, 20 tests passed.
- Real Supabase organization-logo integration command: 1 file passed, 1 test passed.
- `corepack npm run test:unit`: 105 files passed, 1,175 tests passed.
- `corepack npm run format:check`, `corepack npm run lint`, and `corepack npm run typecheck -- --incremental false`: passed.
- Production `corepack npm run build` with synthetic public app/Supabase placeholders: passed; Next 16 retained the dynamic organization-logo route.
- `git diff --check`: passed before the fix commit.
