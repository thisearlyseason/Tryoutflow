# TryoutFlow security review — 2026-09-21

Scope: the two supplied screenshots, mapped to this Next.js/Supabase web application and Expo client. The screenshots are a checklist, not a compliance standard. Wordfence is not applicable to this stack. SEO, Search Console, Business Profile, and Bing setup are outside this security review.

## Deployed follow-up — 2026-09-21

The security changes were released to https://www.tryout.agency in deployment `dpl_6JbLJ16VmZVWFAGXae1b1sCZEX4N`. Migration `202609210160` is committed in production; a post-commit query confirmed zero public/private application tables without RLS. The original findings below are the pre-release audit record.

- All 1,460 unit tests pass. The clean database replay plus full suite and corrected concurrency retest pass 2,857 assertions across 100 files. Exact staged source passed 314 focused security tests, TypeScript, and a Vercel production build.
- Updated stale ACL test allowlists for the explicit talent/billing/workspace grants from migrations 119-158; changed a fixture to revoke an immutable license and create a distinct expired subscription. No production permissions were broadened. Updated the brand assertion to check the image accessible name.
- Live homepage, demo, pricing, sign-in, sign-up, registration and health return 200 with security headers. Anonymous application/platform requests redirect to sign-in. Turnstile completes on desktop and at 390px. Registration is correctly closed for the only published event, so live waiver submission was not exercised.
- Production is on the Supabase Free plan with **no managed backups**. A metadata checkpoint for the four RLS flags/owners/grants was saved before this data-preserving migration; this is not a full database backup or restore test. Storage contained zero objects at inspection. A scheduled backup and tested restore remain an operational gap.
- The Vercel API reports no custom WAF configuration. Vercel provides automatic platform DDoS mitigation for all deployments; this is distinct from custom WAF rules. Existing application bot/rate-limit checks remain in place. See https://vercel.com/docs/vercel-firewall/ddos-mitigation.
- The existing checkout and unrelated local databases were preserved. The broad release wrapper was not run because it resets the existing local database; an isolated database replay and focused staged checks supplied the evidence above. Full end-to-end browser and provider purchase suites were not rerun.

Release details: `output/security-release-20260921/RELEASE.md`.

## Results and changes

| Concern                 | Evidence and outcome                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vulnerable dependencies | Fresh npm registry audits of the web and native lockfiles each returned zero known vulnerabilities, including development dependencies. CI now audits both trees and fails at moderate severity or higher. This does not prove an absence of undisclosed vulnerabilities.                                                                                                                                                    |
| Unsafe input            | Reviewed public registration origin/content-type checks, streamed 32 KiB limits, Zod validation, HMAC rate buckets, bot protections, and bounded operational endpoints. Fixed oversized registration streams to cancel further input. Existing and new request-security tests pass. No dangerouslySetInnerHTML usage found in src.                                                                                           |
| Missing permissions     | Reviewed live membership authorization, platform authorization, server-only admin client, and authenticated operational boundaries. Existing authorization, webhook, abuse-protection, and privacy unit suites were exercised. Database checks are qualified below.                                                                                                                                                          |
| Database protection     | All 91 public tables in the inspected local snapshot already enabled RLS. Four private tables lacked it: athlete_portraits, performance_exports, pro_trials, talent_record_revisions. Direct API access was already revoked. Added migration 202609210160 to enable default-deny RLS without changing owner-executed RPC behavior. Applied ONLY to an isolated local snapshot; the new three-assertion database test passes. |
| Exposed keys            | Signature scan of tracked and nonignored untracked text files up to 3 MB found no matching private-key, Stripe live-key, Supabase secret-key, or AWS access-key signatures. Admin Supabase access imports server-only; browser access uses the publishable key; native sessions use SecureStore. This scan is not a complete git-history, deployed-bundle, log, or provider-secret audit.                                    |
| Browser protections     | Public production homepage returned HTTP 200 with HSTS but without the new application security headers. Added nosniff, anti-framing, referrer and permissions policies, baseline CSP, production HSTS, and disabled X-Powered-By. Local homepage returned 200 with the new headers. The CSP blocks object embeds, hostile base URLs, and framing; it is NOT a strict script policy or a complete XSS defense.               |
| Backups/firewall        | Existing release runbook requires a pre-migration recovery checkpoint. Actual backup retention, restore success, WAF configuration, alerting, and provider access controls were not verified in this session.                                                                                                                                                                                                                |

## Verification

- Web dependency audit: 0 vulnerabilities. Native dependency audit: 0 vulnerabilities.
- Broad selected unit run: 312 passed, 1 failed across 41 files. Failure: authentication-ui branding assertion expects text inside the home link; unrelated to these security edits.
- Focused security regression run: 15/15 passed, including stream cancellation and production/development header behavior.
- TypeScript check and ESLint on changed TypeScript files: passed.
- Local HTTP homepage: 200 with new headers; production homepage inspected read-only.
- New database RLS contract: 3/3 passed on isolated snapshot. Cross-platform billing and existing-trial compatibility suites also completed without failed assertions after the RLS migration.
- Existing database suite is NOT fully green. Snapshot migration tracking ends at 152 although later objects exist. Older ACL allowlists disagree with newer objects; tenant/rubric fixtures hit entitlement_required; workspace fixture hits purchase_ownership_immutable; talent fixture hits RLS on athlete_sport_profiles. These need reconciliation against a clean database built from all current migrations before release. Do not weaken authorization or broaden grants to make these tests pass.
- Existing local databases were not reset or migrated. Only the separately named audit database received the new migration. No production deployment, migration, data write, key rotation, or account-setting change was performed.

## Remaining release evidence

1. Run the repository production-readiness gate against a clean local environment with all migrations, resolve the existing fixture/ACL failures, and repeat role/tenant isolation tests. Preserve current working changes and local data.
2. Confirm the actual production project migration state, RLS and grants, security-definer search paths, private storage access, Auth redirects/email verification, and server-only environment values. Public Supabase publishable/anon keys are expected; service-role and provider secret keys must never be exposed to browsers or native bundles.
3. Verify Vercel firewall/rate-limit rules and monitoring in the account. Exercise bot denial on auth/registration and ensure legitimate webhook traffic retains signature verification.
4. Confirm backup schedule, retention, encryption/access controls, and recovery objectives. Restore into an isolated target and verify data plus application authorization. Back up Storage objects separately: Supabase database backups include their metadata, not their file contents. Never test restore against production.
5. Apply the new migration through the normal backed-up release workflow and deploy the application changes. Recheck production headers and signed-in, registration, Turnstile, billing, and export workflows. Local fixes are not production protection until released.

References: [Next.js headers](https://nextjs.org/docs/app/api-reference/config/next-config-js/headers), [Supabase backup coverage](https://supabase.com/docs/guides/platform/backups). Installed Next.js data-security and headers guides were read before implementation.
