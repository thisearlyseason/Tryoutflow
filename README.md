# TryoutFlow

TryoutFlow is a multi-tenant SaaS for structured sports tryouts: registration, check-in, independent evaluation, transparent scoring, roster decisions, communication, reports, billing foundations, and explicit provider exports.

## Architecture

The application is a modular Next.js 16 monolith with typed application/domain modules. Supabase PostgreSQL/Auth and RLS are authoritative; IndexedDB temporarily protects evaluator drafts. Stripe, Resend, analytics, and team-management systems sit behind narrow adapters. The Squad integration is a disabled-by-default mock, not a live transfer.

## Pinned local toolchain

- Node.js 24.12.0 (`.nvmrc`)
- npm 11.12.1 through Corepack (`packageManager`)
- Supabase CLI 2.116.0 from repository dependencies
- Docker for the local Supabase stack
- PostgreSQL client tools and the Playwright browser dependencies

Use the pinned npm command; do not substitute a globally installed npm or Supabase CLI.

## Local setup

```sh
corepack enable
corepack npm@11.12.1 ci
cp .env.example .env.local
corepack npm@11.12.1 exec -- supabase start
corepack npm@11.12.1 run supabase:reset
corepack npm@11.12.1 run dev
```

Fill `.env.local` only with local or synthetic credentials. Never connect local, test, or preview work to production providers. See `docs/operations/environment.md` for every variable and ownership boundary.

## Release-candidate verification

Start the repository's local Supabase stack, ensure the pinned Playwright engines are installed, then run one command from a clean checkout:

```sh
bash scripts/verify-production-readiness.sh
```

The gate installs locked dependencies; checks formatting, lint, and types; replays migrations; runs full pgTAP, unit, supervised integration, provider contract, production artifact, and strict five-project browser tests; verifies generated-type reproducibility, dependency audit, tracked-secret/diff boundaries, and exact cleanup. It is local-only, leaves the local database unseeded after success or failure, does not deploy, and does not call live providers.

A green automated gate is not production approval. Legal/privacy review, production domains/TLS, hosted backup/restore evidence, Stripe/Resend/The Squad live credentials and certification, monitoring ownership, and deployed authenticated smoke tests remain unchecked in `docs/operations/release-checklist.md` until external evidence exists.
