# TryoutFlow free encrypted backups

## Status — September 21, 2026

Supabase remains on Free. No paid service or plan upgrade was enabled.
The private destination is `thisearlyseason/tryoutflow-backups`. The public app
repository must never contain dumps, credentials, or recovery keys.

The backup runner and encryption are prepared. Four synthetic safety tests passed,
including encryption/decryption, private destination enforcement, secret-safe errors,
and preserving an encrypted copy after upload failure. **Production capture, a
production-data restore drill, and daily scheduling are NOT active or verified.**
Activation is blocked by the existing database password.

## Private setup

Edit only the password placeholder in:
`/Users/tylerans/.config/tryoutflow-backups/source.json`

Keep this file owner-readable only (0600), outside Git. Do not send the password in
chat. No production password reset is required by this workflow.

The recovery key is:
`/Users/tylerans/.config/tryoutflow-backups/recovery.agekey`

Save a separate private recovery copy in your password manager before relying on
these backups. Losing the key makes encrypted backups unrecoverable. Never commit
or upload it alongside backups. The runner uses only `recipient.txt`, its public key.

## Capture and upload

Run `python3 scripts/backups/backup.py` from the app checkout, or use the reviewed
copy in `/Users/tylerans/.local/share/tryoutflow-backups/runner/scripts/backups/backup.py`.
`--local-only` captures and encrypts without uploading. Required tools: Python 3,
PostgreSQL 18 clients, age, authenticated GitHub CLI. No GitHub Actions workflow is
installed and no hosted-runner minutes are consumed.

The runner takes a read-only database snapshot over certificate-verified TLS,
records row counts, RLS flags, owners, table grants, policies and migration version,
and dumps public/private/auth/storage/supabase_migrations/extensions schemas.
Role definitions exclude passwords and are collected separately from the snapshot.
It encrypts the dump, roles and manifest before creating a private GitHub release,
then downloads the uploaded asset and checks its SHA256. Plaintext temporary files
are removed on normal completion or handled failure; abrupt process/machine failure
can leave temporary files in the owner-only state directory and requires cleanup.
Encrypted copies survive upload failures. Status files contain no database rows.

State and encrypted archives live under:
`/Users/tylerans/.local/share/tryoutflow-backups/`

The runner fails closed if Storage contains any objects: database dumps do not
include file bytes. Add object backup and restore coverage before proceeding then.
Vault keys, provider secrets/configuration, role passwords and realtime publications
are excluded. A logical dump is not a complete infrastructure recovery package.

## Activation and restore gates

1. Enter the existing password privately, then complete a capture/upload/download
   verification. Resolve any managed-schema dump permissions without broadening
   production grants merely to make the backup succeed.
2. Restore into a disposable local Supabase-compatible environment with outbound
   networking disabled. Never restore into production. Verify decryption, manifest
   hashes, roles/schema/data/migration history and fail on unexpected SQL errors.
3. Compare row counts, constraints/indexes, owners/grants, RLS flags and policies.
   Run unauthorized and cross-organization denial checks plus authorized reads.
   Record timing and any platform-specific restore adjustments. Encryption tests
   alone are not a database restore test.
4. After that passes, activate a daily local Codex schedule with failure/overdue
   notifications. The Mac must be available; local scheduling does not provide an
   always-on service. Target 24-hour recovery points when the Mac is available.
5. Configure 30-day retention only after verified recoverable backups exist. No
   automatic deletion is currently implemented; preserve copies until the first
   restore succeeds. Monitor local space and GitHub storage limits.

No recurring task has been enabled while the password and restore gate are pending.
No application redeploy is needed for this separate backup runner.

## References

- [Supabase database backup coverage](https://supabase.com/docs/guides/platform/backups)
- [Supabase backup and restore guidance](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)
