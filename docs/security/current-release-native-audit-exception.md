# Current release native tooling exception

The owner explicitly approved this narrowly scoped exception on October 6, 2026 at
15:10:58 UTC after disclosure of the residual build-tool risks. This is separate
from the existing five-node web development lint exception; its scope is unchanged.

Only GHSA-vfj7-8cjw-p6xm (braces) and GHSA-86w9-cpqp-85rv (node-forge), including
their 17 inherited package findings, are accepted. Exact package paths, versions,
finding ranges, advisory identifiers and dependency chains are recorded in
`current-release-native-audit-pins.json`. The checker rejects missing or additional
findings, changed versions/paths/advisories/severity/counts, failed or malformed
audits, and any release-source drift. Automatic future regeneration is forbidden.
The shared release binding covers this implementation, pins, workflow and lockfiles.

The critical shell-quote advisory GHSA-pqg4-j6r4-53mv is **not accepted**. The native
lockfile updates only its transitive package record from 1.10.0 to supported 1.12.0
(the advisory identifies 1.11.0 as the first fixed release). The separately discovered
production sharp advisory GHSA-wq5f-xc86-pv6w is also not accepted: sharp and its
platform/libvips records are updated from 0.35.4 to supported 0.35.5, which ships
librsvg 2.63.2. The production web audit must still report zero findings. Synthetic regression
checks reject the four line-terminator injection inputs without executing a shell.

## Evidence and limits

An isolated unsigned candidate copied the reviewed application source and installed
492 exact-lock dependencies with no external dependency symlinks. Existing explicit
QA public configuration was used; no private credentials or provider changes were
required. Two exports per platform produced identical bundles and source maps.
The matched iOS (687 modules) and Android (685 modules) graphs exclude node-forge,
braces, micromatch, certificate-signing and Metro tooling. The included Expo CLI
module is its runtime loader `metro-require/require.js`, not signing code.

Evidence is retained outside the release source in the task-owned
`next-native-runtime-candidate` directory. It applies only to those unsigned
candidate bundles. It does not prove exclusion from old signed iOS15. A future
signed package must match its corresponding candidate bundle or have its own
matched native-build graph before runtime exclusion is claimed. Changes to public
configuration or lockfiles require fresh applicable candidate evidence.

## Residual risk and preserved gates

Expo certificate tooling calls Forge `certificate.verify()` and
`certificate.publicKey.verify()`; malicious certificate/signature input can reach
the affected verification code. iOS CLI certificate parsing alone is not that
verification operation. Metro file-map glob handling calls `micromatch.some()`;
malicious repository-configured nested patterns can reach braces expansion.
Use only the already authorized signing inputs and reviewed repository configuration.
No signing credentials or security settings were changed. No supported published
fix was available for the two accepted roots at the reviewed checkpoint; an
unmerged crypto patch and framework downgrades were not adopted.

The audit prints the accepted high findings prominently. This is not an audit-clean,
native-payment, signing, authentication, device, screenshot or store-readiness
result. All other checks, production web audit, access controls, purchase gates,
manual release and store acceptance requirements remain in effect.
