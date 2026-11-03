# Discovery publication status — 2026-11-03

## Website

SEO/GEO changes are committed on `codex/discovery-20261103`, based on the actual live source `3053cdd18487feabc508a48a806e596420b9cd6e`, rather than the older original chat checkout. The existing native bridge, navigation prefetch controls and performance changes are preserved. No production deployment or promotion occurred. Live deployment remains `dpl_DBhoLD2XXhNa293v527DgwBMLxAf`.

The production build, mocked authenticated marketing navigation gate and typecheck passed. Local unit run: 2001 passed; 15 operation fixtures failed because they hardcode `/usr/bin/git`, which is blocked by the machine's unaccepted Xcode license. No license was accepted.

CI run https://github.com/thisearlyseason/Tryoutflow/actions/runs/41691056370 failed at dependency audit before application tests. Fresh audits identify minimatch GHSA-g3hv-75wg-m249 in the existing ESLint 9 tree. An ESLint 10.14.0/minimatch 11.0.1 trial cleared the audit but failed with Next 16.4.1's bundled parser (`scopeManager.addGlobals is not a function`). That trial was completely reverted. The release gate and existing integrity records remain unchanged. A supported parser/linter remediation is required before publishing; do not force the major-version override or bypass the audit.

The independently patchable native Joi advisory GHSA-4528-x5fx-h6hg is fixed in the lockfile (17.13.8 to 17.13.9). The native audit then passes its existing verified deepmerge-backport policy, with four low registry findings still explicitly reported. Restored lint parity plus native audit/backport tests: 256 passed. This is not native device or binary release validation.

Local provider catalog caches are excluded from Vercel upload. No credentials or permission changes were made.

## Saved store drafts

Apple: app 6812832082, en-US. Saved and independently read back title, subtitle, description, keywords, promotional text, marketing URL and privacy URL. Selected Sports as primary category. The title is `TryoutFlow: Tryout Manager`; subtitle is `Athlete scoring & team rosters`. Privacy URL is https://www.tryout.agency/privacy. Marketing URL is the planned https://www.tryout.agency/platforms route, which must be deployed before submission.

Apple remains PREPARE_FOR_SUBMISSION with old version 1.0.0 build 11 selected. That build's notes describe a companion-only product. The new workspace copy must not be submitted with that old binary. Supply and verify the matching workspace binary and genuine native screenshots first. No review submission or public release occurred.

Google Play: package agency.tryout.mobile, en-US. Saved as draft and reloaded to verify title, 79-character short description and 1595-character full description. Phone screenshots are still missing. Closed testing, store declarations and production eligibility remain outstanding. No review submission or public release occurred.

Existing store artwork was inspected and contains web preview inserts, so it was not uploaded as native screenshots. Screenshot requirements are recorded in SCREENSHOTS.md. Save receipts and sanitized Apple API readback are retained in the original checkout's docs/discovery-20261103 and work/discovery-20261103 directories.

## Next release steps

1. Resolve the minimatch advisory with a compatible, tested linter/parser dependency combination or upstream patch; preserve all existing audit gates.
2. Rerun exact-source CI, build a production candidate without domain promotion, verify public metadata/private noindex and then promote and verify the live domain.
3. Verify current native workspace binaries, capture genuine screenshots, complete store prerequisites and ensure metadata matches the selected build before submission.

Sources: https://github.com/advisories/GHSA-g3hv-75wg-m249 ; https://github.com/advisories/GHSA-4528-x5fx-h6hg ; https://eslint.org/docs/latest/use/migrate-to-10.0.0
