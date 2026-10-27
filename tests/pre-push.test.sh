#!/usr/bin/env bash
set -uo pipefail

readonly EXIT_SKIPPED=3

core="$(cd "$(dirname "$0")/.." && pwd)"
if ! command -v gitleaks >/dev/null 2>&1; then
  echo "skip: gitleaks is not installed" >&2
  exit "${EXIT_SKIPPED}"
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
failures=0

check() {
  local name="$1" status="$2"
  if [[ "${status}" -eq 0 ]]; then echo "ok   ${name}"; else echo "FAIL ${name}"; failures=$((failures + 1)); fi
}

printf 'acme\n' > "${work}/denylist"
export GATED_DELIVERY_DENYLIST="${work}/denylist"

git init -q --bare "${work}/remote.git"
repo="${work}/repo"
git init -q --template= -b main "${repo}"
mkdir -p "${repo}/scripts" "${repo}/.githooks"
cp "${core}/scripts/leak-guard.sh" "${repo}/scripts/"
cp "${core}/.githooks/pre-push" "${repo}/.githooks/"

g() { git -C "${repo}" -c user.name=t -c user.email=t@example.com -c commit.gpgsign=false "$@"; }
commit() { echo "$2" > "${repo}/$1"; g add -A; g commit -qm "$3"; }
remote_head() { git -C "${work}/remote.git" rev-parse -q --verify refs/heads/main; }
push() { g push -q origin "$@" >/dev/null 2>&1; }
push_rejected() { ! push "$@"; }

g config core.hooksPath .githooks
g remote add origin "${work}/remote.git"

commit README.md "generic project" "init"
push main
check "a clean push goes through" "$?"
pushed="$(remote_head)"

commit notes.md "see acme ticket" "add notes"
commit notes.md "nothing to see" "scrub notes"
push_rejected main
check "a leak removed in a later commit still rejects the push" "$?"
remote_now="$(remote_head)"
[[ "${remote_now}" = "${pushed}" ]]
check "the rejected push leaves the remote unchanged" "$?"

g reset -q --hard "${pushed}"
commit more.md "more generic text" "more"
push main
check "a clean follow-up push goes through" "$?"

push main:refs/heads/topic
push --delete topic
check "deleting a remote branch is not scanned" "$?"

exit "${failures}"
