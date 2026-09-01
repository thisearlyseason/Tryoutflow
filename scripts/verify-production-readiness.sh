#!/usr/bin/env bash
set -euo pipefail

readonly SCRIPT_DIRECTORY="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
readonly SCRIPT_PATH="$SCRIPT_DIRECTORY/$(basename "${BASH_SOURCE[0]}")"
readonly REPOSITORY_ROOT="$(git -C "$(dirname "$SCRIPT_PATH")/.." rev-parse --show-toplevel)"
cd "$REPOSITORY_ROOT"

source "$SCRIPT_DIRECTORY/lib/release-stage-runner.sh"

if (($# != 0)); then
  printf 'Usage: bash scripts/verify-production-readiness.sh\n' >&2
  exit 64
fi

acquire_release_lock() {
  local git_common lock_file
  git_common="$(cd "$(git rev-parse --git-common-dir)" && pwd -P)"
  lock_file="$git_common/tryoutflow-production-readiness.lock"

  if command -v flock >/dev/null 2>&1; then
    exec flock -n "$lock_file" env TRYOUTFLOW_RELEASE_LOCK_HELD=1 bash "$SCRIPT_PATH"
  fi
  if command -v lockf >/dev/null 2>&1; then
    exec lockf -t 0 "$lock_file" env TRYOUTFLOW_RELEASE_LOCK_HELD=1 bash "$SCRIPT_PATH"
  fi

  printf 'FAILED: no kernel file-lock command is available (need flock or lockf)\n' >&2
  exit 69
}

if [[ "${TRYOUTFLOW_RELEASE_LOCK_HELD:-}" != '1' ]]; then
  acquire_release_lock
fi
unset TRYOUTFLOW_RELEASE_LOCK_HELD

readonly EXPECTED_NODE_VERSION='v24.12.0'
readonly EXPECTED_NPM_VERSION='11.12.1'
readonly EXPECTED_SUPABASE_VERSION='2.116.0'
readonly PUBLIC_BUILD_ORIGIN='https://release.tryoutflow.test'
readonly DATABASE_TYPES='src/infrastructure/supabase/database.types.ts'
readonly NPM=(corepack npm@11.12.1)

stage_number=0

hash_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

assert_hash_unchanged() {
  local actual expected label path
  path="$1"
  expected="$2"
  label="$3"
  actual="$(hash_file "$path")"
  if [[ "$actual" != "$expected" ]]; then
    printf '%s changed during the release gate: %s\n' "$label" "$path" >&2
    return 1
  fi
}

verify_tracked_secret_boundaries() {
  local matches sensitive_files
  matches="$release_tmp/potential-secret-files"
  sensitive_files="$release_tmp/tracked-sensitive-files"

  if git grep -I -l -E -- \
    '-----BEGIN ([A-Z0-9 ]+ )?PRIVATE KEY-----|sk_live_[A-Za-z0-9]{16,}|rk_live_[A-Za-z0-9]{16,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}' \
    -- . ':(exclude)package-lock.json' >"$matches"; then
    printf 'Potential tracked production secret found in:\n' >&2
    sed 's/^/  /' "$matches" >&2
    return 1
  fi

  git ls-files '*.pem' '*.key' '*.p12' '*.pfx' '.env*' \
    | grep -v '^\.env\.example$' >"$sensitive_files" || true
  if [[ -s "$sensitive_files" ]]; then
    printf 'Unexpected tracked credential/config file found:\n' >&2
    sed 's/^/  /' "$sensitive_files" >&2
    return 1
  fi
}

verify_repository_state() {
  local final_status
  git diff --check || return $?
  final_status="$(git status --porcelain=v1 --untracked-files=all)" || return $?
  if [[ "$final_status" != "$initial_status" ]]; then
    printf 'Tracked or untracked repository state changed during the release gate.\n' >&2
    diff -u "$release_tmp/status-before" <(printf '%s\n' "$final_status") >&2 || true
    return 1
  fi
}

verify_exact_version() {
  local actual expected label status
  label="$1"
  expected="$2"
  shift 2

  printf 'CHECK: %s\n' "$label"
  if actual="$("$@")"; then
    status=0
  else
    status=$?
  fi
  if ((status != 0)); then
    printf 'FAILED: %s command failed (exit %d)\n' "$label" "$status" >&2
    return "$status"
  fi
  if [[ "$actual" != "$expected" ]]; then
    printf 'FAILED: %s (expected %s, received %s)\n' "$label" "$expected" "$actual" >&2
    return 1
  fi
  printf 'PASS: %s = %s\n' "$label" "$actual"
}

verify_preinstall_toolchain() {
  verify_exact_version 'pinned Node identity' "$EXPECTED_NODE_VERSION" node --version || return $?
  verify_exact_version 'pinned npm pre-install identity' "$EXPECTED_NPM_VERSION" \
    "${NPM[@]}" --version || return $?
}

verify_postinstall_toolchain() {
  verify_exact_version 'pinned npm post-install identity' "$EXPECTED_NPM_VERSION" \
    "${NPM[@]}" --version || return $?
  verify_exact_version 'pinned Supabase CLI identity' "$EXPECTED_SUPABASE_VERSION" \
    "${NPM[@]}" exec -- supabase --version || return $?
}

release_tmp="$(mktemp -d "${TMPDIR:-/tmp}/tryoutflow-release.XXXXXX")"
database_cleanup_required=false
cleanup_release_tmp() {
  case "$release_tmp" in
    "${TMPDIR:-/tmp}"/tryoutflow-release.*) rm -rf -- "$release_tmp" ;;
    *) printf 'Refusing to remove unexpected release temp path: %s\n' "$release_tmp" >&2 ;;
  esac
}

