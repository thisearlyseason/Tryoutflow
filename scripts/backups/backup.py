#!/usr/bin/env python3
"""Read-only, consistent database backup; age encryption before private GitHub upload.

No secrets, database rows, or command stderr are printed. See backups.md for scope.
"""
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tarfile
import tempfile
import uuid

PROJECT = "zqfakeigephjifzxcucr"
SCHEMAS = ("public", "private", "auth", "storage", "supabase_migrations", "extensions")
CONFIG = Path.home() / ".config/tryoutflow-backups"
STATE = Path.home() / ".local/share/tryoutflow-backups"


class BackupError(Exception):
    pass


def run(args, *, env=None, input=None, timeout=300):
    result = subprocess.run(args, input=input, env=env, capture_output=True,
                            text=True, timeout=timeout)
    if result.returncode:
        raise BackupError(f"{Path(args[0]).name} failed (exit {result.returncode}); no backup confirmed")
    return result.stdout


def private_file(path):
    if path.is_symlink() or not path.is_file() or path.stat().st_mode & 0o077:
        raise BackupError(f"Owner-only regular file required: {path.name}")


def load_config(path):
    private_file(path)
    c = json.loads(path.read_text())
    if (c.get("project_ref") != PROJECT or c.get("user") != f"postgres.{PROJECT}"
            or c.get("host") != "aws-0-us-east-1.pooler.supabase.com"
            or c.get("database") != "postgres" or c.get("port") != 5432
            or c.get("repository") != "thisearlyseason/tryoutflow-backups"):
        raise BackupError("Configuration does not match the authorized production backup target")
    if not c.get("password") or c["password"] == "ENTER_EXISTING_DATABASE_PASSWORD_HERE":
        raise BackupError("Existing production database password is required in source.json")
    return c


def sql_literal(value):
    return "'" + value.replace("'", "''") + "'"


def sql_identifier(value):
    return '"' + value.replace('"', '""') + '"'


def verify_repository(repository):
    info = json.loads(run(["gh", "api", f"repos/{repository}"]))
    if info.get("private") is not True or info.get("full_name") != repository:
        raise BackupError("Backup destination must be the expected PRIVATE repository")


