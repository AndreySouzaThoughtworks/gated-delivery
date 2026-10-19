#!/usr/bin/env bash
set -uo pipefail

core="$(cd "$(dirname "$0")/.." && pwd)"
denylist="${AIFSD_DENYLIST:-$HOME/.config/aifsd/denylist}"
project="${1:-$HOME/Develop}"
profile="$(mktemp -d)"
trap 'rm -rf "$profile"' EXIT
export CLAUDE_CONFIG_DIR="$profile"
failures=0

check() {
  local name="$1"; shift
  if "$@"; then echo "ok   $name"; else echo "FAIL $name"; failures=$((failures + 1)); fi
}

readonly GREP_NO_MATCH=1

free_of_client_terms() {
  local patterns
  patterns="$(grep -v '^[[:space:]]*$' "$denylist" 2>/dev/null)"
  [ -n "$patterns" ] || return 1
  grep -qiE -e "$patterns"
  [ $? -eq "$GREP_NO_MATCH" ]
}

ancestor_instructions() {
  local dir="$1"
  while :; do
    [ -f "$dir/CLAUDE.md" ] && cat "$dir/CLAUDE.md"
    [ "$dir" = "/" ] && break
    dir="$(dirname "$dir")"
  done
}

claude plugin marketplace add "$core" >/dev/null 2>&1
claude plugin install gated-delivery@gated-delivery >/dev/null 2>&1

plugins="$(claude plugin list 2>&1)"
servers="$(claude mcp list 2>&1)"

check "core plugin installs into a fresh profile" grep -q 'gated-delivery@gated-delivery' <<<"$plugins"
check "fresh profile loads no client plugin" free_of_client_terms <<<"$plugins"
check "fresh profile has no client MCP server" free_of_client_terms <<<"$servers"
check "CLAUDE.md files above $project carry no client terms" free_of_client_terms < <(ancestor_instructions "$project")
check "fresh profile is not logged in to an existing account" grep -q 'Not logged in' < <(cd "$profile" && claude -p ping </dev/null 2>&1)

exit "$failures"
