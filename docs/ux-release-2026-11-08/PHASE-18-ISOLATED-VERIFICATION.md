# Phase 18: isolated release verification

Prepared November 8, 2026, in the existing release candidate worktree. The production-based application baseline is `de40fff2d9baa46ecd7e6c0f2618d18863de2c3b`. This phase fixes a continuation-link prefetch defect and updates four setup navigation test locators. No dependency, migration, runtime pin, environment key, access setting, billing setting, or production alias changes are included.

## Changes and evidence

`SavedSetupNavigation` now disables automatic Link prefetch while retaining programmatic navigation and its manual fallback. The old behavior started duplicate setup prefetches while navigating. An explicit browser assertion against automatic prefetch was witnessed RED with the old Link behavior, then GREEN in Chromium, Firefox, WebKit, Mobile Chrome, and Mobile Safari with the fix.

The wizard tests now use the accessible “Tryout details” link within “Tryout setup progress” instead of the retired “Basics” navigation label. Existing heading, input-value, accessibility, and error assertions remain. Normal Chromium navigation streams may be cancelled after returning HTTP 200 and rendering the form. The wizard test permits at most one such GET cancellation for each of its two setup destinations, restricted to the scenario organization, RSC header, absent prefetch headers, and exact cancellation error. It separately checks HTTP 200, the rendered form, and zero automatic prefetches. The shared network monitor is unchanged.

One focused independent review found no Critical, Important, or Minor issue. Its limits remain: failed-request bounds do not establish the total number of successful navigation requests, and HTTP 200 plus a visible form does not identify which stream supplied the render. Other organizations, origins, and prefetched traffic are not admitted by the allowances.

## Passing checks

- Database: 2,932 assertions across 103 SQL files.
- Generated database types: two passes match committed bytes exactly.
- Integration: 229 tests across 35 files, passed twice.
- Provider contracts: 147 tests across four files.
- Final unit suite: 2,261 tests across 218 files.
- Targeted wizard browser scenario: five of five browser profiles pass with zero retries.
- Prepared Linux runtime: four unchanged auth-screen visual cases pass.
- Lint and typecheck pass. Toolchain security/parity checks pass 326 tests and 17 parity cases.

Database checks ran against a newly created, loopback-only disposable Supabase project, verified through the repository’s existing container, workdir, config-hash, network, endpoint, and PostgreSQL identity guards. The original staff QA database was never reset. Staff identity/grant fingerprints and its owner fixture snapshot remain unchanged.

## Remaining release gates

The canonical readiness command stops before database mutation because it pins Node 24.12.0 while this host runs 24.22.1. These separate stage results do not constitute a canonical pass. No pin was downgraded or guard weakened.

The full 200-case browser diagnostic was stopped after identifying the stale locator: five passed, one failed, one was interrupted, and 193 did not run. The corrected wizard scenario was then verified separately across all five profiles. The other three workflows with equivalent locator updates have not been fully rerun.

The standard Linux browser image lacked DejaVu fonts present in the prepared project image, producing false differences even on unchanged auth screens. The controlled prepared-font run passes those four auth cases. Owner-home desktop/mobile screenshots still differ from the old baseline because of the task-led redesign. Baselines remain unchanged; the complete visual suite still requires reviewed alignment and repeatability checks. An earlier diagnostic also hit local sign-in rate limits after failure-worker restarts; it is not counted as visual certification.

Authenticated preview runtime, native/iOS/store coverage, and manual release prerequisites remain separate. No production promotion is warranted by this phase alone.

## Review boundaries and decisions

- Retain Phase 17’s prior integration review; this focused review does not re-certify that entire implementation. Risk: broader defects remain governed by their existing evidence and pending full gate.
- Keep unchanged database/API guards and cleanup scripts; verify their actual execution on the owned disposable project. Risk: no inference about unrelated project state or production database behavior.
- Preserve the runtime pin and report the mismatch. Risk: canonical CI remains blocked until runtime alignment is handled explicitly.
- Keep full visual and browser certification open. Risk: unexecuted cases remain unverified.
- Verify preview deployment and production alias separately from code review. Risk: a successful hosted build alone does not establish authenticated runtime behavior.

## Evidence and storage

`phase18-verification.json` binds the five changed source/test files and concise check logs by SHA-256. The detailed evidence and latest useful screenshots live under ignored `work/ux-release-gates-2026-11-08/`. The deployment receipt is saved there after the updated preview is ready. Disposable database state, owned browser runtime, build output, and redundant video/trace artifacts are removed after verification; source, original fixtures, dependency tree, and concise evidence are preserved.

Cleanup verification passed: zero disposable release residue, application port 3112 closed, and all owned test containers, volumes, networks, and browser runtime removed. The original Supabase configuration/temp files were restored. All 81 pre-existing container IDs and mounts, 1,530 original sealed source files, 175 protected production/configuration files, staff grants, and the owner fixture snapshot remain unchanged. The managed candidate and its dependencies are retained.