cleanup_on_exit() {
  local original_status=$?
  local reset_status residue_status
  trap - EXIT

  if [[ "$database_cleanup_required" == 'true' ]]; then
    printf '\n=== [cleanup] failure cleanup: clean unseeded database reset ===\n'
    set +e
    "${NPM[@]}" exec -- supabase db reset --local --no-seed
    reset_status=$?
    if ((reset_status == 0)); then
      printf '\n=== [cleanup] failure cleanup: residue audit ===\n'
      "${NPM[@]}" run release:state:residue
      residue_status=$?
    else
      residue_status=1
      printf 'FAILED: failure cleanup database reset (exit %d)\n' "$reset_status" >&2
    fi
    set -e
    if ((residue_status != 0)); then
      printf 'FAILED: failure cleanup could not prove zero release residue\n' >&2
    fi
  fi

  cleanup_release_tmp
  exit "$original_status"
}
trap cleanup_on_exit EXIT

initial_status="$(git status --porcelain=v1 --untracked-files=all)"
printf '%s\n' "$initial_status" >"$release_tmp/status-before"
readonly initial_status
readonly package_lock_hash="$(hash_file package-lock.json)"
readonly database_types_hash="$(hash_file "$DATABASE_TYPES")"

run_stage 'pinned Node and npm preflight' verify_preinstall_toolchain

run_stage 'clean dependency installation' "${NPM[@]}" ci
run_stage 'post-install toolchain identity' verify_postinstall_toolchain
run_stage 'npm ci lockfile preservation' assert_hash_unchanged package-lock.json "$package_lock_hash" 'package-lock.json'
run_stage 'npm ci generated-type preservation' assert_hash_unchanged "$DATABASE_TYPES" "$database_types_hash" 'generated database types'
run_stage 'local Supabase identity proof' "${NPM[@]}" run release:state:preflight

run_stage 'format check' "${NPM[@]}" run format:check
run_stage 'lint' "${NPM[@]}" run lint
run_stage 'typecheck' "${NPM[@]}" run typecheck

database_cleanup_required=true
run_stage 'clean unseeded database reset' "${NPM[@]}" exec -- supabase db reset --local --no-seed
run_stage 'full pgTAP database suite' "${NPM[@]}" run test:db
run_stage 'generated database types pass 1' "${NPM[@]}" run db:types
run_stage 'generated database types match tracked bytes' assert_hash_unchanged "$DATABASE_TYPES" "$database_types_hash" 'generated database types'
readonly generated_types_first_hash="$(hash_file "$DATABASE_TYPES")"
run_stage 'generated database types pass 2' "${NPM[@]}" run db:types
run_stage 'generated database types are reproducible' assert_hash_unchanged "$DATABASE_TYPES" "$generated_types_first_hash" 'second generated database types pass'

run_stage 'deterministic seeded database reset' "${NPM[@]}" exec -- supabase db reset --local
run_stage 'unit suite' "${NPM[@]}" run test:unit
run_stage 'supervised integration suite pass 1' "${NPM[@]}" run test:integration
run_stage 'supervised integration suite pass 2' "${NPM[@]}" run test:integration
run_stage 'provider contract suite' "${NPM[@]}" run test:contract

run_stage 'production build' env NEXT_PUBLIC_APP_URL="$PUBLIC_BUILD_ORIGIN" "${NPM[@]}" run build
run_stage 'production marketing artifact gate' "${NPM[@]}" run test:marketing:production
run_stage 'strict five-project browser gate' "${NPM[@]}" run test:e2e -- --retries=0

run_stage 'high-severity dependency audit' "${NPM[@]}" audit --audit-level=high
run_stage 'tracked secret boundary scan' verify_tracked_secret_boundaries
run_stage 'final clean unseeded database reset' "${NPM[@]}" exec -- supabase db reset --local --no-seed
run_stage 'local process, database, auth, and fixture residue audit' "${NPM[@]}" run release:state:residue
run_stage 'repository diff and generated-file audit' verify_repository_state
database_cleanup_required=false

printf '\nProduction readiness automated gate passed. Manual production prerequisites remain in docs/operations/release-checklist.md.\n'
