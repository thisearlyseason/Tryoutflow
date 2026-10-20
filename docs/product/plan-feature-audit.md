# Plan feature audit — September 17, 2026

This is local verification against a separate Supabase instance with billing enabled in sandbox mode. No production database, provider setting, or deployment was changed. Accounts used synthetic data and explicit test grants, not real purchases.

## Public feature contract

| Capability                                        | Pro (including active 3-day trial) | Organization | Single Tryout Pro    |
| ------------------------------------------------- | ---------------------------------- | ------------ | -------------------- |
| Publish tryouts                                   | Included                           | Included     | Licensed tryout only |
| Weighted criteria, scales and priority categories | Included                           | Included     | Licensed tryout only |
| Evaluator radar and average                       | Included                           | Included     | Licensed tryout only |
| Athlete comparison and weighted rankings          | Included                           | Included     | Licensed tryout only |
| Custom evaluation templates                       | Included                           | Included     | Licensed tryout only |
| Tryout reports, decision packet and CSVs          | Included                           | Included     | Licensed tryout only |
| Additional evaluator assignments                  | Included                           | Included     | Licensed tryout only |
| Historical athlete scorecards                     | Included                           | Included     | Excluded             |
| Scouting and measured performance                 | Included                           | Included     | Excluded             |
| Shared sport defaults for new tryouts             | Excluded                           | Included     | Excluded             |
| Organization logo                                 | Excluded                           | Included     | Excluded             |
| Aggregate organization/program reporting          | Excluded                           | Included     | Excluded             |

Roles and assigned scope still apply. For example, purchasing Pro does not let an ordinary evaluator read manager-only historical records. A radar requires at least three observed criteria; smaller rubrics show a score table. Historical scorecards retain their original rubric labels, rather than pretending unlike forms are directly comparable.

Public copy now uses “Weighted evaluations,” “Historical scorecards,” and “Shared program defaults,” with descriptions limited to implemented behavior. The program-default benefit is shared sport defaults in new tryout setup. Saved terminology and tag preferences are not advertised as an application-wide relabeling or tag propagation feature.

## Corrections

Migration 153 adds database enforcement for organization report summaries/exports, program attendance, comparison requests, custom/weighted rubric mutations, evaluator grants, calibration and program-default mutations. Initial organization creation cannot smuggle in paid defaults. Regular timezone changes remain available.

The active service-only logo upload now checks Organization access. Logo bytes remain stored after downgrade, but the public image endpoint, member metadata and public registration branding stop exposing them. Removing an existing logo remains authorized under the existing role rules.

The historical-scorecard projection checks both manager role and historical access. It returns original criterion labels and scores without private notes or evaluator identities.

Single Tryout decision packets now load only the selected event's athletes and ranking evidence. Organization-wide scouting/performance/scenario supplements are added only when that separate access is available. Pro's report hub retains links to included scouting reports and performance exports while organization totals remain locked.

UI upgrade prompts match the underlying RPC/trigger restrictions. Unauthorized CSV requests follow the existing privacy-preserving HTTP 404 contract instead of surfacing a server error. Direct authenticated calls cannot bypass the restrictions.

## Verification

- Full unit suite: **129 files / 1,428 tests passed**.
- Database regression suites: billing lifecycle **53**, three-day trial **21**, feature enforcement **64** assertions passed.
- Authenticated plan matrix: **76/76** checks across Pro, Organization, Single Tryout and expired access, including another tenant and an unlicensed event.
- HTTP endpoints: **24/24** checks for athlete/evaluation/final-roster CSVs, organization and unlicensed-event CSV denial, and public logo delivery.
- Browser review: **49 signed-in routes** across the four access states, including rankings, comparisons, reports, decision packets, template setup, staffing, settings, scouting, performance and history. Awaited completed rendering rather than accepting loading placeholders.
- Exercised weighted-template saves, scouting report creation, performance metric/result creation, and CSV output containing measured results.
- Published fully configured duplicate tryouts under Pro and Organization. Verified unpaid draft publication and attempts to copy paid templates into an unlicensed event are blocked.
- Completed a three-criterion evaluation in the Single Tryout browser account, saved it to the server, and rendered the evaluator-average radar from the saved scores.
- Uploaded an Organization logo through the browser and confirmed successful server normalization and persistence.
- Saved Organization sport defaults in the browser and verified the next tryout form adopted the selected sport.
- TypeScript, targeted ESLint and formatting passed.

Regression source: `supabase/tests/153_plan_feature_enforcement.test.sql`. Local browser screenshots are in `output/playwright/plan-audit/`; detailed probe results are in `output/plan-audit/`. These directories also contain local-only authentication state and are not release artifacts.

## Release boundary

Ship application changes with migrations through **153**, using the existing billing activation process in `billing-operations.md`. Existing legacy accounts retain their prior access contract; this audit does not silently convert them to a new tier. Expired grants preserve evaluations, templates and branding records.

The evaluator runtime requires the configured matching snapshot-proof signing/public keys. The isolated test server used a generated local pair. This audit establishes local feature behavior and restrictions; it does not establish production migration state, live checkout, app-store purchases, restoration or physical-device behavior.
