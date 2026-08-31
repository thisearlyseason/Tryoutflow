# Incident response

## Severity and ownership

- **SEV-1:** confirmed/suspected cross-tenant disclosure, credential compromise, destructive data loss, unauthorized support access, or unsafe duplicate external delivery.
- **SEV-2:** authentication/authorization outage, sustained database/job/provider failure, incorrect billing entitlement, or material workflow unavailability.
- **SEV-3:** limited degradation with a safe workaround and no confidentiality/integrity risk.

Assign one incident commander and one recorder. Open a timestamped timeline, name affected environments/components, and use privacy-safe identifiers only.

## First 15 minutes

1. Confirm the signal without pasting payloads or secrets. Check public `/api/health`, then authorized `/platform/health`.
2. Contain: pause the affected deployment, cron, webhook route, provider credential, or integration. Do not disable RLS, triggers, audit immutability, signature checks, or idempotency controls.
3. Preserve evidence: deployment/migration versions, aggregate health, safe error codes, request/correlation/job IDs, provider event IDs, and relevant audit IDs. Restrict access to raw records.
4. Rotate suspected credentials at the provider and redeploy the affected environment. Assume logs/tickets containing a secret are also compromised.
5. For support-access incidents, disable the platform administrator row, record active elevation IDs/expiry, and do not delete support/audit evidence.

## Diagnosis and recovery

- Database/migration: stop incompatible writers, compare the applied migration ledger, use the pre-release backup/PITR decision, and follow `deployment.md`. Prefer reviewed forward fixes after writes.
- Jobs/provider: follow the bounded job-recovery sequence in `deployment.md`. `delivery_uncertain` requires provider reconciliation before retry.
- Stripe/Resend webhook: preserve signature/event identifiers, compare idempotent durable outcomes, rotate a compromised signing secret, and replay only through the verified provider mechanism.
- Privacy/tenant isolation: stop affected access paths, preserve RLS/policy evidence, identify the minimum affected records/accounts, and engage privacy/legal counsel for notification obligations.
- Incorrect analytics/logging: disable the sink or deployment, restrict/delete exposed telemetry under the approved retention process, rotate any included credential, and add a regression test for the forbidden field.

Recovery requires fresh focused tests, production build, authorization/denial checks, two bounded job runs when queues are involved, and confirmation that health/log output remains privacy-safe.

## Communication

State facts, impact window, affected feature/tenant count, containment, and next update time. Do not include athlete names, guardian contacts, scores, notes, credentials, tokens, raw payloads, or speculative attribution. Coordinate breach/customer/regulator communication with privacy/legal owners.

## Closure

Close only when the root cause is fixed, provider side effects are reconciled, secrets are rotated if needed, backlogs are bounded, and monitoring is stable through the observation window. Within five business days, publish a blameless review with timeline, root cause, controls that failed, corrective owners/dates, verification evidence, privacy/retention impact, and runbook updates.
