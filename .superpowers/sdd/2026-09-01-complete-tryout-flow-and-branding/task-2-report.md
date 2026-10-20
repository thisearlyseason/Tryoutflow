# Task 2 report: private organization-logo database boundary

## Implementation

- Added additive migration `202609010099_organization_brand_assets.sql` with one private, organization-primary-keyed WebP row containing exact bytes, MIME type, byte length, SHA-256, updater identity, and timestamps.
- Enforced `image/webp`, 12–350,000 decoded bytes, RIFF/WEBP magic, exact byte-length agreement, 64 lowercase hexadecimal SHA-256 shape, and digest-to-content agreement in database constraints.
- Added always-enabled organization-identity and truncate guards so direct owner and `session_replication_role=replica` operations cannot move or truncate brand assets.
- Added owner/administrator-only `upsert_organization_logo` and `remove_organization_logo` security-definer RPCs. Each snapshots `auth.uid()` once, uses `is_active_organization_member`, locks the organization and live actor membership before mutation, writes atomically, and appends exact `organization.logo_updated` or `organization.logo_removed` audit evidence.
- Added the public-schema, service-role-only `read_organization_logo_service` boundary and the authenticated, byte-free `get_organization_logo_metadata` boundary. All four RPCs have fixed empty search paths and exact role grants; the table and private trigger functions have no named API-role privileges.
- Updated the final exact ACL allowlists for the three authenticated RPCs and one service-role RPC.
- Regenerated Supabase types and extended the deterministic postprocessor so the metadata RPC truthfully types its missing-logo `sha256` and `updated_at` fields as nullable.

## Controller ruling

The controller confirmed these exact downstream contracts before implementation:

- `read_organization_logo_service(text) returns table(content bytea, content_type text, byte_length integer, sha256 text, updated_at timestamptz)`; missing assets return zero rows.
- `get_organization_logo_metadata(uuid) returns table(logo_exists boolean, sha256 text, updated_at timestamptz)`; an authorized missing asset returns exactly `{logo_exists:false, sha256:null, updated_at:null}`. `updated_at` is the display/cache version and no separate version field is added.

## Files

- Created `supabase/migrations/202609010099_organization_brand_assets.sql`.
- Created `supabase/tests/079_organization_brand_assets.test.sql`.
- Modified `supabase/tests/073_final_acl_closure.test.sql` with the controller-approved exact allowlist additions.
- Modified `scripts/postprocess-database-types.mjs`.
- Modified `tests/unit/infrastructure/database-types-postprocessor.test.ts`.
- Regenerated `src/infrastructure/supabase/database.types.ts`.

## Commands and results

- `npm run supabase:reset && npm run test:db -- supabase/tests/079_organization_brand_assets.test.sql` (RED): reset passed; pgTAP exited 1 with 31/32 structural/ACL assertions failing because the table and RPCs were absent, then stopped at the expected missing `upsert_organization_logo` function.
- Same focused reset/test command after migration 099 (GREEN): passed; 1 file, 78 tests, `Result: PASS`.
- `npm run test:db`: correctly exposed the new RPCs missing from test 073's exact allowlists and also surfaced legacy seeded-fixture assumptions in 003/007/011.
- `npm run test:db -- supabase/tests/073_final_acl_closure.test.sql`: passed; 1 file, 26 tests.
- `corepack npm exec -- supabase db reset --no-seed`: passed and applied migrations through 099.
- `corepack npm run test:db`: passed from the clean unseeded database; 79 files, 2,155 tests, `Result: PASS`.
- `corepack npm run test:db -- supabase/tests/073_final_acl_closure.test.sql supabase/tests/079_organization_brand_assets.test.sql`: final focused verification passed; 2 files, 104 tests.
- `corepack npm exec -- vitest run --config vitest.config.ts tests/unit/infrastructure/database-types-postprocessor.test.ts` (RED): 2/5 failed because metadata nullability was not postprocessed and a missing metadata RPC did not fail closed.
- Same postprocessor test after implementation and regeneration (GREEN): 1 file, 5 tests passed.
- `corepack npm exec -- tsc --noEmit`: passed with no diagnostics.
- `corepack npm exec -- prettier --check scripts/postprocess-database-types.mjs src/infrastructure/supabase/database.types.ts tests/unit/infrastructure/database-types-postprocessor.test.ts`: passed.
- `git diff --check`: passed.

## Generated-type hashes

- First final generation: `dc1fae3a12c7e6e5bdaa3d608774763f1843eebd0a209d8779019ec28b5c0a4c`.
- Second final generation: `dc1fae3a12c7e6e5bdaa3d608774763f1843eebd0a209d8779019ec28b5c0a4c`.

The byte-identical hashes include the truthful nullable metadata result fields.

## TDD evidence

The complete pgTAP contract was written before migration 099 and observed failing on the missing database boundary. The same 78 assertions passed after the minimal migration. Self-review then identified a generated TypeScript nullability mismatch; a postprocessor test was written and observed failing before the postprocessor was changed, then passed after regeneration. The exact ACL allowlist test also failed on the newly granted functions before its approved expected catalog was updated.

## Self-review

- Verified every brief requirement against migration/test evidence: exact columns and ownership, WebP header/content/size/digest integrity, immutable organization identity, owner/admin success, member/offboarded/cross-tenant denial, atomic append-only audit truth, zero direct table privileges, fixed empty search paths, exact RPC ACLs, and normal/replica truncation denial.
- Verified mutation resistance: wrong MIME, byte length, magic, digest shape, digest identity, oversized content, duplicate organization row, direct DML, cross-tenant calls, and unsafe role execution each fail at least one real behavior assertion.
- Verified the service reader is the only role-granted byte path, while authenticated metadata returns no byte field and returns exactly one authorized missing-logo row.
- Verified denied and invalid attempts do not append audit evidence; only successful writes/removal do.
- Verified no shipped migration was edited and migration 099 is additive.
- Verified generated signatures exactly match the controller ruling and the postprocessor remains byte-idempotent and fail-closed.

## Concerns

- A normal seeded reset makes legacy tests 003, 007, and 011 fail because `supabase/seed.sql` already owns the slug/global rows those tests assume are absent. Each failure reproduced independently and is unrelated to migration 099. Per controller direction, those legacy tests were not changed; the canonical full acceptance run used a clean unseeded reset and passed all 2,155 assertions.
