# Billing implementation and activation

## Release boundary

The new billing implementation is additive. Existing Trial, Team, Club and Association checkout, subscriptions, invoices and trial access are retained. New purchase options remain inactive while `BILLING_ENVIRONMENT` is unset. Do not enable the new catalog before the database migrations and provider sandbox checks below pass.

The Expo companion lives in `apps/mobile`. It provides account sign-in, organization selection, native subscription/one-time purchase, restore, current backend access and provider-aware management. It does not replace the full sports operations web application. Native JavaScript bundles are not signed App Store / Google Play releases.

## Database and access model

Apply migrations 139–154 in order, after verifying the target database and existing migration history. They add products, immutable contract attribution, purchase intents, promotional overrides, financial event history, operational webhook delivery status and separate minimal product analytics. No migration deletes athletes, evaluations, reports, assets, configuration or historical tryouts.

`get_effective_entitlements` is the tenant-authenticated access API. `private.effective_billing_access` powers SQL boundaries. Publishing, athlete-average radar data, ranking/comparison snapshots, report export, scouting/performance RLS, rubric mutations, evaluator grants, historical scorecards, shared defaults, organization reports and active logo-upload/read paths check centralized capabilities. Existing role/scope authorization is still required. Client FeatureGate dialogs do not grant access. Basic individual evaluation data remains subject to existing role permissions.

Initial numeric limits are unlimited because no existing numeric business rules were defined. Product limits are centralized in `billing_products.limits`; serialized insertion triggers enforce configured tryout, athlete, evaluator and template counts. Existing over-limit data remains stored. Enabling limits is a separate business decision. Existing legacy active/trialing accounts retain their previous state-based access contract until converted to a new organization subscription; this includes indefinite trials. No existing organization is silently migrated into a restrictive new tier. Single-tryout purchases inherit only within their bound tryout; organization-wide scouting/history are separate.

The private configuration row defaults to `enabled=false`, preserving prior SQL authorization until activation. After all provider acceptance checks, set its environment (`sandbox` or `production`) and `enabled=true` using a reviewed administrative SQL session, then set the matching server `BILLING_ENVIRONMENT`. The migration does not activate purchases or enforce new feature restrictions by itself. The application environment must match it. **Never change a production organization database to sandbox to test payments.** Use a separate Supabase project/database and provider test keys.

## Stripe

Reuse `STRIPE_SECRET_KEY` and existing legacy price variables. Keep `STRIPE_WEBHOOK_SECRET` for the existing endpoint; configure the new endpoint’s distinct signing secret as `STRIPE_BILLING_WEBHOOK_SECRET`. Configure the five new `STRIPE_PRICE_*` mappings in `.env.example` only after product/pricing approval. Prices shown in the web UI come from active Stripe prices. When replacing a price, move its previous ID to the corresponding comma-separated `STRIPE_LEGACY_PRICES_*` variable so existing renewals, refunds and restores still resolve. Those aliases are never offered for new purchases. No secret or provider price ID is embedded in client UI configuration.

Keep the existing `/api/webhooks/stripe` endpoint for legacy subscriptions. Add `/api/webhooks/billing/stripe` for the new catalog with `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`, `charge.refunded`, `charge.dispute.created`, and `charge.dispute.closed`. Both endpoints verify signatures. The v2 endpoint ignores legacy subscription metadata and never writes competing legacy account state.

Create a dedicated Customer Portal configuration and set `STRIPE_BILLING_PORTAL_CONFIGURATION_ID`. Keep the default legacy portal unchanged. The dedicated launch sandbox portal includes the operator and public legal URLs, invoice/payment-method access, and cancellation/resumption. Portal plan switching stays disabled because Stripe only supports deferred downgrades within the same product.

Web owners use **Review plan change** to see the provider price and renewal date, then explicitly confirm. Both upgrades and downgrades take effect at the next renewal; there is no immediate charge, credit, or access reduction. The server verifies the bound customer, purchaser, organization, product mapping, current paid period and quote before creating a Stripe schedule. Repeated confirmations reuse the provider idempotency record. An interrupted schedule creation can be recovered only by the matching attempt. A completed transition is released when a later change is confirmed. **Cancel pending plan change** releases the schedule without cancelling the paid subscription. Native purchases use their native store management flow and cannot call this web-only endpoint.

