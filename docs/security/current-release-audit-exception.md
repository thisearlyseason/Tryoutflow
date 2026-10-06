# Current release dependency exception

Owner approval: 2026-10-06 13:31:03 UTC, directly answering the specific development-only lint advisory exception question.

Only GHSA-vfj7-8cjw-p6xm and its five pinned Next ESLint dependency paths are accepted for the exact source manifest in current-release-audit-binding.json. Full raw audit evidence remains in .next/release-audit. Production dependencies must report zero findings. The validator rejects new findings, versions, nodes, advisory ranges, source additions and source edits. This is an accepted known vulnerability, not an audit-clean result.

The reviewed production-only audit has zero advisories;120 server traces have no affected lint dependency. The reachable pattern input is repository-owned ESLint rootDir configuration, not a reviewed HTTP input. Untrusted repository changes remain a build-tool threat. Native dependency auditing, lint, types, tests, DB/provider/browser gates, builds and secret/state checks remain required.

This record must not be regenerated to authorize future changes. After this exact release, remove this record and restore the ordinary npm audit commands unless the owner separately approves a new documented policy. No global ignore or environment bypass is supported. Source drift fails closed.
