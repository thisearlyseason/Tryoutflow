# Task 3 report: normalized organization-logo management

## Implementation

- Added `normalizeOrganizationLogo(file)` with the exact Sharp pipeline: warning-failing decode capped at 16,000,000 pixels, orientation normalization, 512×512 inside resize without enlargement, metadata-free WebP at quality 88/effort 4, a 350,000-byte encoded ceiling, and SHA-256/base64 output.
- Added independent MIME, magic-byte, empty-file, and 2 MiB raw-file guards. Errors expose only `invalid_file`, `too_large`, or `unavailable`; filenames, original bytes, and decoder details are never logged or redirected.
- Added `updateOrganizationLogo(input, actor, dependencies)` with action-time `organization:update` authorization, migration 099 `upsert_organization_logo`/`remove_organization_logo` adapters through the authenticated server client, exact outcome mapping, atomic replacement/removal, and fail-closed retention behavior.
- Added owner/admin settings UI for current preview/fallback, multipart upload/replace, separate removal, explicit accepted-format/2 MiB/square guidance, capability-gated controls, and whitelisted actionable success/error feedback.
- Preserved the existing organization settings form and added `FIELD_EXAMPLES.timezone`, `.sports`, and `.quickTags` placeholders.
- Per controller ruling and the Next 16 server-actions guide, configured `experimental.serverActions.bodySizeLimit: '3mb'` so 2 MiB files plus multipart overhead reach the authoritative 2 MiB application validator.

## Direct production dependency

- Ran `corepack npm install --save-exact sharp@0.35.4`; `package.json` and `package-lock.json` now declare direct production `sharp` `0.35.4` instead of relying on Next's optional transitive edge.
- `corepack npm ls sharp --depth=0`: exit 0, `tryoutflow@0.1.0` -> `sharp@0.35.4`.
- Install completed with 0 vulnerabilities; npm emitted existing TypeScript 7 versus typescript-eslint `<6.1` peer-range override warnings.

## TDD RED evidence

- `corepack npm exec -- vitest run --config vitest.config.ts tests/unit/organizations/normalize-organization-logo.test.ts tests/unit/organizations/organization-logo-settings.test.tsx`: exit 1; 2 files failed, 0 tests collected, with expected unresolved normalizer/action and component imports.
- After installing the direct dependency, `npm run test:integration -- tests/integration/organizations/organization-logo.test.ts`: exit 1; 1 file failed, 0 tests collected, with expected unresolved `update-organization-logo` import.
- `corepack npm exec -- vitest run --config vitest.config.ts tests/unit/organizations/organization-logo-settings.test.tsx` after adding the feedback cases: exit 1; 1 file failed, 4 failed/3 passed because no accessible alert existed.
- The first normalizer GREEN attempt had 1/21 failing because the hand-derived fixture expectation ignored EXIF orientation 6; `.rotate()` correctly produced 171×512, so the expectation was corrected to the intended visual orientation. The first live runs exposed test-harness-only issues (parsing final `COMMIT` instead of the materialized RPC result, then ordering by nonexistent `created_at` instead of `occurred_at`); both were traced against working repository patterns before changing only the test harness.

## GREEN and verification evidence

- Fresh focused command from the brief: 2 files passed, 25 tests passed.
- Fresh `npm run test:integration -- tests/integration/organizations/organization-logo.test.ts`: 1 file passed, 1 test passed against PostgreSQL, including exact owner/admin update audits, replacement, member live-RPC denial, retained content/digest/length after processing and authorization failures, removal, and exact removal audit evidence.
- `corepack npm run test:unit`: 102 files passed, 1,147 tests passed.
- `corepack npm exec -- tsc --noEmit`: exit 0 with no diagnostics.
- Focused ESLint: exit 0 with no diagnostics. Focused Prettier check: all matched files use Prettier style. `git diff --check`: exit 0.
- Initial `corepack npm run build` compiled and type-checked, then correctly stopped because `NEXT_PUBLIC_APP_URL` was unset. Rerun with documented safe build-time public placeholders (`NEXT_PUBLIC_APP_URL=https://tryoutflow.example`, a valid placeholder Supabase URL/key) completed the full Next 16 production build, including `/app/[organizationSlug]/organization/settings`.

## Files

- Created `src/modules/organizations/application/normalize-organization-logo.ts`.
- Created `src/modules/organizations/application/update-organization-logo.ts`.
- Created `src/modules/organizations/components/organization-logo-settings.tsx`.
- Created `tests/unit/organizations/normalize-organization-logo.test.ts`.
- Created `tests/unit/organizations/organization-logo-settings.test.tsx`.
- Created `tests/integration/organizations/organization-logo.test.ts`.
- Modified `src/app/(app)/app/[organizationSlug]/organization/settings/page.tsx`, `next.config.ts`, `package.json`, and `package-lock.json`.

## Integration and self-review

- Verified the default adapter consumes the generated migration 099 signatures exactly and sends only organization ID plus normalized base64/digest; metadata lookup remains byte-free.
- Verified authorization occurs before decoding for members, while the RPC independently rechecks live owner/admin membership so a stale application context cannot mutate content.
- Verified realistic mutations: removing MIME/magic/raw/encoded guards, skipping rotation/resize/WebP/hash, bypassing capability checks, accepting unexpected RPC outcomes, invoking the RPC after normalization failure, combining replace/remove forms, or dropping audit details each breaks at least one test.
- Verified the settings redirect/query boundary contains only whitelisted result codes, and all displayed errors avoid private tenant, filename, byte, and decoder details.
- Verified no unrelated worktree changes were present or included.

## Concerns

- The current-logo preview intentionally targets the Task 4 byte-delivery route; Task 4 owns that route and robust image-load fallback, so this staged Task 3 commit does not add route/display behavior outside its scope.
- The repository's existing TypeScript 7 dependency remains outside typescript-eslint's declared `<6.1` peer range; npm warned during install, but focused ESLint, full type checking, all unit tests, integration, and production build passed.
