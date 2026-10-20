# Visual guides for every role

The current `/how-to` implementation contains six guides and 149 steps:

| Guide                  | Steps | Chapters |
| ---------------------- | ----: | -------: |
| Coaches & organizers   |    58 |        8 |
| Evaluators             |    20 |        5 |
| Parents & athletes     |    17 |        4 |
| Check-in staff         |    14 |        4 |
| Reviewers              |    12 |        4 |
| Scouting & performance |    28 |        6 |

Every step includes the screen location, detailed actions, an expected result and an expandable real-app screenshot. Role links preserve the selection with `?audience=coaches`, `evaluators`, `parents`, `checkin`, `reviewers` or `scouting`. Unknown audience values fall back to the coach guide. The staff topbar opens the relevant guide for individual evaluator, check-in, reviewer and scouting-only accounts; owners, administrators and directors open the coach guide. People with multiple roles can choose another guide in the six-card navigation.

The page supports chapter and individual-step anchors, text search, a clear empty state, keyboard-accessible screenshot dialogs, original-image links and browser printing. Entry points appear in public navigation, the staff topbar and the family portal. It is statically prerendered and requires no authentication or Supabase calls.

## Content and screenshots

- `src/modules/how-to/guide-content.ts`: shared types, audience registry, labels, coach and family chapters.
- `src/modules/how-to/evaluator-guide.ts`, `checkin-guide.ts`, `reviewer-guide.ts`, `scouting-guide.ts`: dedicated journeys.
- `src/modules/how-to/guide-reader.tsx`: navigation, filtering, screenshot viewing and printing.
- `src/modules/how-to/screenshots.json`: actual image dimensions.
- `public/how-to`: 126 optimized WebP screenshots, reused where steps concern the same screen. The latest three-guide addition adds 41 screenshots.
- `src/app/(marketing)/how-to`: route, canonical metadata and responsive/print styles.

Screenshots were captured from the real local app using a separate fictional Prairie Hockey Club workspace. No customer data or authentication tokens appear in the shipped images. Auth email steps show their in-app destination; the reader's email application will differ. The original coach setup screenshots show a published event reopened for editing, with the alternate labels explained in the chapter. Staff invitation and sign-out screenshots are shared because those screens are common across staff roles.

`scripts/seed-how-to-demo.mjs` prepares a local-only starting fixture. Captures include additional fictional records and UI operations recorded under ignored `output/how-to`, `output/how-to-evaluators` and `output/how-to-roles`; the initial seed alone does not recreate every illustrated state. Never run screenshot preparation against a hosted database. Do not publish fixture credentials or captured invitation links.

Use viewport screenshots: full-page capture produced scaling/stitching artifacts in this browser. Scroll the relevant control into view before capturing. Preserve the original PNG locally, transcode to WebP and update the dimensions manifest. Inspect every image. The latest pass recaptured the check-in result, session controls, ranking table, comparison table, assessment fields and CSV preview to keep the relevant controls visible.

## Verified local workflows and boundaries

- Dedicated fictional Check-in, Reviewer and scouting-only member accounts were used; screenshots do not borrow owner permissions for those workflows.
- Check-in exercised successful requested numbering, duplicate-number rejection, correction to the suggested number, successful receipt, repeat confirmation and no-match search.
- Reviewer rankings rejected a published event and worked on a finalized example event. Reviewers compared two athletes with partial/missing evaluation coverage and triggered an authorized finalized-roster CSV download.
- Reviewer Rosters navigation returned an unavailable page even for the finalized example, while Reports offered the verified export. The guide explicitly records this observed limitation and routes readers to Reports. No authorization rules were changed.
- A scouting-only account could open profiles and sporting editors, but Add prospect returned an unavailable page. The guide directs new-athlete creation to an authorized organizer.
- Scouting exercised a saved report in review, a saved follow-up and a saved development draft. Optional date fields are not evidence of a scheduled notification. Assignment/record saving is not message delivery.
- Performance exercised metric creation, a source-labelled unverified trial, CSV validation preview, one successful import and the correction editor. The small-cohort and unverified-result warnings are intentional examples.
- Athlete feedback and internal staff reports were inspected separately. Video and watchlist creation controls were captured; no real video was uploaded or linked, and no family messages were sent.
- The evaluator addition previously exercised a real simulated connection interruption: Saved on device → Saved on server → Evaluation complete → session progress. Calibration shows the actual empty state; queued-draft screenshots are not presented as verified conflict-recovery controls.

