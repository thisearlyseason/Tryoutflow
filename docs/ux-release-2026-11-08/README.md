# Phase 17: production-based UX candidate

Prepared 2026-11-08 on `codex/tryoutflow-ux-release-20261108`. This candidate ports the approved task-led UX and recovery work onto the verified live production source, `dd34fb60c973aa2ee86b70af1f7c38f7f65ed82c`, rather than deploying the older dirty UX checkout. The original 1,530 sealed source files remain unchanged. The deployment file metadata matched 1,811 owning files from the production commit.

## Resulting behavior

Staff navigation groups work by task, with permission-aware creation, settings, setup, and recovery guidance. Family views retain the modern production workspace. The production session revalidation, departure, expiry, offline retry, timezone validation, and event coverage checks remain intact. Recovery drafts are scoped to the verified user and purged on lock or account changes.

Independent review found a failed-save select reset that could display a different division, session, or rubric than the hidden target ID. Current-value rebinding now keeps the displayed target and submitted ID aligned after failed actions. Four regression cases cover this behavior, including recovered configuration. A fifth regression removes duplicate scoring navigation for combined roles.

## Verification

- Full unit suite: 218 files, 2,261 tests passed.
- Formatting, lint, typecheck, production build, and marketing production artifact gate passed.
- Dependency audit: zero vulnerabilities.
- Read-only local browser checks: 24 passed across owner, director, and two evaluator identities at desktop and mobile widths. No tested page errors, horizontal overflow, or attempted business writes.
- Local fixture snapshot unchanged; staff membership and assignment fingerprints unchanged. All three existing staff identities retain email identities and null passwords.
- All 174 protected production configuration, dependency, and migration files checked against the baseline remain unchanged.

The role checks used normal local Auth confirmation response cookies. The backend returned its existing test canonical redirect; that redirect flow was not certified. The marketing artifact gate uses its own synthetic mock backend and is separate evidence from real local staff-role checks. Browser checks did not submit business forms.

## Preview and production boundary

Prepare a preview using the existing Vercel project and preview environment. No provider keys, access settings, migrations, billing settings, or production aliases are changed. The receipt is recorded separately after deployment.

The canonical production readiness script has not been run. It requires a fresh verified isolated database, pinned runtime, database/integration/contract checks, Linux visual checks, and the full five-browser zero-retry suite. The host runtime is Node 24.22.1 while that script pins 24.12.0. Existing local fixtures were not reset and test-backend protections were not widened. Production promotion remains pending those checks. Native wrapper, iOS, billing, and store verification are outside this preview phase.

## Evidence and recovery

`release-source-manifest.json` binds the code changes to their SHA-256 digests and records the original Phase 16 packet digest. Detailed local logs, latest screenshots, review findings, merge decisions, preservation audit, and deployment receipt live in ignored `work/ux-release-2026-11-08/`. The source checkout and managed release worktree are preserved; no GitHub push, merge, or production promotion is part of this preparation.
