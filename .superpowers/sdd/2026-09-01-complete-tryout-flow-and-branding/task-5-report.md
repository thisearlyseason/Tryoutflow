# Task 5 report: core workflow guidance and field validation

## Commit

- Exact base: `907a5ef24810938b956fd4cccb53805a9cad74f6`
- Implementation commit: `2e9299630bc375df4808a7da69ac647b177381e5`
- Implementation range: `907a5ef24810938b956fd4cccb53805a9cad74f6..2e9299630bc375df4808a7da69ac647b177381e5`

## Implementation

- Imported the frozen `FIELD_EXAMPLES` catalog throughout the named core forms, including the approved `/start` organization-creation ruling. Examples are placeholders or adjacent help only; saved organization/tryout values remain `defaultValue`s, and the prior sample timezone default on `/start` is now an empty required control with example help.
- Added truthful disabled instructional options to required empty division, session, and schema-defined selects while preserving optional and already-selected controls.
- Added stable date/timezone help IDs across draft creation, guided setup, staff registration, and public registration. Guided basics errors have stable IDs, `aria-describedby`, and `aria-invalid` associations.
- Added `validateTryoutBasics`, which returns the approved discriminated result and assigns required, length, IANA timezone, local datetime, and closing-range failures to their owning fields.
- Integrated validation inside `persistWizardStep` before either persistence dependency. Invalid input returns exact field errors and bounded entered values without calling configuration or progress gateways.
- Converted the guided setup form to the Next 16 `useActionState` signature. Field failures and bounded values return in action state without URL echo; unassignable load/configuration/progress failures render the fixed form-level `Could not save this step` message.
- Updated the browser wizard fixture for the action-state contract without changing its behavior.

## TDD evidence

### Baseline

- `corepack npm exec -- vitest run --config vitest.config.ts tests/unit/tryouts tests/unit/registration tests/unit/organizations tests/unit/communications tests/unit/checkin --maxWorkers=2`
  - 40 files passed, 235 tests passed.

### RED

- Added `tests/unit/forms/core-workflow-guidance.test.tsx`, `tests/unit/tryouts/validate-tryout-basics.test.ts`, and focused owning-test assertions before production changes.
- Ran the exact Task 5 command:
  - Exit 1: 4 files failed and 38 passed; 6 tests failed and 234 passed.
  - Failures were the intended missing behavior: the validator module did not exist, persistence reached an undefined gateway result instead of returning field errors, the wizard did not consume action state, and all four guidance groups lacked their catalog-backed placeholders/help/options.

### GREEN

- Exact Task 5 command:
  - 42 files passed, 245 tests passed.
- Full unit suite:
  - 107 files passed, 1,189 tests passed.
- The action-state test submits a bounded inverted closing time, observes the returned field messages, verifies stable IDs and `aria-invalid`/`aria-describedby`, and confirms the entered value remains visible.
- The rendered guidance suite constructs `FormData` from empty forms and confirms placeholder examples are not submitted values.

## Verification

- `corepack npm run format:check`: passed.
- `corepack npm run lint`: passed with no diagnostics.
- `corepack npm run typecheck -- --incremental false`: passed with no diagnostics.
- `git diff --check`: passed before commit.
- Initial `corepack npm run build`: compiled and typechecked, then failed page-data collection because the worktree intentionally has no `.env.local` and `NEXT_PUBLIC_APP_URL` was absent.
- Production build rerun with documented synthetic public app/Supabase values: passed; all 36 static pages generated and the guided setup, staff registration, public registration, organization start, and draft creation routes were present.

## Files

Created:

- `src/modules/tryouts/application/validate-tryout-basics.ts`
- `tests/unit/forms/core-workflow-guidance.test.tsx`
- `tests/unit/tryouts/validate-tryout-basics.test.ts`

Modified:

- `src/app/(auth)/sign-up/page.tsx`
- `src/app/(auth)/start/page.tsx`
- `src/app/(app)/app/[organizationSlug]/tryouts/new/page.tsx`
- `src/app/(app)/app/[organizationSlug]/tryouts/[tryoutId]/setup/[step]/page.tsx`
- `src/app/(app)/app/[organizationSlug]/tryouts/[tryoutId]/registration/page.tsx`
- `src/app/(registration)/register/[tryoutSlug]/registration-form.tsx`
- `src/modules/tryouts/application/persist-wizard-step.ts`
- `src/modules/tryouts/ui/tryout-wizard.tsx`
- `src/modules/organizations/components/invite-member-form.tsx`
- `src/modules/communications/ui/message-composer.tsx`
- `src/modules/checkin/ui/checkin-workspace.tsx`
- `tests/fixtures/wizard/app/[step]/page.tsx`
- `tests/unit/tryouts/persist-wizard-step.test.ts`
- `tests/unit/tryouts/tryout-wizard.test.tsx`

## Concerns

- The build requires deployment-owned public environment values even for static marketing metadata. The first environment-free failure was configuration-only; the same tree passed with non-secret synthetic values.
- The full unit run emitted the existing privacy-safe `integration_unavailable` observability lines for recovery/verification negative-path tests; the suite still completed with zero failures.
- No subagent or reviewer was spawned because the controller explicitly prohibited delegation and reviewers. A local requirement, accessibility, mutation, and diff self-review found no remaining Task 5 gap.