## Verification

- All 149 steps have unique anchors and an existing WebP asset with a dimensions-manifest entry.
- 39 targeted guide, marketing and navigation tests pass, covering all six deep links, unsupported audience values, filter reset, role-aware topbar links and asset integrity.
- Changed-source ESLint, formatting and TypeScript checks pass.
- The production marketing gate builds successfully, verifies `/how-to` is prerendered, returns HTTP 200 with its canonical URL, sets no auth cookies and makes no Supabase calls.
- Browser checks cover each new guide's count, matching/empty search, clearing, enlarged screenshots and Escape dismissal. Chapter navigation, 320/390 CSS-pixel mobile layouts and a 320-pixel screenshot dialog were checked. Temporary viewport overrides were reset.
- Evidence for the latest addition is in ignored `output/how-to-roles`.

## Deployment state

The coach/parent version was deployed to https://www.tryout.agency/how-to in production deployment `dpl_AR7ENWRTJXp8264Cn7smwaexuS2M`. Its live checks covered both original guides and all 55 original screenshot hashes. Authenticated production workflows were not exercised for that documentation release.

All six guides were deployed on September 16, 2026 in production deployment `dpl_7myhinDA3P86fsiBtHPKVAxun25H`. The isolated release used the hash-verified previous production snapshot plus the reviewed guide files. The live alias was verified against that deployment. All 118 public HTTP checks passed, including the six guide URLs and exact hashes for all 109 screenshots. Live browser checks verified the 132-step total across all six guides, role switching, search, clearing, screenshot enlargement, Escape dismissal and a 390-pixel layout without horizontal overflow or observed console errors. The isolated release passed 39 targeted tests, TypeScript and the Vercel production build.

Release evidence is in ignored `output/deploy-role-guides-20260916`. No database migrations or provider configuration changes were performed. Authenticated production workflows were not exercised by this documentation release.

## September 17 plan-specific update

The coach guide now includes **Organization plan: separate team workspaces** (8 steps) and **Single Tryout: prepare, run & lock one event** (9 steps). Each new step has a fresh 1440×1100 real-app screenshot, optimized to WebP. Workflow screens use isolated local demo accounts; the pricing screen shows the live public page. All six guides link directly to these chapters. The earlier subscription setup, shared-settings, roster-revision and next-event instructions now explain the Single Tryout and Organization boundaries.

Organization coverage includes creating a team, switching workspaces, inviting team-only coaches, checking a real coach account’s restricted workspace selector, parent defaults, inherited team settings and centralized billing. The demo owner created U18 Falcons through the UI. The coach screenshot uses a separate team-only administrator session.

Single Tryout coverage includes the one-time USD price, draft identity and session planning, publication, the 14-day session span, the 7-day wrap-up deadline, explicit permanent completion, retained reports and starting a separately licensed event. A provisioned local demo event was published and completed through the real UI; the completed-report example uses a populated earlier demo event. No live payments or real customer messages were sent. The chapter explicitly says checkout is still coming soon and distinguishes demo access from a paid transaction.

The Single Tryout publish screen now explains that publishing fixes identity, divisions and dates, replacing the generic promise that all setup remains editable. The setup header also respects that plan distinction, and successful publication refreshes the event layout so the fixed deadline appears immediately. No billing rules or database schema are changed in this documentation update.

Source: `src/modules/how-to/plan-guides.ts`. Capture originals, local workflow evidence and release verification are retained under ignored `output/how-to-plans`.
