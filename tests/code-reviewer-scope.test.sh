#!/usr/bin/env bash
set -uo pipefail

readonly EXIT_NOT_LOGGED_IN=3
readonly UNREQUESTED_FUNCTION='titleCase'

core="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
failures=0
keep_on_failure() { if [ "$failures" -gt 0 ]; then echo "kept for inspection: $work" >&2; else rm -rf "$work"; fi; }
trap keep_on_failure EXIT

if [ -n "${GATED_DELIVERY_TEST_PROFILE:-}" ]; then export CLAUDE_CONFIG_DIR="$GATED_DELIVERY_TEST_PROFILE"; fi
if (cd "$work" && claude -p ping </dev/null 2>&1) | grep -q 'Not logged in'; then
  echo "skip: profile ${CLAUDE_CONFIG_DIR:-~/.claude} is not logged in" >&2
  exit "$EXIT_NOT_LOGGED_IN"
fi

check() {
  local name="$1"; shift
  if "$@"; then echo "ok   $name"; else echo "FAIL $name"; failures=$((failures + 1)); fi
}

repo="$work/repo"
git init -q --template= -b main "$repo"
g() { git -C "$repo" -c user.name=t -c user.email=t@example.com -c commit.gpgsign=false "$@"; }
mkdir -p "$repo/src" "$repo/test"
cat > "$repo/package.json" <<'EOF'
{ "name": "demo", "type": "module", "scripts": { "test": "node --test" } }
EOF
g add -A && g commit -qm "chore: init"

cat > "$repo/src/slugify.js" <<'EOF'
export const slugify = (text) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/[\s-]+/g, "-")
    .replace(/^-|-$/g, "");

export const titleCase = (text) => text.replace(/\b\w/g, (letter) => letter.toUpperCase());
EOF
cat > "$repo/test/slugify.test.js" <<'EOF'
import { test } from "node:test";
import assert from "node:assert/strict";
import { slugify } from "../src/slugify.js";

const cases = [
  ["  Hello, World  Again ", "hello-world-again"],
  ["already-a--slug", "already-a-slug"],
  ["-- edge hyphens --", "edge-hyphens"],
  ["Symbols & Stuff!", "symbols-stuff"],
  ["", ""],
];

for (const [input, expected] of cases) {
  test(`slugify(${JSON.stringify(input)}) is ${JSON.stringify(expected)}`, () => {
    assert.equal(slugify(input), expected);
  });
}
EOF
g add -A && g commit -qm "feat: add slugify"

output="$work/review.out"
(cd "$repo" && claude -p "Use the gated-delivery:code-reviewer agent with diff-range HEAD~1..HEAD, verify-cmd 'npm test', and acceptance-criteria: 'AC1: slugify(text) lowercases, trims, drops non-alphanumerics and joins words with single hyphens.' Do not read or write the agent's memory for this review. Print the agent's full report verbatim." \
  --plugin-dir "$core/plugin" --setting-sources project,local --permission-mode acceptEdits \
  --allowedTools "Bash(git:*)" "Bash(npm:*)" "Bash(node:*)" </dev/null >"$output" 2>&1)

reported_under_scope() { awk 'tolower($0) ~ /scope/ { in_scope = 1 } in_scope' "$1" | grep -q "$UNREQUESTED_FUNCTION"; }
check "the unrequested function is reported under Scope" reported_under_scope "$output"
check "scope findings do not block a change whose ACs are met" grep -qE '\bPASS\b' "$output"

exit "$failures"
