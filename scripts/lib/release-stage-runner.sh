#!/usr/bin/env bash

run_stage() {
  local name status
  name="$1"
  shift
  stage_number=$((stage_number + 1))
  printf '\n=== [%02d] %s ===\n' "$stage_number" "$name"

  # Run the stage outside any Bash conditional context so `errexit` applies
  # inside shell functions as well as external commands. The parent captures
  # the isolated status only after the stage has stopped at its first failure.
  set +e
  (
    set -e
    "$@"
  )
  status=$?
  set -e

  if ((status != 0)); then
    printf 'FAILED: %s (exit %d)\n' "$name" "$status" >&2
    return "$status"
  fi
}