These controls support active, automatically charged, single-item subscriptions with quantity one and standard recurring prices. Subscriptions with discounts, tax configuration, pending payment updates, an unrelated schedule, or a pending cancellation fail closed for review; do not silently rewrite those terms. Stripe events and explicit refresh reconcile the actual product and timing. A cancelled subscription stays entitled through its verified paid-through boundary. Failed-payment access is based on the last paid invoice, not an unpaid future billing period. `STRIPE_GRACE_PERIOD_HOURS` defaults to 0; set an approved value up to 168 only if the business/provider grace policy warrants it.

September 29 sandbox evidence: real Stripe test-clock transitions between Pro and Organization, pending-change cancellation, stale/conflicting confirmation rejection, and interrupted request recovery passed. The exact browser, deployment, and provider evidence is in `output/launch-20260929/`; this is not live financial or native transaction acceptance.

One-time full refunds revoke the affected tryout license. Current-period subscription refunds revoke that period; historical invoice refunds do not revoke a later paid period. A refresh cannot restore the same refunded period accidentally. Partial refunds retain access; the verified delivery remains recorded. Open chargebacks pause the affected access; lost chargebacks revoke it, and won disputes restore access after authoritative verification. Reconciliation checks the latest paid invoice and one-time charges to recover missed refund/dispute notifications. These paths still require real sandbox acceptance tests.

## RevenueCat / Apple / Google

Create Apple and Google app records using the chosen bundle/package identifiers, sign the native builds, connect stores in RevenueCat, and configure products and offerings. Use custom package identifiers matching internal keys (`pro_monthly`, `pro_annual`, `organization_monthly`, `organization_annual`, `single_tryout_pro`). Map actual platform product identifiers through the server environment variables. Single-tryout products must support repeated purchases (consumables); a single permanent non-consumable SKU cannot license multiple independent tryouts.

Configure public native SDK keys only in `apps/mobile/.env`. Keep `REVENUECAT_SECRET_KEY`, `REVENUECAT_V1_API_KEY`, `REVENUECAT_PROJECT_ID` and webhook secrets on the server. The scoped V2 secret is rejected by the V1 API; configure a separate V1-compatible API key from the same project for CustomerInfo reads. Do not reuse the V2 secret for V1 requests. The server key needs customer subscription/purchase read and product read permissions. The backend uses RevenueCat v2 stable subscription/purchase IDs for durable binding and missed-webhook recovery; v1 CustomerInfo supplies exact grace/refund information. Customer, original customer, store, environment, product and ownership are verified. Family-shared and cross-account receipts are rejected for organization attribution.

Set webhook URL `/api/webhooks/revenuecat` and Authorization to `Bearer <REVENUECAT_WEBHOOK_SECRET>` (at least 32 characters). If configured, `REVENUECAT_WEBHOOK_SIGNING_SECRET` additionally requires `X-RevenueCat-Webhook-Signature` HMAC verification over timestamp and exact bytes. Configure restore behavior to keep receipts with their original App User ID. The app identifies RevenueCat with the authenticated Supabase UUID before purchasing. Subscriber attributes and client entitlement booleans are never ownership evidence.

Native purchases reserve a server-authorized intent before opening the store. Restore asks the SDK to restore, then reconciles authoritative provider records with existing bindings/intents. An unbound historical receipt without a matching original authorized intent requires support review; the app never guesses an organization. Store-initiated transfers pause the original grants and record a review event rather than silently moving an organization subscription. Adjacent, verified native product replacements can inherit the original organization binding; ambiguous changes require review.

## Native build

1. Copy `apps/mobile/.env.example` to `apps/mobile/.env` and fill public configuration.
2. Confirm the bundle/package IDs in `app.config.ts`; `agency.tryout.mobile` is registered in both store accounts.
3. From `apps/mobile`, run `npm ci`, `npm run typecheck`, and `npx expo install --check`.
4. Use an Expo development build (`npm run ios` or `npm run android`). RevenueCat native purchases require a development/release build, not an unconfigured Expo Go preview.
5. Configure EAS project/signing and run the desired profile in `eas.json`.
6. Complete store-required metadata, privacy disclosures, subscription terms and sandbox testing before submitting signed binaries.

