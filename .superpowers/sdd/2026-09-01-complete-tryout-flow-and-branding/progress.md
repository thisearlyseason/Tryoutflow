# SDD ledger — plan: docs/superpowers/plans/2026-09-01-complete-tryout-flow-and-branding.md

Merge base: 059fa76
Spec: docs/superpowers/specs/2026-09-01-complete-tryout-flow-and-branding-design.md

## Preflight interface scan

| Tasks | Producer / consumer | Finding |
| --- | --- | --- |
| 1 → 5 | `FIELD_EXAMPLES` catalog feeds core forms | Consistent; Task 5 must import rather than duplicate strings. |
| 1 → 6 | Shared spacing token feeds journey cards | Consistent; Task 6 uses the shared scale. |
| 2 → 3 | Logo RPCs feed upload application boundary | Consistent after plan self-review: public service-only byte read RPC and authenticated byte-free metadata RPC. |
| 2 → 4 | Byte read + metadata RPCs feed route/navigation | Consistent; no direct client table grants. |
| 3 → 4 | Normalized WebP and digest feed delivery/ETag | Consistent; Task 4 must not accept raw upload metadata. |
| 4 → 7 | Staff/public logo rendering feeds browser acceptance | Consistent; missing image must use the `TF` fallback. |
| 5 → 7 | Examples and field errors feed browser acceptance | Consistent; examples remain placeholders/help only. |
| 6 → 7 | Journey statuses/actions feed full workflow test | Consistent; browser assertions must use authoritative states. |
| 7 → 8 | Focused five-project evidence feeds release report | Consistent; Task 8 reruns rather than relying only on Task 7 output. |
| 1 | Token test, catalog implementation, CSS files | Internally consistent. |
| 2 | pgTAP expectations, migration interfaces, generated types | Internally consistent. |
| 3 | Decoder tests, Sharp implementation, settings UI | Plan omitted direct dependency declaration. Ruling recorded below. |
| 4 | Route tests, byte-only route, staff/public rendering | Internally consistent. |
| 5 | Guidance tests and form changes | Plan names sign-up but organization fields live on `/start`; ruling recorded below. |
| 6 | Projection matrices, bounded queries, actionable UI | Internally consistent; unavailable state remains per-stage. |
| 7 | Real browser journey and fixture cleanup | Internally consistent; downstream specialist state may use authoritative seeded fixtures but navigation remains real. |
| 8 | Full gates, report, review | Internally consistent. |

Ruling: Task 3 may modify `package.json` and `package-lock.json` to add `sharp` as a direct production dependency — direct imports must not rely on Next.js transitive dependencies — if wrong, the cost is a small explicit dependency that duplicates an already installed package.

Ruling: Task 5 must modify `src/app/(auth)/start/page.tsx` in addition to the listed form files because that is the actual organization-creation form — omitting it contradicts the spec's beginning-of-flow guidance — if wrong, the cost is one extra placeholder/help-text edit in an existing core form.

Task 1: complete (commits 059fa76..1e448ba, review clean)

Task 2: Ruling: `read_organization_logo_service(text)` returns `(content bytea, content_type text, byte_length integer, sha256 text, updated_at timestamptz)` and zero rows when absent; `get_organization_logo_metadata(uuid)` returns exactly one authorized `(logo_exists boolean, sha256 text, updated_at timestamptz)` row, using `updated_at` as version — this keeps the later route and navigation contracts minimal — if wrong, the cost is an additive migration to revise RPC result types before Task 4.

Task 2: Ruling: update `supabase/tests/073_final_acl_closure.test.sql` exact authenticated/service RPC allowlists for the four new guarded functions, and run full pgTAP only after `supabase db reset --no-seed` — exact catalog tests must evolve with intentional grants while seeded global counts are not a product regression — if wrong, the cost is an allowlist expectation that would mask one intentionally added RPC grant, still covered by Task 079's exact function-level ACL assertions.

Task 2: Ruling: extend the existing generated-type postprocessor and its RED unit test so missing-logo metadata `sha256` and `updated_at` are `string | null` — generated types must match the approved nullable database result contract consumed by Tasks 3/4 — if wrong, the cost is a narrow postprocessor rule that can be removed after upstream type generation learns OUT-column nullability.

Task 2: complete (commits 1e448ba..01a8bf7, review clean)

Task 3: Ruling: set Next 16 `experimental.serverActions.bodySizeLimit` to `3mb` so the specified 2 MiB raw logo plus multipart overhead reaches the application validator — the action still enforces the exact 2 MiB logo ceiling — if wrong, the cost is a larger global Server Action transport ceiling, while all logo-specific validation remains closed.

Task 3: complete (commits 01a8bf7..1517f24, review clean)

Task 4: Ruling: add narrow migration 100 to extend `public_registration_tryout_v2(text)` with only `organization_name`, `organization_slug`, and `logo_exists` because the existing public projection exposed no organization identity, the authenticated metadata RPC correctly rejects public callers, and the service reader must remain byte-route-only — direct logo-table grants remain absent and the cost is one additive public-projection signature change.

Task 4 review round 1: Important — public route decodes/hash-allocates unbounded malformed bytea before validating real length; Minor — `If-None-Match` handling omits validator lists, weak validators, and `*`. Returned to implementer for TDD remediation and fresh scoped review.

