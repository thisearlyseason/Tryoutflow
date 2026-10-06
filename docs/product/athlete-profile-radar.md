# Athlete Profile radar

The evaluation screen derives its profile directly from the current draft, including unsaved edits and restored offline drafts. The existing save, completion, scoring, and ranking contracts are unchanged. There is no chart persistence or new dependency.

- `AthleteRadarChart` accepts ordered criteria, raw scores keyed by category ID, optional comparison scores/names, and either criterion-level scales or a shared scale. It supports 1–5, 1–10, and 0–100, including genuine zeroes. The current evaluation editor/database still supports its existing 1–5 and 1–10 scales.
- Plot radii use score / scale maximum, consistent with existing normalization. Tooltips and the accessible score table show raw values. Missing and invalid observations remain null. A custom Recharts shape omits missing points because the library otherwise plots null radar values at the center. At least three observed values are required per series.
- The panel shows the canonical weighted evaluator total via `calculateEvaluatorTotal`; incomplete totals remain pending. It does not invent an unweighted score or change how incomplete evaluations rank. Invalid recovered data cannot crash the scoring screen.
- Desktop scoring has a sticky profile alongside the form. Mobile profiles start collapsed; completed evaluations expand the profile and include private evaluator notes. Chart tooltips support keyboard navigation, the score table provides equivalent information, and Recharts respects reduced-motion preferences.
- Large forms use numbered axes with full criterion names in the table. Names never identify or join scores.
- The comparison workspace overlays two selected athletes on matching immutable criterion IDs, using its existing normalized ranking averages. Selecting among three or four athletes changes the pair; the existing comparison table remains available.

## Evaluator Average

Apply `202609150137_athlete_profile_average.sql` with the normal release migration process before deploying this feature. The authenticated, read-only RPC returns per-criterion averages/counts and a completed evaluation count. It authorizes the caller's current evaluator assignment and restricts the projection to the athlete registration, session, organization, tryout, and exact rubric version. Completed and locked evaluations from active evaluators in the current enrollment context contribute; drafts, reopened evaluations, revoked assignments, other sessions, and other rubric versions do not. Each criterion uses its own observed-score denominator.

The RPC exposes no peer identities, private notes, or individual evaluation records and does not broaden table access. Historical own evaluations can request their original version. Averages load when selected and refresh on submission or explicit refresh; they are not polled or cached as chart data. Offline/error states preserve My Evaluation.

## Verification

See [the functional and design verification report](athlete-profile-verification-2026-09-15.md) for current local test results and screenshots.

- Focused component/domain tests cover dynamic IDs, mixed scales, zero vs missing, fractional values, comparison isolation, unsaved changes, canonical totals, completion notes, average refresh, and failure recovery.
- `supabase/tests/137_athlete_profile_average.test.sql` covers numeric averages, missing denominators, completed states, rubric isolation, caller scope, revocation, and private-record access. Can be replayed with the additive migration in a transaction and rolled back.
- `tests/fixtures/evaluation/app/radar/page.tsx` provides six-criterion live scoring, completed results, a deterministic average, and missing-value comparison for browser QA. It is a test fixture, not a production route.