Before a build, verify the current RevenueCat offering against the server's product mappings:

```sh
node --env-file=.env.billing.sandbox scripts/verify-native-billing-catalog.mjs --platform apple --key-file /absolute/path/to/apple-public-sdk-key
```

Use `--platform google` with the Android public SDK key for Google. Alternatively, provide the corresponding `EXPO_PUBLIC_REVENUECAT_APPLE_KEY` or `EXPO_PUBLIC_REVENUECAT_GOOGLE_KEY` environment variable. This read-only check fails on missing, duplicate, unexpected or mismatched packages. It does not verify StoreKit/Play availability, a signed build, purchase delivery or organization access. The current configured offering is `tryoutflow_v1`; its custom package keys match the backend catalog. Android products remain pending the first signed store build.

A scoped `xcode → uuid 11.1.1` override replaces the vulnerable legacy UUID dependency while retaining the CommonJS v4 API Xcode tooling uses. SDK 57 dependency compatibility, native bundle export and npm audit should be rechecked on upgrades.

## Required sandbox proof before activation

Run both direct API/RLS tests and real provider sandbox transactions: initial purchase, renewal, upgrade, scheduled downgrade and cancellation of that change, cancellation/resume, payment failure/recovery, grace ending, expiration, full/partial refund, restore on another device, pending purchase, interrupted app, duplicate checkout, duplicate/out-of-order webhook, transferred receipt, native product replacement and one-time purchase reuse across tryouts. Verify that data counts and historical records survive every downgrade/refund. Verify that each provider environment reaches only its intended database.

A successful local test or exported native bundle does not establish a real payment, signed installation, cross-device restoration, store approval or production billing activation. Check `billing_deliveries` for failed deliveries; replay only authentic provider events after correcting configuration. `billing_events` and `billing_audit_log` are the retained history. Provider adapters intentionally return generic user errors.

## Operational reconciliation

`reconcileOrganizationSubscription(organizationId)` is invoked by explicit refresh/restore and native purchase completion. Webhooks also reconcile authoritative provider state. Ordinary page renders read the local database without querying provider subscriptions. The existing authenticated `/api/jobs/process` invocation now claims one due organization from a leased queue. Successful reconciliation schedules the next check in six hours; failures retry after ten minutes. Confirm the existing operational scheduler calls this endpoint regularly using its established job authentication. Queue throughput must be sized to the number of organizations; one invocation handles one organization.

## Remaining release verification

Live provider product configuration, the real sandbox matrix, signed iOS/Android device testing and store publication require the owner's provider/store accounts. The provider product configuration and external scheduler cadence have not been activated or verified for this new catalog. Do not describe this release as financially certified or fully production-ready until those items and all provider acceptance cases are complete.

## Provider references

