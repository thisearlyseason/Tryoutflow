# TryoutFlow: professional tryout and scouting product review

Reviewed September 14, 2026, America/Edmonton (September 15 UTC).

## Assessment

TryoutFlow has a useful foundation for administering tryouts and collecting independent ratings. Its current athlete records, evaluator records, performance data, and scouting workflows are too limited to support a professional scouting department's daily work.

The main investment should be a connected information system: **athlete → observation → measurement → evaluator → evidence → decision → development history**. Visual polish will help, but the core gap is the information people can collect, find, compare, and act on.

This is a product assessment, not a claim that professional leagues have evaluated or rejected the product. Professional-team adoption requires validation with actual directors, scouts, analysts, and procurement teams. League-wide deployment adds different requirements from an individual team's tryout.

## What was actually reviewed

**Live product:** the signed-in owner workspace at [tryout.agency](https://www.tryout.agency/app/thesquad/home), including the existing published tryout. Reviewed dashboard, athlete directory/detail, evaluator directory/profile/entry point, participant intake, staff assignments, sessions, check-in search, live dashboard, rankings, comparison entry, roster setup, decision-message entry, organization and tryout reports, registration/division/rubric setup, public registration entry, members, integrations, settings, audit, and subscription billing.

**Interaction and layout checks:** live check-in search returned the existing participant; ranking layout was inspected on desktop, at 390 × 844, and at 768 × 1024. The existing isolated evaluator fixture was opened locally, its score controls exercised at phone width, and its save feedback and reload behavior inspected.

**Implementation:** reviewed current route components, domain models, scoring and comparison logic, CSV contracts, offline evaluation components, database migrations, and operational documentation. Checkout HEAD was `b26a85488f28104ce0903dc3d0e630642611211b`, on `codex/tryoutflow-ui-redesign-20260913`, with extensive pre-existing modifications. Source findings describe that working tree; its complete equivalence to production was not established.

**Limits:** the live workspace had one registered athlete, zero active evaluator assignments, zero completed evaluations, and no finalized rosters. Populated multi-athlete comparisons, production evaluator saves, roster finalization, delivery, integrations, offline recovery, and high-volume behavior were not exercised. The local fixture's simple save handler returns a simulated success and resets on reload; this establishes UI behavior only, not a production persistence defect or proof of successful persistence. No production records, permissions, roster decisions, or settings were changed. No messages were sent. No release certification or full test suite was run.

The findings below distinguish live observations, source-confirmed capabilities, and proposed additions. A feature is described as absent where it was not found in the reviewed screens and corresponding implementation; this is not a claim about unpublished work elsewhere.

## Existing foundations worth retaining

- Configurable registration questions and waiver wording; published form versions; public registration windows.
- Returning-athlete intake, CSV import with column mapping and validation, and duplicate-review foundations.
- Sessions, divisions, groups, check-in, QR support, and tryout numbers.
- Scoped evaluator assignments and blind evaluation support.
- Whole-number ratings, category weights, descriptions, guidance, tags, and flags.
- Completed-evaluation scoring, genuine ties, coverage counts, and score ranges.
- Two-to-four-athlete comparisons with category and session breakdowns in source.
- Roster teams, position targets, decision statuses, finalized snapshots, and revisions in source.
- Evaluation draft storage and synchronization/conflict machinery in source.
- Tenant authorization, audit events, and constrained exports in source.

These are substantial foundations. They should be extended rather than described as missing or replaced wholesale. Their existence does not certify every live execution path.

## Priority map

| Area                     | Current evidence                                                   | Main gap                                                                              | Priority                        |
| ------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------- | ------------------------------- |
| Athlete profile          | Live detail shows name, birth date, and date added                 | Editable sporting identity, history, evidence, contacts under appropriate permissions | First                           |
| Evaluator profile        | Directory shows name/count; own profile shows name/organization    | Qualifications, expertise, assignment readiness, workload and review history          | First                           |
| Performance stats        | Rubrics expose 1–5 or 1–10 ratings                                 | Typed measurements, trials, units, event stats, verified source and date              | First                           |
| Registration information | Custom fields exist; participant list is minimal                   | Make submitted answers useful in an authorized athlete/registration record            | First                           |
| Search and navigation    | Global search finds pages; athlete directory has no search control | Search athletes and evidence; persistent tryout navigation; saved views               | First                           |
| Event-day operations     | Live screen shows six aggregate counts                             | Actionable coverage board, station rotations, exceptions and freshness                | Next                            |
| Ranking analysis         | Weighted totals, ranges, coverage and filters                      | Cohort benchmarks, disagreement review, meaningful uncertainty and trends             | Next                            |
| Reports                  | Counts and CSV downloads                                           | Individual reports, director packets, visual comparisons and development plans        | Next                            |
| Ongoing scouting         | No dedicated workflow found                                        | Prospect tracking, assignments, observations, watchlists, follow-up                   | Next                            |
| Video evidence           | No scouting video workflow found                                   | Clips linked to athlete, observation, criterion and timestamp                         | Next                            |
| Roster decisions         | Team/position targets and versioned decisions exist                | Scenario comparison, decision rationale, approvals and offer responses                | Next                            |
| Athlete experience       | Public registration and confirmation exist                         | Returning-athlete portal, schedule, corrections, feedback and next steps              | Next                            |
| Communications           | Decision-message entry requires finalized roster                   | Easy operational reminders, reschedules, callbacks and response tracking              | Next                            |
| Integrations             | Live page lists The Squad as disabled demo/mock                    | Documented production data/roster/video interfaces and reconciliation                 | Before pro pilot where required |
| Enterprise operations    | Access/audit foundations and runbooks exist                        | Customer-specific identity, recovery, scale and support evidence                      | Before pro/league sale          |

“First” means the foundation for a credible premium product, not that all other work must wait. Exact estimates require scoped designs and a migration assessment.

## 1. Build an athlete profile that answers scouting questions

### Observed gap

The live athlete detail is effectively an identity card. There is no edit action, sporting background, measurements, evaluation history, registration-answer view, or scouting evidence on that screen. The athlete directory promises registration details and evaluation history but currently displays a table of name, birth date, added date, and profile link.

Guardian records and custom registration answers already exist in storage. This is partly an information-access and presentation gap, not simply missing database fields. Adding more questions will not solve it unless staff can review and use the answers.

### Required profile

- **Overview:** photo where appropriate, preferred name, age as of the event's eligibility date, primary/secondary positions, current club/team, competitive level, dominant hand/foot or shooting side, athlete identifiers, and concise sporting summary.
- **Measurements:** sport-relevant values with units, measurement date, source, and verification state. Keep successive measurements rather than overwriting history.
- **Performance:** combine results, game/scrimmage statistics, trends, and comparable cohort benchmarks.
- **Evaluations:** chronological observations, rubric versions, category results, coverage, and authorized scouting reports.
- **Video:** evidence clips and full-game references, tagged to the skills or claims they support.
- **Participation:** registration answers, tryouts, attendance, team history, callbacks and outcomes.
- **Contacts:** athlete/adult contact, guardian, emergency contact, or representative as appropriate to the participant and the viewer's role.
- **Development:** agreed goals, coach feedback, follow-up dates, and progress evidence.

Provide inline correction with an audit trail, profile completeness prompts, and a clear difference between self-reported and staff-verified information. Support an adult participant without forcing every communication relationship into a guardian model.

Do not expose all profile fields to every evaluator. Blind scoring needs a restricted event identity; an authorized director needs a fuller record. Health-related information should have a separate, narrowly controlled workflow rather than become ordinary scouting notes.

**Acceptance:** a director opens one athlete and can explain their position, relevant history, measured performance, evaluation evidence, and next action without assembling several spreadsheets.

## 2. Make evaluator identity and readiness meaningful

### Observed gap

The live evaluator directory contains a generic display label and assignment count. It has no profile detail or direct management action. The evaluator's own profile contains only display name and current organization; the reviewed account had no display name configured. Invitations and scoped assignments exist on the tryout staff screen, but they do not establish expertise or readiness.

### Required evaluator record

- Name, photo where useful, role, organization/team affiliation, and appropriate contact method.
- Sport, position specialties, level of experience, coaching/scouting background, and relevant qualifications.
- Availability, assigned sessions/stations, workload, and outstanding evaluations.
- Onboarding completion: profile, rubric briefing, practice scoring, assignment acceptance, and device preparation.
- Declared conflicts of interest and recusal, with reassignment and a visible reason to authorized staff.
- Last relevant activity, submitted/reopened evaluations, and actual sync exceptions requiring attention.
- Reviewer feedback on report completeness and evidence quality.

Create a calibration workspace where staff score shared examples, discuss differences, and clarify scoring anchors. Show evaluator disagreement to authorized reviewers, with sufficient shared observations and context. Do not treat agreement with the majority as proof of expertise or silently weight people by an opaque reliability score.

**Acceptance:** before a session, the director can identify who is qualified, available, briefed, assigned, overloaded, or conflicted, and resolve the issue from that view.

## 3. Add real performance statistics

### Observed gap

The live rubric editor supports 1–5 and 1–10 scales. The score-control component explicitly accepts those integer ranges. Weighted ratings are useful, but a rating cannot faithfully store a 3.84-second sprint, an 82 km/h shot, or 7 successful attempts from 10.

### Separate three kinds of data

| Data kind                | Examples                                        | Necessary context                                              |
| ------------------------ | ----------------------------------------------- | -------------------------------------------------------------- |
| Evaluator judgment       | Skating technique, positioning, decision-making | Rubric version, score anchors, evaluator, observation context  |
| Measured performance     | Sprint time, jump height, shot velocity         | Units, protocol, trial number, device/operator, date, validity |
| Game or scrimmage events | Shots, saves, passes, turnovers, faceoffs       | Game/session, opponent or group, minutes/attempts, source      |

Build a metric catalog with integer, decimal, duration, distance, speed, count, and ratio types. Each metric needs directionality (higher or lower is better), units, precision, plausible ranges, repeated trials, and rules for best/mean/latest results. “Not observed,” “did not participate,” “invalid attempt,” and a genuine zero must remain distinct.

Start with a shared platform and deep sport packs. Hockey examples could include skating splits, agility protocol, shot velocity/accuracy, position-specific observations, and goalie save counts with shots faced. Other sports need their own definitions and position templates. These are proposed examples, not standardized league requirements.

Analytics should show distributions, percentiles within an explicitly defined cohort, changes over time, coverage, and meaningful discrepancies. Every percentile must identify its comparison population, date range and sample size. Avoid comparisons across incompatible protocols, ages, positions or rubric versions. A score range and completion percentage are useful evidence, but neither is a statistical confidence interval.

Add CSV imports for measurements and event stats, with preview, unit mapping, source labels, duplicate handling and validation. The current athlete importer maps identity/contact fields; it is not a stats importer.

**Acceptance:** staff record repeated trials, correct an invalid attempt, reload the results, see correctly directed rankings, and trace every chart value back to its source observation.

## 4. Support scouting before and after a tryout

An athlete should be trackable even when they have not registered for the organization's tryout. The current central workflow is registration/session/evaluation; ongoing prospect recruitment needs its own records.

Add:

- Personal and shared watchlists, saved searches, tags, and position-based shortlists.
- A pipeline such as identified → observe → follow-up → invite → evaluate → decision → monitor.
- Scout assignments with event/location, athlete targets, due dates, and coverage responsibility.
- Structured reports: strengths, limitations, role fit, current ability, projected development, evidence and recommended next action.
- Repeated observations across games, camps and seasons; distinguish live from video scouting.
- Follow-up tasks and a record of why an athlete advanced, stayed on a list, or was removed.
- Review and discussion with clear note visibility and approval states.

The existing “needs another look” flag can seed follow-up, but a flag is not an assigned task with a deadline and outcome.

**Acceptance:** a scout observes a non-registered prospect, attaches evidence, requests a second opinion, and the eventual tryout record joins the same athlete history.

## 5. Connect video to the claim being made

Start with video references and timestamped clips rather than attempting to build a full video editor immediately. Link a clip to an athlete, event, criterion, and observation. Support playlists for review meetings, annotations, access controls and recording/usage permissions. Full-game context should remain accessible where licensed.

An observation such as “strong under pressure” should lead to the relevant evidence. Imported provider data should identify its source and coverage. Live data/video integrations depend on actual provider access, licensing, contracts and API capabilities.

**Acceptance:** the director can go from a disputed rating to the supporting clip and corresponding report without manually searching a separate library.

## 6. Turn the live dashboard into an event-day workspace

### Observed gap

The live screen shows registrations, check-ins, active evaluators, completed/expected evaluations and historical sync-exception counts. It does not identify the athletes or evaluators behind the totals. The reviewed component renders a server snapshot; it contains no automatic refresh/subscription mechanism.

Add an athlete × station/evaluator coverage board, with filters for missed observations, outstanding work, late arrivals, no-shows and unresolved sync issues. Show “last updated” and connection state. Counts should open actionable lists.

Provide station plans, rotation groups, venue/resource schedules, staff conflict detection, capacity checks and printable run sheets/bibs. Enable fast in-context reassignment when an evaluator or athlete is absent. Treat event setup, live operation and post-event review as different modes with appropriate default actions.

The existing check-in search found the participant successfully. Extend that foundation into a complete operations flow; do not replace it with another disconnected dashboard.

**Acceptance:** the director can answer “who has not been seen, by whom, and what should happen next?” and act on the answer in the same workspace.

## 7. Improve decisions and reporting

### Rankings and comparisons

Retain weighted scores, completion evidence and ties. Add saved column sets, category/metric sorting, position-specific views, cohort benchmarks, trend charts and an explicit explanation of score composition. Make score cells open their underlying evidence.

Provide authorized evaluator-level review for disagreement and missing evidence while preserving independent live scoring. Shared scouting reports should be distinct from private evaluator scratch notes; expanding review must not automatically publish existing private notes.

### Roster decisions

Existing source supports teams, position targets, callbacks, selected/waitlisted/released statuses, finalization and revisions. Extend this with alternative roster scenarios, side-by-side tradeoffs, role/position balance, decision reasons, review meetings and customer-configurable sign-off. Add invitation/offer acceptance, response deadlines and waitlist promotion where relevant.

Use recorded human decisions. A weighted score can support discussion but cannot stand in for the full selection rationale.

### Reports

The live reports screens are counts and CSV links. Tryout-level reports add evaluations CSV; a finalized-roster CSV becomes available when eligible. The evaluation CSV contract contains state counts and overall score, rather than a complete scouting dossier. Current exports explicitly exclude evaluator identities, private notes and contacts.

Build distinct outputs:

1. **Athlete feedback report:** approved strengths, development areas, explained scores/benchmarks and next steps.
2. **Director decision packet:** comparisons, objective stats, coverage, disagreements, authorized evidence and rationale.
3. **Evaluator coverage report:** assignments, completion, missing evidence and follow-up needs.
4. **Program report:** turnout, attendance, completion, cohort performance and progression over time.

Include branded PDF and spreadsheet exports plus useful on-screen reports. Add asynchronous exports when datasets exceed current 5,000-row/4 MiB limits. Preserve export permissions and immutable decision references.

**Acceptance:** an authorized user produces a readable meeting packet or athlete feedback report without manually rebuilding the information in a spreadsheet.

## 8. Close the participant and communication loop

Public registration and confirmation already exist. Add a returning-athlete/guardian portal for profile reuse, corrections, schedules, check-in instructions, callbacks, approved results and feedback. Use separate account/contact models for adults and guardians.

Operational communication should cover reminders, location/time changes, missing requirements, callbacks and responses. The live message entry was blocked until roster finalization, so a clearly discoverable pre-decision communication workflow is still needed. Source contains reminder infrastructure; this should not be described as a total absence of messaging.

If the target customers charge tryout fees, add event payments, refunds and reconciliation as a separate workflow. The existing billing screen is for the organization's TryoutFlow subscription; it does not establish participant-payment support.

Eligibility setup already includes optional minimum/maximum age. Extend it with explicit cutoff dates, sport/competition rules and documented exceptions. A division name such as “U15” should not be mistaken for a configured eligibility policy.

## 9. Ease of use and visual quality

The current branding, cards and large evaluator controls give a coherent starting point. The information density and task flow need more work than the visual identity.

### Specific observed problems

- **Athlete detail is a dead end:** extensive blank space and almost no scouting information or next action.
- **Evaluator directory is a dead end:** informational cards without direct profile/assignment management.
- **Mobile rankings prioritize filters over athletes:** at 390 px the filter form extends beyond the first screen; the table then requires horizontal scrolling to see scores and coverage.
- **Tablet rankings remain horizontally constrained:** at 768 px the score-range column extends beyond the visible table area.
- **Navigation loses event context:** many workflows route through overview/back/next links instead of a persistent tryout navigation bar.
- **Comparison entry is indirect:** the overview's “Compare athletes” destination initially says comparison is unavailable until athletes are selected in rankings.
- **Search is intentionally narrow:** the top bar finds workspace pages, not athletes, reports or events; the athlete directory has no visible search/filter control.
- **Product copy often explains internals:** phrases such as “current authorized snapshot,” “immutable roster evidence,” provider webhooks and technical audit IDs add reading load to normal tasks.
- **Audit history is hard to interpret:** actors and records are often identifiers rather than understandable names and linked contextual changes.

### Recommended interaction system

- Organization navigation: Dashboard, Tryouts, Athletes, Scouting, Reports, People, Settings.
- Persistent tryout navigation: Overview, Participants, Schedule, Staff, Live, Rankings, Decisions, Messages, Reports.
- A focused evaluator mode: today's assignment, athlete/bib lookup, scoring, pending work and sync status.
- Athlete profile tabs: Overview, Stats, Evaluations, Video, History, Contacts/Documents, Development, with role-appropriate access.
- Search across permitted athletes, bib numbers, events and reports; saved views for frequently used cohorts.
- Mobile ranking cards with athlete, position, score and coverage visible together; move secondary filters into a collapsible panel.
- Desktop tables with configurable columns and side panels for evidence, avoiding repetitive full-page navigation.
- Plain task language, contextual help for advanced scoring, and empty states with the correct direct action.

## 10. Professional-team and league readiness

Before selling the system as professional-grade, establish the buyer's requirements and demonstrate them. Some will be customer-specific rather than universal.

- Team/department/league hierarchy and delegated administration with explicit data-sharing agreements and scopes. Existing tenant isolation must remain intact.
- Enterprise sign-in and account lifecycle requirements, potentially SSO, MFA enforcement and provisioning. These were not found as product workflows in this review.
- Field-level access, report/clip sharing controls, account offboarding and auditable permission changes.
- Documented data ownership, correction/export/retention processes and appropriate handling of athlete/guardian records.
- Backup and restore demonstrations, incident ownership, support escalation, event-day availability and recovery targets.
- Device/offline testing, conflict recovery, realistic concurrent evaluators, larger rosters and long-running imports/exports.
- Documented API/webhook/import contracts and visible reconciliation for external systems.

Repository checklists contain open production-evidence items, including hosted recovery and provider verification. Those documents are not proof that production capabilities are absent today; their current status must be verified independently. No security certification, legal compliance conclusion or performance certification is made here.

## External benchmarks

These are vendor-documented capabilities used to calibrate the proposed product direction, not independently tested performance claims or endorsements.

- [SkillShark FAQ](https://skillshark.com/faq): describes offline mobile evaluation, weighted reporting, player comparisons, individual feedback and progress over multiple events. This shows that reports and development history are established evaluation-product capabilities.
- [Hudl Wyscout Scouting Area](https://www.hudl.com/products/wyscout/scouting-area): combines subjective scouting reports, video clips, performance and career information into searchable recruitment work. This supports the proposed connected athlete/evidence/scouting workflow.
- [Hudl Instat FAQ](https://www.hudl.com/products/instat/faqs): describes pre-tagged video, statistics and tactical analysis for basketball/hockey scouting and professional/college staff. This is a relevant sport-specific reference for linking stats to film.
- [Teamworks Recruiting](https://teamworks.com/recruiting): describes recruiting activity tracking and progression into an athlete profile. This informs the pipeline-to-team handoff, with collegiate compliance features treated as context-specific.

## Recommended build sequence

### Phase 1 — Information foundation

Deliver athlete profiles and authorized registration-answer review, evaluator profiles, entity search, metric definitions/results, and deep templates for the first target sport. Keep identity, measurements, ratings and registration records distinct and connected. Add source/date/version fields from the beginning.

**Exit test:** staff can import an existing cohort, correct records, capture measured results, record qualified evaluator observations, and retrieve all permitted information from one athlete profile after reload.

### Phase 2 — Premium tryout operation

Deliver station/rotation planning, live coverage drill-downs, evaluator preparation and calibration, mobile ranking improvements, richer comparisons and useful director/athlete reports. Add operational communication that is accessible before final decisions.

**Exit test:** a representative multi-session event can run from registration through evidence review and feedback without a parallel tracking spreadsheet. Numeric outputs must reconcile with source records.

### Phase 3 — Scouting and development

Deliver prospect watchlists, scouting assignments/reports, timestamped video evidence, multi-event history, development goals, roster scenarios and response tracking. Validate at least one real external data/roster integration where required.

**Exit test:** a prospect can be followed through multiple observations and a tryout into a documented decision, with evidence and follow-up intact.

### Phase 4 — Professional pilot and enterprise delivery

Run a paid or design-partner pilot with an actual organization. Verify role boundaries, device/offline recovery, concurrency, exports, operational support and buyer-specific identity/integration requirements. Treat league-wide sharing as a separate design and acceptance scope.

**Exit test:** the partner's director, scouts, event staff and operational owner approve their real workflows and recorded acceptance evidence. Avoid claiming pro readiness solely from feature completion.

## Proposed pilot acceptance scenarios

These are proposed targets, not results from this review. Start with a representative cohort such as 120 synthetic athletes, several positions, multiple sessions and 8–12 evaluators; agree actual volumes with the pilot partner.

1. Import athletes with some duplicates, missing data and conflicting source values; resolve them with clear lineage.
2. Assign qualified staff, record a conflict of interest, and replace an unavailable evaluator without losing coverage history.
3. Run check-in and station rotations on phones/tablets; find late arrivals and missed observations quickly.
4. Capture decimal timings and repeated attempts; distinguish invalid results and non-participation from zero.
5. Interrupt connectivity, navigate/reload, reconnect, and verify exactly which drafts are local, saved and conflicted.
6. Compare athletes with uneven evaluation coverage; keep uncertainty visible and explain the calculation.
7. Review a disputed score against its authorized report and clip; preserve independent scoring boundaries.
8. Compare two roster scenarios, record the human rationale, approve the selected version, and retain history.
9. Generate a director packet and athlete feedback; confirm that each audience receives only permitted information.
10. Revisit the athlete at a later event; show valid trends without silently mixing incompatible metrics or rubrics.

## Selected implementation evidence

- [Athlete detail query and screen](</Users/tylerans/Documents/ChatGPT/TryoutFlow/src/app/(app)/app/[organizationSlug]/athletes/[athleteId]/page.tsx:23>) — only identity/date fields are loaded.
- [Evaluator directory](</Users/tylerans/Documents/ChatGPT/TryoutFlow/src/app/(app)/app/[organizationSlug]/evaluators/page.tsx:43>) — name and active-assignment count.
- [Evaluator profile](</Users/tylerans/Documents/ChatGPT/TryoutFlow/src/app/(app)/app/[organizationSlug]/evaluate/profile/page.tsx>) — display name and organization.
- [Rating control](/Users/tylerans/Documents/ChatGPT/TryoutFlow/src/modules/evaluations/ui/score-control.tsx:16) — integer 1–5/1–10 range.
- [Registration form schema](/Users/tylerans/Documents/ChatGPT/TryoutFlow/src/modules/registration/domain/form-schema.ts:3) — custom questions exist, without a typed performance-metric model.
- [Comparison model](/Users/tylerans/Documents/ChatGPT/TryoutFlow/src/modules/rankings/application/compare-athletes.ts) — two-to-four comparisons, categories, sessions and coverage.
- [Score aggregation](/Users/tylerans/Documents/ChatGPT/TryoutFlow/src/modules/scoring/domain/athlete-aggregate.ts) — completed score aggregation and range.
- [Live dashboard](</Users/tylerans/Documents/ChatGPT/TryoutFlow/src/app/(app)/app/[organizationSlug]/tryouts/[tryoutId]/live/page.tsx>) — aggregate snapshot cards.
- [Reports UI](/Users/tylerans/Documents/ChatGPT/TryoutFlow/src/modules/reports/ui/reports-page.tsx) and [evaluation CSV contract](/Users/tylerans/Documents/ChatGPT/TryoutFlow/src/modules/reports/application/export-evaluations-csv.ts) — scope and depth of existing outputs.
- [Roster builder](/Users/tylerans/Documents/ChatGPT/TryoutFlow/src/modules/rosters/ui/roster-builder.tsx) — existing teams, position targets, decisions and revision foundations.
- [Workspace search](/Users/tylerans/Documents/ChatGPT/TryoutFlow/src/components/layout/app-topbar.tsx) — navigation-label search.
- [Operational release checklist](/Users/tylerans/Documents/ChatGPT/TryoutFlow/docs/operations/release-checklist.md) — documented evidence requirements, not current certification.

## Recommended first release

Build **Athlete Profiles + Evaluator Profiles + Performance Stats + Usable Reports**, connected to the existing tryout workflow, with athlete search and mobile evidence review included. This addresses the user's central concern directly and supplies the data foundation for credible scouting, longitudinal analysis and professional pilots.
