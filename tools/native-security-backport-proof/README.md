# Native dependency repair proof — not a release candidate

This isolated investigation contains genuine source backports and their negative controls. It does not modify the application's native dependencies, install a new Expo fork, waive an advisory, or qualify a deployment. Original package names and versions remain unchanged. The currently applicable native audit remains blocking.

## What was actually attempted

1. **Official upgrades:** inspected SDK 57, latest SDK 58, `next` and `canary` registry tags. All published CLI choices retain Zod 3 and node-forge. Upgrading or downgrading between those choices does not resolve both roots.
2. **API-preserving source backport:** added strict nested RSA DigestAlgorithm validation to node-forge 1.4.0, including optional NULL structure/value checks. Added early upper-bound rejection to Zod 3.25.76 arrays and sets in CJS, ESM and TypeScript source. Patches are explicit files, guarded by complete original-source hashes; no fabricated package version is used.
3. **Actual consumer regressions:** execute integrity-verified published Expo plugin/MCP schema and certificate-library functions against original and patched sources. Valid signatures, CSR/certificate/PEM roundtrips and synchronous calling contracts remain valid in the tested cases. Oversized invalid collection diagnostics intentionally change by aborting earlier.
4. **Replacement libraries:** inspected official `@peculiar/x509` 2.2.0 and PKIJS 4.0.0 declarations. They do not depend directly on forge, but certificate/CSR generation and signing return Promises. Expo exposes synchronous Forge PKI objects and methods. A dependency substitution alone would break callers. A maintained adapter, call-site changes and cache/chain/project-scope verification would be material build-toolchain work.
5. **Audit-provenance control:** metadata-only npm fixtures reported zero findings for BOTH the original vulnerable file-linked packages and patched packages. This is an audit-coverage gap, not proof of a repair. The verifier now rejects linked, local/Git, bundled, unrecognized or integrity-unpinned native dependencies before accepting a zero report. Frozen `npm ci` and manifest/lock consistency remain required.

## Remaining failure, deliberately reproduced

The source backport is **partial**, not complete native remediation. Actual Expo schemas have unbounded command, parameter, environment and output arrays. Four tests demonstrate that these still produce 64 validation issues for 64 invalid elements after the bounded-array backport. No arbitrary limits were invented to make those tests disappear.

Complete repair needs a reviewed resource budget at those real boundaries, or a compatible upstream parser/CLI change. Adopting a privately maintained CLI/PKI fork also requires a reproducible integration and coverage policy; a file-link zero audit cannot be accepted. Neither path has been silently integrated or approved for publication.

The Forge regressions demonstrate malformed digest-structure acceptance and patched rejection using only synthetic in-memory test material. They are not an end-to-end keyless, low-exponent forgery proof. Positive/negative tests are bounded compatibility evidence, not proof of every certificate format or native build/device behavior.

## Reproduce in a fresh isolated checkout

From the repository root, using the pinned Node version:

```sh
python3 tools/native-security-backport-proof/fetch-fixtures.py
node tools/native-security-backport-proof/prepare-proof.mjs evidence/package-fixtures evidence/patched-fixtures
node --test tools/native-security-backport-proof/security-regressions.test.mjs
```

Fetching validates official registry SHA-512 archives before extraction; preparation validates complete original source trees and refuses existing destinations. Tests make no network calls and persist no generated key material. Fixture sources and outputs belong under disposable local `evidence/`, not an application distribution.

The original MIT licenses are retained in `licenses/`. Sources: [node-forge advisory](https://github.com/advisories/GHSA-86w9-cpqp-85rv), [Zod advisory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5), and [upstream Zod v4 size-check fix](https://github.com/colinhacks/zod/commit/a0ebf97).
