# Task 1 report: spacing token and field example catalog

## Implementation

- Added `--space-5: 1.25rem;` between `--space-4` and `--space-6` in `src/app/theme.css`.
- Added frozen, `as const` `FIELD_EXAMPLES` in `src/components/forms/field-examples.ts` with the exact fictional values from the task brief.
- Added the required token and core-journey catalog contract tests in `tests/unit/forms/field-examples.test.ts`.
- Reviewed the existing `.tryout-card` implementation: its desktop padding/gap and narrow-screen padding/gap already use shared spacing tokens, so no JSX numeric padding or redundant CSS change was necessary. The restored token makes its desktop computed padding valid.

## Commands and results

- `corepack npm exec -- vitest run --config vitest.config.ts tests/unit/forms/field-examples.test.ts tests/unit/tryouts/tryout-card.test.tsx` (RED): failed during module resolution because `src/components/forms/field-examples.ts` did not exist; the existing tryout-card suite was 2/2 passing.
- `corepack npm exec -- vitest run --config vitest.config.ts tests/unit/forms/field-examples.test.ts tests/unit/tryouts/tryout-card.test.tsx` (GREEN): 2 test files passed, 4 tests passed.
- `corepack npm exec -- prettier --check src/app/theme.css src/components/forms/field-examples.ts tests/unit/forms/field-examples.test.ts tests/unit/tryouts/tryout-card.test.tsx src/app/globals.css src/modules/tryouts/ui/tryout-card.tsx`: passed; all files formatted.
- `corepack npm exec -- tsc --noEmit`: passed with no diagnostics.
- `corepack npm exec -- eslint src/components/forms/field-examples.ts tests/unit/forms/field-examples.test.ts src/app/theme.css`: 0 errors; ESLint reported only that CSS is ignored by configuration.

## TDD evidence

The contract test was written first and the focused command was run before production implementation. It failed for the expected missing-module condition. After adding only the catalog and spacing token, the exact same command passed.

## Self-review

- Catalog keys and values match the brief exactly, including contact examples and comma-separated defaults.
- The catalog is shallow-frozen and has a readonly literal type.
- The spacing scale remains monotonic and all existing tryout-card spacing declarations remain token-based.
- No business logic, submitted form values, Next.js APIs, or existing tryout-card actions changed.

## Concerns

- The full repository unit suite was not used as the acceptance gate for this isolated slice because unrelated integration/fixture activity in the shared environment can keep that suite running; focused tests, formatting, lint, and typecheck passed.