- [RevenueCat subscription data model](https://www.revenuecat.com/docs/api-v2/subscription-data-model)
- [RevenueCat purchase API](https://www.revenuecat.com/docs/api-v2/purchase)
- [RevenueCat webhook authorization](https://www.revenuecat.com/docs/integrations/webhooks)

## Seven-day Pro trial

Migration 152 introduced an explicit no-card trial; migration 159 makes new trials seven days (168 hours), preserving existing trial expiry timestamps. Once billing is activated, newly created organizations begin without paid access; their owner starts the trial from Billing & plans. Both Pro Monthly and Pro Annual use this same once-only trial before a separate paid purchase. The Pro pricing CTA leads into this setup, and new organizations are directed to billing after creation when `BILLING_ENVIRONMENT` is configured. The clock starts at activation, not account creation. One organization and one initiating account can claim a trial once. Retries never extend it. The private trial ledger cannot be written with user or service-role credentials directly.

The shared database resolver grants Pro features until the exact expiry timestamp; it does not grant Organization-only branding/reporting. No provider subscription or automatic charge is created. Expiry requires no scheduled job and preserves customer data. Existing legacy subscriptions and pre-activation trials retain their access. The billing screen displays the end time and remaining time. Apply the schema together with the application and complete the existing billing activation steps before publishing the trial offer as available in production.

## Plan feature regression

Migration 153 closes the feature boundaries and aligns the public plan descriptions with verified behavior. See [the feature audit](plan-feature-audit.md) for the scope matrix, local evidence and release limits. Run `supabase/tests/153_plan_feature_enforcement.test.sql` with the existing billing and trial regression suites before activation.

## Independent access activation (migration 154)

`access_enabled=true` enables new-account access restrictions and the no-card trial independently of payment processing. `enabled=false` continues to reject purchase reservations and provider snapshots. To release the trial before live payments, set the database environment to `production`, set `access_enabled=true` while retaining `enabled=false`, deploy with `BILLING_ENVIRONMENT=production`, and set `BILLING_CHECKOUT_ENABLED=false` so public pricing clearly says paid plans are coming soon. The billing dashboard reads payment availability directly from the database. Existing legacy access remains intact.

Trial activation and access refresh do not call a payment provider. When live payment acceptance is complete, enable the existing database payment switch and update the public checkout-availability setting together. Never point the production database at sandbox payment credentials.

## Organization team workspaces

Migrations 155–156 add team workspaces beneath one Organization account. Each team reuses the existing organization tenant boundary for its own athletes, tryouts, evaluations, reports, and staff. Existing data stays in the original organization workspace; creating a team never moves or merges it. Team creation is limited to root organization owners/administrators with `organization_management`. Pro, Pro trials, and Single Tryout do not grant this capability. Nested workspaces and reparenting are blocked.

Organization owners and administrators inherit corresponding memberships in every team. New administrators, demotions, disabling, and ownership changes propagate transactionally; inherited memberships cannot be edited in a team. Invite team coaches through that team's Members & permissions page with the Administrator role. Their membership does not grant access to the parent or sibling teams. A coach invited to several teams sees only those teams in the workspace switcher.

The Organization plan's access and paid-through boundary are evaluated dynamically for each child workspace. Child contracts, purchase intents, promotional overrides, and trials are blocked, including legacy checkout intents. A child cannot acquire an independent subscription to bypass the parent. On downgrade or expiry, premium team operations stop and existing records remain stored. Restoring the parent Organization plan restores team features.

Terminology, sport defaults, and tags propagate from the parent, while teams may choose a local timezone. Logos are served from the parent's protected brand asset, including on team registration pages, and cannot be replaced from the child. The Team workspaces page reports counts across child workspaces and links to their detailed reports; counts represent team records, not deduplicated people across teams. The parent workspace's own records remain separate.

Verification covers cross-team reads/writes/RPCs, inherited authority and offboarding, shared defaults and branding, trial/purchase rejection, plan downgrade/expiry/restoration, creation retries, authenticated team creation and invitation acceptance, coach athlete/tryout creation, reports, and responsive navigation. Payment-provider activation remains a separate release gate.

Billing workspace discovery returns only root organizations, for both cookie and native bearer authentication. Team members use their inherited access; child workspaces are never offered as independent billing accounts. Migration 156 preserves the original unambiguous membership-to-organization relationship for older clients.

## Single Tryout completion and anti-reuse

A Single Tryout purchase is permanently bound to its organization and tryout ID. At publication (or purchase of an already published event), the database retains an immutable identity and session schedule. Name, sport, season, divisions, positions, registration dates and sessions cannot be repurposed, moved, deleted or extended. Drafts remain editable before publication. Sessions must fit within 14 days and registration must close by the final session.

Editing ends immediately when a manager confirms **Complete & lock tryout**, or automatically seven days after the final scheduled session, whichever comes first. Deadline enforcement runs on every write and requires no scheduled job. Completion is irreversible, including after provider receipt replays, refunds, new overrides or a subscription upgrade. Creating or duplicating another event does not copy its purchase. Additional events require their own license or a subscription.

Database triggers serialize event writes with completion and cover setup, registration, check-in, evaluation scores and notes, rosters, event operations and new communications, including indirect child records. The original records remain readable and exportable under the purchased plan. Already queued communications can finish delivery and staff access can still be revoked; these operational exceptions cannot change event content or reopen it. Shared athlete identity cannot be rewritten when referenced by a locked event. Ordinary Pro and Organization events retain their existing editing behavior.

Single purchase and override rows require a tryout ID. The immutable private license record cannot be edited by client or service-role credentials. Checkout refuses a completed/expired event or an invalid session window before creating a new purchase. Customer rescheduling after publication is not self-service; do not alter the retained license ledger to make a new event reuse an old payment.
