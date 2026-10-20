# Blind evaluator averages

The evaluator profile keeps peer averages unavailable until the evaluator's own evaluation for the exact organization, event, session, registration and rubric version is completed or locked. Drafts, reopened evaluations, different forms and missing own submissions remain blind. Organization owners and administrators receive no exemption. Existing active membership, evaluator assignment, registration, event lifecycle and current placement checks continue to apply.

The server action reloads session and own evaluation data on each request. The loader rejects non-submitted own summaries before requesting the RPC. Migration `202610180166_blind_athlete_profile_average.sql` also replaces the existing authenticated RPC so a direct call cannot bypass the UI/loader policy. It keeps the signature, restricted grants, aggregate payload and existing peer eligibility logic. No evaluator identities, private notes or individual peer scorecards are added. The average continues to include the caller's eligible submitted scores, matching existing behavior; missing criteria are excluded rather than turned into zero.

The client does not persist averages. It binds each response to its request loader and refresh, ignores interrupted requests, hides results immediately on local reopening or identity changes, conceals them on page restoration/backgrounding, and requests fresh server proof when reopened. The parent evaluation form is keyed by organization/session/registration/rubric. Local completed state enables a request; it does not authorize the returned data. Offline or rejected requests retain the evaluator's own profile.

## Rollout and qualification hold

This is local source preparation only. No SQL was executed. Migration 166 requires existing migrations 042 and 137 and separately approved database rollout. UI changes alone do **not** close the existing direct-RPC access path. Do not claim live blind-average enforcement until migration application and database qualification succeed.

Focused mocked UI/loader tests and SQL structure assertions cover the local behavior. Added pgTAP assertions in `supabase/tests/137_athlete_profile_average.test.sql` cover own draft/reopened/locked and owner-without-submission cases but have **not** run. Existing tenant, rubric, revoked assignment, peer draft, privacy and aggregate-denominator assertions remain. Test database lifecycle, actual authenticated PostgREST calls, concurrent reopening/revocation and browser restoration remain qualification work. Database policy applies to the request's database snapshot; information legitimately viewed before later reopening cannot be recalled from human memory or an already-delivered client.

The radar remains an evaluation summary, not an automatic evaluator-bias correction system. This change does not affect organizer rankings, selection approvals, participant feedback permissions, outbox writes or deleted-data behavior.
