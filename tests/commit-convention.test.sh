#!/usr/bin/env bash
set -uo pipefail

readonly EXIT_NOT_LOGGED_IN=3
readonly CONVENTIONAL_SUBJECT='^(feat|fix|chore|refactor|docs|test|perf|build|ci|style)(\([^)]*\))?!?: .+'
readonly TICKET_KEY='[A-Z][A-Z0-9]+-[0-9]+'

plugin="$(cd "$(dirname "$0")/.." && pwd)/plugin"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
failures=0

if [[ -n "${GATED_DELIVERY_TEST_PROFILE:-}" ]]; then export CLAUDE_CONFIG_DIR="${GATED_DELIVERY_TEST_PROFILE}"; fi
if (cd "${work}" && claude -p ping </dev/null 2>&1) | grep -q 'Not logged in'; then
  echo "skip: profile ${CLAUDE_CONFIG_DIR:-~/.claude} is not logged in" >&2
  exit "${EXIT_NOT_LOGGED_IN}"
fi

check() {
  local name="$1" status="$2"
  if [[ "${status}" -eq 0 ]]; then echo "ok   ${name}"; else echo "FAIL ${name}"; failures=$((failures + 1)); fi
}

new_repo() {
  local dir="${work}/$1" origin="$2" branch="$3"
  git init -q -b main "${dir}"
  git -C "${dir}" remote add origin "${origin}"
  echo "hello" > "${dir}/greeting.txt"
  git -C "${dir}" add greeting.txt
  git -C "${dir}" -c user.name=test -c user.email=test@example.com commit -q -m "chore: seed"
  git -C "${dir}" switch -q -c "${branch}"
  echo "hello, world" > "${dir}/greeting.txt"
  git -C "${dir}" config user.name test
  git -C "${dir}" config user.email test@example.com
  echo "${dir}"
}

run_commit() {
  (cd "$1" && claude -p "/gated-delivery:commit" --plugin-dir "${plugin}" \
    --allowedTools "Bash(git status:*)" "Bash(git diff:*)" "Bash(git branch:*)" "Bash(git log:*)" \
    "Bash(git add:*)" "Bash(git commit:*)" "Bash(git config:*)" </dev/null >"$1.out" 2>&1)
}

last_subject() { git -C "$1" log -1 --format=%s; }
commit_count() { git -C "$1" rev-list --count HEAD; }
committed_since() { local count; count="$(commit_count "$1")"; [[ "${count}" -gt "$2" ]]; }
subject_matches() { local subject; subject="$(last_subject "$1")"; grep -qE "$2" <<<"${subject}"; }
subject_lacks() { local subject; subject="$(last_subject "$1")"; ! grep -qE "$2" <<<"${subject}"; }
asks_for_ticket() { grep -qiE '(ticket|key)' "$1" && grep -q '?' "$1"; }

add_acme_convention() {
  cat > "$1/CLAUDE.md" <<'EOF'
## Commit convention

- **Applies to:** origins under `acme/`
- **Subject:** `<type>(<KEY>-<N>): <description>`
- **Ticket key:** derived from the branch name (`feat/ACME-7-greeting` → `ACME-7`); required
- **Branch:** `<type>/<KEY>-<N>-<short-desc>`
EOF
  git -C "$1" add CLAUDE.md
  git -C "$1" commit -q -m "chore: add convention"
}

plain="$(new_repo plain git@github.com:someone/demo.git feat/greeting)"
before="$(commit_count "${plain}")"
run_commit "${plain}"
committed_since "${plain}" "${before}"
check "no convention: a commit is made" "$?"
subject_matches "${plain}" "${CONVENTIONAL_SUBJECT}"
check "no convention: plain Conventional Commits subject" "$?"
subject_lacks "${plain}" "${TICKET_KEY}"
check "no convention: no ticket key invented" "$?"

keyed="$(new_repo keyed git@github.com:acme/demo.git feat/ACME-7-greeting)"
add_acme_convention "${keyed}"
before="$(commit_count "${keyed}")"
run_commit "${keyed}"
committed_since "${keyed}" "${before}"
check "matching convention: a commit is made" "$?"
subject_matches "${keyed}" '^feat\(ACME-7\): '
check "matching convention: subject carries the branch key" "$?"

keyless="$(new_repo keyless git@github.com:acme/demo.git feat/greeting)"
add_acme_convention "${keyless}"
before="$(commit_count "${keyless}")"
run_commit "${keyless}"
keyless_count="$(commit_count "${keyless}")"
keyless_status=0
[[ "${keyless_count}" = "${before}" ]] || keyless_status=1
check "matching convention, no key on branch: no commit made" "${keyless_status}"
asks_for_ticket "${keyless}.out"
check "matching convention, no key on branch: asks which ticket" "$?"

other="$(new_repo other git@github.com:someone/demo.git feat/greeting)"
add_acme_convention "${other}"
before="$(commit_count "${other}")"
run_commit "${other}"
committed_since "${other}" "${before}"
check "convention for another origin: a commit is made" "$?"
subject_lacks "${other}" "${TICKET_KEY}"
check "convention for another origin: no ticket key" "$?"

exit "${failures}"
