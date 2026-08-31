# Deployment and recovery

## Pre-deployment evidence

Use a clean checkout and the same Node version as `.nvmrc`:

```sh
npm ci
npx supabase start
npx supabase db reset --local --no-seed
npm run test:db
npm run supabase:reset
npm run test:integration
npm run test:integration
npm run verify
npm run build
npm run test:e2e
git diff --check
git status --short
```

The full pgTAP suite owns empty global fixtures, so its reset is deliberately unseeded. Restore the
deterministic demo seed before supervised integration; those contracts verify the seeded demo and
clean up their own task fixtures.

Two supervised integration runs are intentional: they exercise cleanup and lock ownership as well as test behavior. Any failure, unexpected console/network event, skipped security test, generated-type drift, or test residue blocks release.

## Migration order

1. Confirm the target Supabase project and environment in the shell. Never infer production from a default link.
2. Take/confirm the provider backup or point-in-time recovery checkpoint.
3. Review pending version-controlled migrations and generated `database.types.ts` together.
4. Apply migrations before the compatible application release with the Supabase CLI/project workflow approved for that environment.
5. Deploy the application, then check `/api/health` publicly and `/platform/health` as a current platform administrator.
6. Exercise sign-in, an organization audit page, one non-mutating platform list, and the job endpoint scheduler. Verify logs contain only allow-listed identifiers.

Migrations are append-only. Never edit or delete a migration already applied to a shared environment.

## Rollback

There are no hand-written down migrations. Choose the recovery path based on whether incompatible data has been written:

- Before application traffic: redeploy the prior application. If the additive migration itself is harmful, restore the pre-migration database checkpoint or ship a reviewed forward-fix migration.
- After writes: stop the affected writer/cron, preserve evidence, and prefer a forward-fix migration. Restore only with incident-command approval because a restore discards later durable writes.
- Never “roll back” by dropping audit, subscription-event, communication-delivery, roster-history, or support-elevation evidence.

After recovery, rerun the health checks and a focused verification suite, reconcile provider side effects, and document the decision in the incident timeline.

## Job recovery

`POST /api/jobs/process` requires `Authorization: Bearer <JOB_PROCESSOR_CRON_SECRET>`, same-origin if an `Origin` header is present, JSON content type, and `{ "batchSize": 1..50 }`. Each run uses 90-second leases and processes communication and integration queues; it also runs bounded purges for expired communication previews, integration previews, and checkout intents.

When health shows backlog or failures:

1. Pause repeated scheduler invocations if a provider outage or credential problem is still active.
2. Inspect aggregate health first, then inspect only the affected durable job IDs/status/error codes. Do not copy payloads, guardian contacts, roster snapshots, notes, scores, provider secrets, or tokens into logs/tickets.
3. Confirm the source authorization and provider state before retry. Expired leases are reclaimed by the guarded claim functions.
4. Retry communication by allowing a `pending` job's scheduled `available_at` claim. `dead_letter` and `needs_attention` require diagnosis; do not update queue tables by hand.
5. Retry integration items through the existing authenticated retry UI/RPC. `delivery_uncertain` disables automatic retry to prevent duplicate external writes; reconcile with the provider manually first.
6. Trigger one bounded processor run, record its aggregate response, and verify queue/health counts fall. Increase batch size gradually; never create concurrent ad-hoc loops.
7. Resume the scheduler only after two clean bounded runs and provider reconciliation.

## Post-deployment

Confirm public health exposes only `ok` or `degraded`; unauthenticated/non-platform callers must not receive detailed counts. Confirm platform organization/subscription/audit pages contain metadata only. Keep the previous application artifact and database recovery checkpoint until the observation window closes.
