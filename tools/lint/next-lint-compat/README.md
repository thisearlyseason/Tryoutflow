# Private Next lint compatibility package

Development-only package for the preserved Next16.3.8 rule set with Next16.4.1/ESLint9.39.5 checks. All22 official Next rule implementations, utility semantics and severity settings are preserved. The parser wrapper delegates to the pinned Next16.4.1 Babel parser.

The directory walker preserves fast-glob3.3.1 source and Picomatch2.3.2 matching. Its three pattern APIs use a private local copy of braces3.0.3 with an actual recursion-bound patch for GHSA-vfj7-8cjw-p6xm / CVE-2026-93687. Parser stack pushes and AST traversal reject more than128 AST levels; iterative validation also rejects cyclic parent/child graphs, invalid child collections and excessive AST size. Existing10000-character and1000-range limits remain. Exceeding a bound fails lint explicitly; roots are never truncated or silently skipped. This is not an upstream patched release, an audit exception, or a claim to eliminate every possible resource-exhaustion input.

PROVENANCE.json records official registry tarballs, verified integrity and upstream source hashes. NEXT/fast-glob/braces licenses are retained. INTEGRITY.json freezes every reviewed package source file. The release dependency audit validates this source record and requires zero registry findings in both full and production audits.

Maintenance: review this private patch and run all lint parity/security tests on any upgrade. Prefer an official compatible upstream fix when available. Do not regenerate integrity merely to accept unknown source changes.
