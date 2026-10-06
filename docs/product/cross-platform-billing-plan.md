# Cross-platform billing: audit and implementation plan

## 1. Current architecture

TryoutFlow is a Next.js 16 App Router / React 19 / TypeScript modular monolith. Supabase Auth establishes the server session through cookies and `auth.getUser`; PostgreSQL 17 with RLS and security-definer RPCs is the durable authorization boundary. Organizations own tryouts, divisions, sessions, athletes and staff assignments. Organization roles are owner, administrator and member; scoped roles are director, evaluator, check-in and reviewer. Separate durable platform administrators exist. Feature modules cover registration, scoring, rankings, rosters, communication, reports, scouting, performance and participant access. API handlers and server actions coexist with database RPCs. There are no Supabase Edge Functions in this checkout.

This repository has no Expo, React Native, Capacitor, Swift, Kotlin or existing store app. Native work requires a companion app or a supplied mobile repository. The question about that destination is pending; backend work is independent of it.

## 2. Existing billing

Reuse `src/modules/subscriptions` and `src/infrastructure/billing`. Existing owner-only checkout and Customer Portal routes validate the session, organization ownership, origin and idempotent checkout intent. Stripe signature checks use the installed Stripe SDK. Subscription webhooks record immutable, digest-bound events and reject conflicting customer/subscription bindings and stale deliveries. Existing tables are `subscription_accounts`, `subscription_events` and `subscription_checkout_intents`. Publishing is gated by a database function. Other premium features do not yet have a shared entitlement catalog. Existing launch plans are Trial, Team, Club and Association, with monthly CAD prices; do not silently rewrite existing provider subscriptions or prices.

## 3. Database changes

Add a versioned product/feature catalog and provider product mappings. Extend the subscription module with cross-provider purchase records and immutable transaction-to-organization/tryout attribution; retain the existing Stripe account/event evidence for compatibility. Add normalized entitlements, signed-provider event receipts and server-created purchase intents, plus auditable temporary grants/revocations. Enforce foreign keys, tenant-consistent tryout references, unique provider transactions/events, expiration, row locks and service-only writes. Authenticated users may read their effective access; only existing owners manage billing; only platform administrators grant promotions. Existing RBAC remains required in addition to payment access.

## 4. Backend changes

Implement a provider-neutral effective-entitlement resolver and feature checks backed by PostgreSQL. Apply inheritance without copying organization subscriptions into every tryout. Integrate paid checks at server and database boundaries, retaining basic scoring and existing customer data on expiry. Extend Stripe checkout with monthly/annual products and one-time tryout licenses; use server-configured prices and verified lifecycle events, never success redirects. Preserve the existing portal. Add authenticated, bounded, idempotent RevenueCat events and reconciliation with explicit immutable purchase attribution. Sandbox purchases cannot grant production access. Treat cancellation as non-renewal until the verified paid-through date; refunds/expiration revoke the affected grant, not customer records. Product changes take effect according to verified provider timing.

## 5. Frontend changes

Extend the existing billing page with provider-neutral plan, source, renewal/expiry, one-time tryout access and appropriate management actions. Add configurable plan selection, owner-only tryout purchase entry, a reusable explanatory FeatureGate, and a platform promotional-access form. Price labels must come from configured/provider products. Unconfigured products remain unavailable rather than showing invented checkout prices. Preserve legacy plan compatibility during migration.

## 6. Mobile changes

Use RevenueCat on the selected native framework with the authenticated Supabase user UUID as App User ID. Purchase UI loads localized store offerings, supports pending/cancel/error/loading states, and performs restore explicitly. Client success only starts server reconciliation; application access is read from the backend. New native purchases reserve an authorized organization/tryout intent before opening the store. A client-writable subscriber attribute is never authority to assign a paid organization. Native subscription capacity and repeatable single-tryout store product types require provider configuration and sandbox validation.

## 7. External setup and verification

The owner must configure real Stripe product/price IDs, billing portal changes, webhook endpoint secrets/events, and live/sandbox environments. RevenueCat needs separate public SDK keys, a secret server key, authenticated webhook delivery, Apple/Google app connections, product/entitlement/Offering mappings, and explicit restore/transfer policy. Apple/Google need app identifiers, signing, approved product records, testing accounts/tracks and current store review compliance. No native app, credentials or store provisioning currently exists in this checkout. Code tests cannot establish live payment completion or store publication. Do not enable a live catalog until provider sandbox purchase, renewal, cancellation, refund and restore checks pass.

## 8. Migration risks and sequence

Use additive migrations and explicit legacy-plan mappings. Preserve old immutable receipts and customer bindings. Avoid silently removing existing trial/paid access, retroactively charging customers, inventing prices, or deleting records after billing expiry. Deploy schema before dependent application code; use a scoped release and source manifest because the working tree contains unrelated changes. Test RLS/direct RPC bypass, cross-tenant IDs, idempotency, ordering, mixed providers, attribution replay, concurrent checkout, period-end cancellation, refunds, transfers and restore. Payment state must be reconciled from the provider; cache/redirect/client state is never a grant.

The supplied attachment stops at the heading “30. DOWNGRADES”; any remaining requirements are pending. Proceed with the supplied specification and preserve data/read access on downgrade.

## Provider references

- https://docs.stripe.com/billing/subscriptions/webhooks
- https://docs.stripe.com/api/events/types
- https://www.revenuecat.com/docs/integrations/webhooks/event-types-and-fields
- https://www.revenuecat.com/docs/integrations/webhooks/event-flows

## Accepted clarifications

- Add an Expo/React Native companion application in this repository.
- Sections 30–61 were supplied in the conversation: preserve data through every downgrade/cancellation/refund, expose scheduled plan changes and resumptions, normalize provider grace states, reconcile missed webhooks, centralize configurable usage limits without inventing restrictive defaults, add admin/event visibility and separate privacy-safe analytics, and test lifecycle/security/RLS behavior.
- No existing athlete/evaluator/template usage limits were found. Initial limits remain unlimited (`null`) until explicitly configured; the enforcement architecture supports numeric limits. Existing Trial/Team/Club/Association subscriptions remain compatible.
- The completed landing refresh is now live as `dpl_B2N6fTiehW7Mu7Xdi3ypraRUAAZR`; billing changes are a separate schema/application release.