def capture_database(c, directory):
    env = os.environ | {
        "PGHOST": c["host"], "PGPORT": str(c["port"]), "PGUSER": c["user"],
        "PGDATABASE": c["database"], "PGPASSWORD": c["password"],
        "PGSSLMODE": "verify-full", "PGSSLROOTCERT": "system", "PGCONNECT_TIMEOUT": "15",
        "PGOPTIONS": "-c default_transaction_read_only=on -c statement_timeout=300000",
    }
    binaries = Path(c["pg_bin"])
    if not (binaries / "pg_dump").is_file():
        raise BackupError("Configured PostgreSQL client is unavailable")
    # Hold one read-only snapshot open for dump and verification counts.
    with (directory / "connection-errors.txt").open("w") as errors:
        session = subprocess.Popen([str(binaries / "psql"), "-X", "-qAt", "-v", "ON_ERROR_STOP=1"],
                                   env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                   stderr=errors, text=True, bufsize=1)
        def query(sql):
            session.stdin.write(sql + "\n")
            session.stdin.flush()
            value = session.stdout.readline().strip()
            if not value:
                raise BackupError("Database snapshot query failed; details are not logged")
            return value
        try:
            snapshot = query("begin isolation level repeatable read read only; select pg_export_snapshot();")
            if not re.fullmatch(r"[0-9A-Fa-f]+-[0-9A-Fa-f]+-[0-9]+", snapshot):
                raise BackupError("Unexpected database snapshot identity")
            version = query("select current_setting('server_version_num');")
            storage_count = int(query("select count(*) from storage.objects;"))
            if storage_count:
                raise BackupError("Storage contains files: object backup must be configured before a complete backup can succeed")
            scope = ",".join(sql_literal(s) for s in SCHEMAS)
            tables = json.loads(query("select coalesce(json_agg(json_build_object(" +
                "'schema',n.nspname,'table',c.relname,'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity," +
                "'owner',pg_get_userbyid(c.relowner),'acl',c.relacl::text) order by n.nspname,c.relname),'[]') " +
                "from pg_class c join pg_namespace n on n.oid=c.relnamespace " +
                f"where n.nspname in ({scope}) and c.relkind in ('r','p');"))
            for table in tables:
                name = sql_identifier(table["schema"]) + "." + sql_identifier(table["table"])
                table["rows"] = int(query(f"select count(*) from {name};"))
            policies = json.loads(query("select coalesce(json_agg(row_to_json(p) order by schemaname,tablename,policyname),'[]') from pg_policies p " +
                                       f"where schemaname in ({scope});"))
            migration = query("select coalesce(max(version),'none') from supabase_migrations.schema_migrations;")
            args = [str(binaries / "pg_dump"), "--format=custom", "--lock-wait-timeout=15000",
                    f"--snapshot={snapshot}", "--no-publications", "--no-subscriptions",
                    f"--file={directory / 'database.dump'}"]
            args += [f"--schema={s}" for s in SCHEMAS]
            run(args, env=env, timeout=600)
            run([str(binaries / "pg_dumpall"), "--roles-only", "--no-role-passwords",
                 f"--file={directory / 'roles.sql'}"], env=env)
            manifest = {"format": 1, "project_ref": PROJECT, "created_at": dt.datetime.now(dt.timezone.utc).isoformat(),
                        "server_version_num": version, "latest_migration": migration,
                        "snapshot": snapshot, "storage_objects": 0, "schemas": SCHEMAS,
                        "tables": tables, "policies": policies,
                        "excluded": ["Storage file bytes (verified empty)", "Vault encryption root keys",
                                     "provider configuration and secrets", "role passwords", "realtime publications/subscriptions"]}
            for name in ("database.dump", "roles.sql"):
                manifest.setdefault("sha256", {})[name] = hashlib.sha256((directory / name).read_bytes()).hexdigest()
            (directory / "manifest.json").write_text(json.dumps(manifest, indent=2))
            return manifest
        finally:
            if session.poll() is None:
                try:
                    session.stdin.write("rollback;\n\\q\n")
                    session.stdin.flush()
                    session.wait(timeout=10)
                except (BrokenPipeError, subprocess.TimeoutExpired):
                    session.kill()
                    session.wait()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", type=Path, default=CONFIG / "source.json")
    parser.add_argument("--local-only", action="store_true", help="Encrypt but do not upload")
    args = parser.parse_args()
    os.umask(0o077)
    STATE.mkdir(mode=0o700, parents=True, exist_ok=True)
    # flock prevents manual and scheduled backups from overlapping.
    import fcntl
    with (STATE / "backup.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        c = load_config(args.config)
        recipient = (CONFIG / "recipient.txt").read_text().strip()
        if not re.fullmatch(r"age1[0-9a-z]+", recipient):
            raise BackupError("Valid age encryption recipient required")
        if not args.local_only:
            verify_repository(c["repository"])
        stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        tag = f"backup-{stamp}-{uuid.uuid4().hex[:8]}"
        output = STATE / f"{tag}.tar.age"
        encrypted = False
        try:
            with tempfile.TemporaryDirectory(prefix="plaintext-", dir=STATE) as temp:
                folder = Path(temp)
                manifest = capture_database(c, folder)
                archive = folder / "backup.tar.gz"
                with tarfile.open(archive, "w:gz") as tar:
                    for name in ("database.dump", "roles.sql", "manifest.json"):
                        tar.add(folder / name, arcname=name)
                run(["age", "--encrypt", "--recipient", recipient, "--output", str(output), str(archive)])
                encrypted = True
            digest = hashlib.sha256(output.read_bytes()).hexdigest()
            if not args.local_only:
                run(["gh", "release", "create", tag, str(output), "--repo", c["repository"],
                     "--title", f"Encrypted backup {stamp}", "--notes",
                     f"age-encrypted TryoutFlow backup. SHA256: {digest}. Restore drill is a separate verification."])
                # Verify the remote asset bytes before calling the upload successful.
                with tempfile.TemporaryDirectory(prefix="download-", dir=STATE) as check:
                    run(["gh", "release", "download", tag, "--repo", c["repository"], "--dir", check])
                    if hashlib.sha256((Path(check) / output.name).read_bytes()).hexdigest() != digest:
                        raise BackupError("Uploaded archive checksum does not match")
            status = {"status": "encrypted_local" if args.local_only else "uploaded_verified",
                      "created_at": manifest["created_at"], "tag": tag, "archive": str(output),
                      "sha256": digest, "repository": c["repository"], "restore_verified": False}
            (STATE / "last-success.json").write_text(json.dumps(status, indent=2))
            print(json.dumps(status))
        except Exception:
            # Keep a completed encrypted copy if the remote upload fails.
            if output.exists() and not encrypted:
                output.unlink()
            raise


if __name__ == "__main__":
    os.umask(0o077)
    try:
        main()
    except (BackupError, subprocess.TimeoutExpired, BlockingIOError, OSError, ValueError) as error:
        message = str(error) if isinstance(error, BackupError) else "Backup could not complete; check local configuration and tool availability"
        STATE.mkdir(mode=0o700, parents=True, exist_ok=True)
        (STATE / "last-failure.json").write_text(json.dumps({"at": dt.datetime.now(dt.timezone.utc).isoformat(), "error": message}))
        print(message)
        raise SystemExit(1)
