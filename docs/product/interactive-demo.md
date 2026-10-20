# Interactive demo

`/demo` opens a pre-created, editable sample workspace without sign-in. It includes eight fictional athletes, attendance, a three-criterion evaluation rubric, completed and incomplete scorecards, rankings with ties, a draft roster, and a message preview. Visitors can rename the event, add sample registrations, check athletes in, score athletes, write sample notes and change the roster. Scoring uses the application's existing `ScoreControl` component.

## Reset behavior

- Each browser has an independent demo, stored under `tryoutflow.interactive-demo.v1`. Tabs in the same browser share it using storage events.
- A session expires 30 minutes after it starts. Ordinary edits and reloads never extend the deadline.
- The countdown checks elapsed wall-clock time each second and on focus/visibility changes. Reset restores all sample data and returns to Overview. A manual Reset demo button also starts fresh.
- A closed/suspended browser does not run background cleanup. Expired state is rejected on the next interaction or visit, before showing it as an active session. Stale actions cannot write into a new session.
- Invalid saved data or a backwards clock change starts a fresh demo. If browser storage is blocked, the demo still works in memory and resets while open; reload starts fresh.
- Data remains in the visitor's browser. No demo account, shared tenant, database writes, real emails or billing operations are created. The paid application and customer records are unaffected.

## Verification

103 demo/marketing/subscription unit tests passed in the isolated release stage, including exact expiry, refresh persistence, suspension recovery, cross-tab resets, blocked storage, incomplete-score exclusion and tied rankings. TypeScript, targeted ESLint and diff checks passed.

Browser checks covered check-in, scoring all three criteria, live ranking updates, roster selection, persistence after reload, manual reset and the mobile athlete selector. Both desktop and 390px phone layouts were reviewed. Screenshots are in `output/playwright/interactive-demo-desktop.png` and `output/playwright/interactive-demo-mobile.png`.

This replaces the screenshot-only walkthrough. Deployed to https://www.tryout.agency/demo on September 20, 2026. Live checks covered check-in, scoring, rankings, roster selection, reload persistence, manual reset, desktop layout and a 390px phone viewport with no horizontal overflow.
