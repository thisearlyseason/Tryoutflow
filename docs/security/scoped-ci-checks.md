# Scoped CI checks (local candidate)

This policy selects validation work; it does not authorize publication or replace release receipts.
The existing `CI / verify` job ID/name is retained as the final, always-running required status.
Actual hosted required-check settings have not been inspected or changed.

## Selection

- Website presentation and assets select the existing complete website readiness gate: frozen dependencies, zero-finding full/production audit, formatting, lint/parity, types, database/contract/unit tests, build, visual/browser tests and cleanup. The hosted native workspace bridge regression also runs.
- `apps/mobile/**` selects native security/source-binding checks, types, behavioral tests and iOS/Android JavaScript bundle compilation with frozen dependencies. Both `.test.ts` and `.test.tsx` files are included. This is not a signed device binary build, store submission, purchase or physical-device acceptance. Those remain additional app-release requirements.
- Shared/unknown paths select both. This includes root dependencies/tooling, CI, security policy, backend migrations, API/native routes, infrastructure and contract/type definitions. Native WebView contracts are not treated as presentation-only changes.
- Only recognized Markdown documentation outside security policy can select neither scope. Such a result is explicitly recorded as `docs-only`, not runtime release qualification.

Push classification requires a branch ref and a valid ancestor base. PRs compare the supplied base with the exact checked-out merge commit. The NUL-delimited diff includes old and new rename/copy paths and deleted paths. Type changes, malformed/truncated diffs, unknown statuses, empty diffs, absent history, force pushes without an ancestor, tag pushes and manual runs select both. No manual scope override is offered.

## Required status

`verify` runs with `always()` and checks the successful classifier receipt against the exact workflow SHA. Every selected job must have result `success`; skipped, cancelled, failed, missing or unknown selected outcomes fail. An excluded job may only be skipped or successful. A failed excluded job is not concealed. Missing outputs or an unexplained empty scope fail.

There are no workflow path filters, `continue-on-error` steps, advisory waivers or branch-protection changes. Before publication, inspect the real hosted required-check configuration and confirm the retained `verify` identity. A skipped optional job must never become the release authority itself.

## Current limitation

This candidate changes root dependencies, CI and security policy, so it selects **both** scopes. The native advisory-exception binding and pins remain unchanged. The unresolved native findings still fail that exact-release policy. A complete zero-finding audit may pass without an advisory exception; malformed or nonzero reports cannot use that clean path. The CI split does not grant an exception for its own introduction or qualify this combined candidate for release.

A future website-only change can omit native package auditing only when the classifier proves its scope. The native audit still blocks any selected native/shared scope and any native release. Existing exact-source audit exceptions have not been regenerated or extended.

A zero native audit also requires registry-source coverage of the frozen lock: local/workspace links, Git or unrecognized sources, bundled code and entries lacking version/integrity cannot be called audited-clean. npm may omit file-linked packages even when they contain known vulnerabilities. This is not a replacement for frozen installation and lock/manifest consistency checks.
