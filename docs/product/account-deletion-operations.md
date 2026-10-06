# Account deletion operations

GameDay Technologies completes verified account-deletion requests within seven days and confirms completion by email. Monitored support: gamedaysportstech@gmail.com. This is manual fulfillment; the in-app/web action creates a request, not an immediate hard delete.

## Request and monitoring

Web `/delete-account` and native `Delete account` submit authenticated requests to `/api/account/deletion`. The database binds the request to `auth.uid()` and a verified account email; clients cannot choose another account. Retries preserve the same request and deadline. Private queue data is inaccessible to ordinary API roles; platform functions recheck durable administrator status. Staff review `/platform/deletions`, ordered by deadline, with overdue requests labeled.

The authenticated daily Vercel GET `/api/cron/account-deletion` monitor sends pending request notices to the monitored inbox at 13:00 UTC. It requires the production `CRON_SECRET` bearer header and initializes service credentials only after authentication. The existing authenticated POST `/api/jobs/process` worker can also send pending notices. A stable request-based provider idempotency key limits duplicate sends; successful API acceptance is recorded separately from inbox delivery. Failures remain pending and the queue remains authoritative. Confirm the production job scheduler and actual monitored-inbox receipt before launch. Notices contain a reference/deadline and protected queue link, not customer contact details or athlete records.

## Fulfillment checklist for each real request

1. Confirm the authenticated request, contact email, deadline and requester scope. Email-originated requests need identity verification before staff handle personal data. Never request passwords.
2. Inventory the account's memberships and personal data, including profile/contact information, uploads, participant/guardian records and downstream processors. Recheck current membership state; the request snapshot is context, not continuing authority.
3. For shared organizations, agree on transfer to an eligible existing member; do not promote someone silently or erase other people's records. If no member remains, obtain explicit organization-closure confirmation. Preserve other members' access while removing the requester's personal data. Do not wait for a subscription to expire before processing deletion.
4. Cancel applicable Stripe web billing and reconcile access; provide Apple/Google management links for store cancellation. Do not promise that deleting the app or account cancels a store subscription.
5. Remove personal data and the authentication account using reviewed, scoped operations. Existing auth-user foreign-key restrictions and immutable audit/billing structures require deliberate dependency handling. Do not disable integrity protections or invent legal retention justifications. Explain any actual legal retention and backup handling to the requester. **This change does not yet provide a fully verified destructive fulfillment procedure for populated accounts.**
6. Verify absence of the account and associated personal data, sign-in/session revocation, shared-member access, and appropriate billing state. Send the completion notice to the verified requester. Record evidence without retaining unnecessary personal data.
7. Only then use `Record verified completion`. The database requires that the auth account has been removed and that staff explicitly attest to personal-data handling, organization handling, billing and notification. Recording completion clears the queue contact email and organization snapshot. This attestation is not automated proof of downstream data removal or inbox receipt.

## Deployment and verification

Apply migration 163 to the identified TryoutFlow project after validating current schema/backup. Deploy the scoped web code only after the migration exists. Verify active platform support access and job scheduler before enabling this workflow for users. Ship updated native builds; the previous build4 only links to the support-assisted public page.

Local evidence is under `output/launch-deletion-20260929`. Database tests cover privacy, idempotence, deadline and premature-completion rejection. Browser testing covers submission, reload and receipt on desktop/mobile. Native component tests are mocked; Bearer API testing uses real local Supabase. Neither proves signed store purchase behavior, production deletion, or actual inbox receipt.
