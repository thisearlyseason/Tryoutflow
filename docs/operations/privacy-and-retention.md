# Privacy and retention operations

TryoutFlow handles minor-athlete and guardian data. Data minimization and tenant isolation are release requirements, not optional cleanup work.

## Data boundaries

- Tenant content: athlete identity, birth dates, guardian/contact data, registrations, eligibility responses, scores, notes, rosters, messages, and exports. Access only through current membership/assignment checks plus RLS.
- Credentials and provider material: auth credentials, service keys, webhook secrets, API keys, confirmation tokens, provider tokens, raw webhook/provider payloads, and signed proof material. Keep server-only and never place in logs or analytics.
- Audit evidence: organization, actor, action, target type/ID, timestamp, and narrowly safe metadata. Audit rows are append-only; support elevation creates its audit record transactionally.
- Operational logs: construct only from approved request, correlation, organization, actor, job, operation, and error-code identifiers. Raw errors/messages/stacks and arbitrary context are not approved because they can contain tenant content.
- Analytics: the adapter accepts only the strict workflow event contract. Scores, notes, guardian/contact data, credentials, secrets, tokens, raw payloads, and arbitrary properties are rejected.
- Health: public health is only `ok`/`degraded`; platform detail is aggregate counts without tenant IDs or content.

Correlation/request IDs must be server-generated or trusted, 8–64 characters, and limited to letters, digits, `_`, and `-`. Never derive one from an email, name, phone, token, provider payload, or free text.

## Current enforced lifetimes

- Communication preview proofs expire within 15 minutes and the bounded purge becomes eligible after a five-minute grace period.
- Subscription checkout intents default to 15 minutes and are purged by the job processor.
- Integration export previews are bounded to at most seven days and are purged by the job processor.
- Support elevations last at least five minutes and at most four hours. Expiry removes authority even if the row remains as evidence.
- Queue leases are short-lived execution claims, not retention periods.

The repository intentionally does not invent a retention period for athlete records, guardian data, completed evaluations, rosters, provider event evidence, or audit logs. Production launch is blocked until legal/privacy owners approve purpose-specific periods, litigation/contract holds, deletion/correction/export workflows, backup expiry, and customer notices. Until then, do not run ad-hoc deletes against immutable or related records.

## Privacy review for a change

Before merging a new field, event, integration, or report:

1. Identify purpose, data owner, tenant scope, sensitivity, and whether collection is optional.
2. Prove authorization at execution time and RLS/composite-key isolation for durable data.
3. Build outbound logs/analytics/health projections from an allow-list; test forbidden keys and raw payloads.
4. Define retention, correction, export, deletion, backup, and incident behavior.
5. Review external subprocessors, residency, encryption, authentication, signatures, and least-privilege credentials.
6. Add denial tests and verify a different tenant, disabled member, non-platform user, and expired support elevation learn nothing.

## Requests and deletion

Authenticate the requester and confirm organization/legal authority before export, correction, or deletion. Preserve request/approval evidence without copying the subject's private data into generic audit metadata. Use reviewed application/database procedures that respect foreign keys and immutable evidence; never bypass triggers or RLS in routine support. Escalate conflicts with statutory, contractual, backup, fraud, or legal-hold obligations to privacy/legal owners.
