#!/usr/bin/env bash
set -uo pipefail

readonly EXIT_LEAK=1
readonly EXIT_BLOCKED=2
readonly GREP_NO_MATCH=1
readonly LOCKFILE_INTEGRITY_HIT='^(.*[/:])?package-lock\.json:[0-9]+:([[:space:]]*"integrity": ")sha512-[A-Za-z0-9+/]+={0,2}(",?)$'

denylist="${GATED_DELIVERY_DENYLIST:-$HOME/.config/gated-delivery/denylist}"
root="${1:-$(git rev-parse --show-toplevel)}"
rev="${2:-}"

patterns_file="$(mktemp)"
trap 'rm -f "$patterns_file"' EXIT
grep -v '^[[:space:]]*$' "$denylist" > "$patterns_file" 2>/dev/null
if [ ! -s "$patterns_file" ]; then
  echo "leak-guard: denylist missing or empty: $denylist" >&2
  exit "$EXIT_BLOCKED"
fi

if git -C "$root" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  if [ -n "$rev" ]; then
    hits="$(git -C "$root" grep -I -n -i -E -f "$patterns_file" "$rev" --)"
  else
    hits="$(git -C "$root" grep --cached -I -n -i -E -f "$patterns_file")"
  fi
else
  hits="$(grep -rIniE --exclude-dir=.git -f "$patterns_file" "$root")"
fi
status=$?

drop_lockfile_integrity_hashes() {
  local hit
  while IFS= read -r hit; do
    if [[ "$hit" =~ $LOCKFILE_INTEGRITY_HIT ]] && ! grep -qiE -f "$patterns_file" <<<"${BASH_REMATCH[2]}${BASH_REMATCH[3]}"; then
      continue
    fi
    printf '%s\n' "$hit"
  done <<<"$hits"
}
[ -n "$hits" ] && hits="$(drop_lockfile_integrity_hashes)"

if [ -n "$hits" ]; then
  echo "leak-guard: client-specific terms found:" >&2
  echo "$hits" >&2
  exit "$EXIT_LEAK"
fi
if [ "$status" -gt "$GREP_NO_MATCH" ]; then
  echo "leak-guard: scan failed (exit $status); cannot prove the content is clean" >&2
  exit "$EXIT_BLOCKED"
fi
