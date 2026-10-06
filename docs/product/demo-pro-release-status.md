# Demo and Pro subscription changes — September 20, 2026

## Implemented

- Marketing's “Start a tryout” links now open `/demo`.
- The demo is now an interactive pre-created workspace: event editing, check-in, sample registrations, scoring, notes, live rankings, roster selection and a message preview. Each browser receives an independent session that resets after 30 minutes. Valid demo changes persist across reloads until expiry; expired/corrupt browser data is replaced with the initial sample. The demo never changes customer records or sends messages.
- Pro Monthly is US$14.99/month; Pro Annual is US$149.99/year. Organization is US$49.99/month or US$499.99/year. Single Tryout Pro is US$34.99 once.
- New no-card Pro trials last 168 hours after explicit activation. The same organization trial applies across web, iOS and Android. A paid subscription is a separate purchase after the trial; the trial does not auto-renew or charge a card/store account.
- Migration `202609200159_seven_day_pro_trial.sql` preserves existing 72-hour trial expiries and all existing claim/authorization protections. Applied to production with the updated UI/API copy on September 20, 2026.
- The Expo billing companion can start the shared trial and displays Pro Monthly/Annual names. It avoids loading store offerings when backend purchases are disabled.

## Verified this session

- Web and native TypeScript checks passed; targeted ESLint passed.
- 103 demo, marketing and subscription unit tests passed in the isolated release stage.
- 25 SQL assertions passed in a separate local database cloned for this change, covering expiry, duplicate activation, owner authorization, old-trial compatibility and retained data.
- iOS and Android JavaScript bundle exports succeeded. These are not signed release builds.
- Earlier screenshot-demo QA is superseded by the interactive-demo verification documented in `interactive-demo.md`.
- Stripe's configured **test** catalog now uses replacement USD prices: Pro 1499/14999 cents monthly/annually, Organization 4999/49999 cents monthly/annually, Single Tryout 3499 cents once. Prior IDs remain reconciliation-only aliases. Apple/Google store prices have not been updated; native prices continue to come from each store through RevenueCat.
- RevenueCat's current `tryoutflow_v1` offering matches the five configured Apple product mappings, including `agency.tryout.pro.monthly` and `agency.tryout.pro.annual`.

## Remaining provider and release work

- Stripe account `acct_1UBEQuKCdE6yvrL3` is in test mode. It reports charges/payouts disabled and account details not submitted; the dashboard directs the owner to business verification. The owner must complete identity/business/banking declarations before live activation.
- RevenueCat Android app `app5140192f81` uses `agency.tryout.mobile`. Its validation reports “No application was found for the given package name.” Catalog/base-plan read permissions pass. Complete the Play package's first signed upload, create its subscription products/base plans, and attach them to the existing offering. Do not invent product mappings before those products exist.
- Production Vercel is missing the new Pro price mappings, RevenueCat configuration, and the distinct billing webhook secret. Its secret values cannot be downloaded through `vercel env pull`. Finish provider configuration and verify signed webhooks and end-to-end sandbox transactions before enabling purchases.
- The website and migration are deployed at https://www.tryout.agency (deployment `dpl_GHSbAQz4W8unoZvdLmqt5ToozniR`, READY). Live demo workflow, mobile layout, all five USD prices, sign-in page and health were checked. Production trial access is enabled; purchases remain disabled. No new signed binaries were submitted and no live payment was made.
- `apps/mobile` is currently an account/billing companion, not the complete native tryout operations app. Full operations remain in the responsive Next.js web app; full native workflow parity requires further implementation and device testing.

See [billing operations](billing-operations.md) for the existing webhook, entitlement, restore and environment contracts.