Task 4 review round 2: prior Important closed; Minor — RFC list parsing must ignore reasonable leading, interior, and trailing empty `If-None-Match` members rather than treating them as malformed. Returned for a narrow parser/test correction.

Task 4: complete (commits 1517f24..907a5ef, Important and Minor findings closed; fresh scoped re-review clean)

Task 5 review round 1: Important — retryable freshness-query failures drop bounded unsaved basics values; Important — session datetime guidance hard-codes Edmonton instead of the tryout timezone; Minor — schema-defined date fields lack guaranteed adjacent examples and accessible descriptions. Returned for TDD remediation and fresh scoped review.

Task 5 review round 1 remediation: implemented in `55ff73e501ee22327e55a2b0e602840172453d2b`; all three findings have focused regressions and are awaiting fresh scoped re-review.

Task 5: complete (commits 907a5ef..2412af8, all review findings closed; fresh scoped re-review clean)

Task 6 review round 1: Important — communication row existence falsely equates failed/bounced with queued/complete; Important — participant-count failure promotes a fabricated `Add first participant` action; Important — directors receive unusable audit links; Important — several specialist dependency-error branches hide Back/Next navigation. Returned for TDD remediation and fresh scoped review.

Task 6 review round 2: prior findings closed; Important — staff-registration zero-row/out-of-scope not-found branch now exposes requester-scoped overview/session links. Returned to distinguish link-free non-oracular absence from navigable dependency/contract errors.

Task 6: complete (commits 2412af8..f09c25f, all Important findings closed; fresh scoped re-review clean)

Task 7: Ruling: run focused production-bound browser acceptance on an isolated alternate localhost port while the pre-existing user-visible main-worktree server owns 3112 — behavior/configuration must otherwise remain canonical and Task 8 must still prove the release gate — if wrong, the cost is an extra test-only port override that can be removed once 3112 is free.

Task 7 review round 1: Important — fixture teardown globally deletes unrelated abuse/bot rows; Important — hard-coded September 2026 registration dates expire; Important — authored tryout skips its staff setup stage and later evaluation uses another fixture; Minor — replacement reuses identical bytes and public fallback is not rechecked after removal. Returned for isolated, durable, truly end-to-end TDD remediation and fresh five-project proof.

Task 7: complete (commits f09c25f..2ba38dc, all review findings closed; fresh five-project zero-retry re-review clean)

Task 8: Ruling: stop only the exact pre-existing main-worktree Next server owning 127.0.0.1:3112 after revalidating its PID/cwd/command, so the canonical release gate can own the default port; restore the final merged application afterward — if wrong, the cost is a temporary interruption of the local demo server, with no persisted data deletion.

Task 8: complete (commits 2ba38dc..387a364, independent release-evidence review clean)

Final whole-branch review: Important — authenticated direct logo RPC bypasses Sharp normalization; Important — one completed evaluation falsely completes Run; Important — one arbitrary finalized division roster can complete a multi-division tryout; Important — branded E2E finalizes decisions before evaluation; Minor — logo accessible names repeat adjacent organization text; Minor — settings preview uses an unversioned URL. One final TDD fix wave authorized before scoped re-review.

Final whole-branch fix wave: complete on exact base `387a3646cb6c11e0963ca14e1dc50dd58cad5ecf`. All six findings are closed with additive migration 101, owning focused regressions, full unit/pgTAP/twice-integration/contracts/static/build gates, exact five-project branded acceptance, audit/secret/diff checks, final unseeded reset, and zero-residue proof. Exact evidence and immutable hashes are recorded in `final-fix-report.md`.

Task 7 review round 1 remediation: implemented in `6e53fb39872b4a228f3ea38ac602cc5c800adfae`; exact abuse/bot-key cleanup preserves sentinels, clock-relative timezone bounds persist, the authored tryout owns staffing/evaluation/decision/roster/message/report proof, and distinct replacement/fallback branding is verified; focused Chromium 1/1 and exact five-project matrix 5/5 pass with zero retries/skips on approved alternate 3217. Awaiting fresh scoped re-review; Task 8 must still prove canonical 3112 after PID 54263 is owner-stopped.

Task 6 review round 1 remediation: implemented in `a05db5251ce5f02752d3fba3d3cdff4d51d58bf9`; all four findings have focused regressions and are awaiting fresh scoped re-review.

Task 6: complete (commits c8e8f62..a05db52, round 1 review findings remediated; fresh focused/full/integration/build gates green)

Task 6 review round 2 remediation: implemented in `aa53dd8964f7ab01a6675d11c81a197b64b066b2`; zero-row cross-tenant absence is link-free and non-oracular, while RPC/contract failures retain recovery navigation.

Task 6: complete (commits c8e8f62..aa53dd8, round 1 and round 2 review findings remediated; fresh focused/proportional/build gates green)

Task 8: complete on exact base `2ba38dcf858328ca14416252436c1698aad3c143`; owning release-fixture/baseline corrections committed as `f06bd02944eda8543fc0cf3e3891f165b4cb153b`; canonical automated stages, final 170/170 five-project matrix, focused 5/5 branded journey, audit/secret/diff checks, final unseeded reset, and zero-residue proof are recorded in `report.md`. Main-worktree localhost remains stopped for controller restoration after integration.
