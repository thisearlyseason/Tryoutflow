# Approved deepmerge security backport

This contains the small source repair approved by the owner on October 27, 2026. It does not replace or rename a package or claim that the npm registry audit is clean.

`apps/mobile` installs the genuine integrity-pinned deepmerge 4.3.1 archive from npm. Its postinstall hook verifies package identity, the approved lockfile paths and complete original file hashes before blocking dangerous prototype keys in both merge loops. All three shipped JavaScript files are patched deterministically; already-patched bytes are accepted, unknown or partial bytes fail. Original source snapshots and licenses are retained for reproducible negative controls.

The native gate preserves raw registry audit JSON and reports four low findings. The distinct `verified-security-backport` result requires exactly the approved advisory/path/version set, complete registry provenance, all patched-file hashes, real attack regressions and the published React Native CLI configuration consumer. New findings, changed source, skipped install hooks, audit-service errors and malformed audit data fail closed. No previous Expo/node-forge release exception is extended.

Run the focused controls with:

```sh
node --test scripts/tests/native-deepmerge-backport.test.mjs
```

The existing CI additionally checks native types, behavioral tests and both native bundles, plus the shared web release gate. Device/store purchase acceptance remains separate.

The patch rejects `__proto__`, `constructor` and `prototype` in both the target-copy and source-copy loops. This prevents assignments that alter the returned object's prototype, including null-prototype targets, null/primitive placeholders and targets containing an own prototype key. The package identity, version and original npm archive integrity are unchanged. Source snapshots are byte-verified against that archive. `manifest.json` is itself pinned by a hash in the installer/verifier; regenerating it or changing the advisory scope requires a new review.

When an upstream fixed release is available, review its compatibility and registry evidence, update the frozen dependency normally, and remove this backport only after the same gates pass. Rollback of these tooling changes restores the blocked original audit result; it does not change any production entitlement or delivery record.

Sources: [advisory](https://github.com/advisories/GHSA-gcqx-w48m-w2h4), [upstream issue and remediation](https://github.com/TehShrike/deepmerge/issues/273). The snapshots retain the upstream MIT licenses in this directory.
