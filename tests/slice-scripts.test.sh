#!/usr/bin/env bash
set -uo pipefail

scripts="$(cd "$(dirname "$0")/.." && pwd)/plugin/skills/slice/scripts"
work="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$work"' EXIT
failures=0

pass() { echo "ok   $1"; }
fail() { echo "FAIL $1"; failures=$((failures + 1)); }
check() { if eval "$2"; then pass "$1"; else fail "$1"; fi; }

repo="$work/repo"
git init -q --template= -b main "$repo"
git -C "$repo" -c user.email=t@t -c user.name=t commit -q --allow-empty -m init
mkdir "$repo/node_modules"

# slice-tree.sh
tree="$work/trees/s1"
(cd "$repo" && "$scripts/slice-tree.sh" "$tree" feat/T-1-a-s1 main) >/dev/null 2>&1
check "slice tree is created on its own branch" '[ "$(git -C "$tree" branch --show-current)" = feat/T-1-a-s1 ]'
check "slice tree links the repository node_modules" '[ "$(readlink "$tree/node_modules")" = "$repo/node_modules" ]'

(cd "$repo" && "$scripts/slice-tree.sh" "$tree" feat/T-1-a-s1 main) >/dev/null 2>&1
check "slice tree setup is re-runnable" '[ $? -eq 0 ] && [ "$(git -C "$tree" branch --show-current)" = feat/T-1-a-s1 ]'

(cd "$repo" && "$scripts/slice-tree.sh" "$repo/inner" feat/T-1-b-s2 main) >/dev/null 2>&1
check "slice tree inside the repository is refused" '[ $? -ne 0 ] && [ ! -d "$repo/inner" ]'

(cd "$repo" && "$scripts/slice-tree.sh" "$work/trees/other" feat/T-1-a-s1 main) >/dev/null 2>&1
check "a branch already checked out in another tree is refused" '[ $? -ne 0 ]'

tree2="$work/trees/s2"
(cd "$repo" && "$scripts/slice-tree.sh" "$tree2" feat/T-1-b-s2 main) >/dev/null 2>&1
check "two slice trees coexist" '[ "$(git -C "$tree2" branch --show-current)" = feat/T-1-b-s2 ] && [ -d "$tree" ]'

# review-tree.sh still works through the shared helper
review="$work/review/s1"
(cd "$tree" && "$scripts/review-tree.sh" "$review") >/dev/null 2>&1
tip="$(git -C "$tree" rev-parse HEAD 2>/dev/null)"
check "review tree is detached at the slice tip" '[ -n "$tip" ] && [ -d "$review" ] && [ -z "$(git -C "$review" branch --show-current)" ] && [ "$(git -C "$review" rev-parse HEAD)" = "$tip" ]'
check "review tree links the main repository node_modules" '[ "$(readlink "$review/node_modules")" = "$repo/node_modules" ]'

# verify-lock.sh
lock="$work/verify.lock"
log="$work/lock.log"
run_locked() { GATED_DELIVERY_VERIFY_LOCK="$lock" "$scripts/verify-lock.sh" "$@"; }

run_locked "echo start-a >> '$log'; sleep 1; echo end-a >> '$log'" 2>/dev/null &
first=$!
sleep 0.2
run_locked "echo start-b >> '$log'; sleep 1; echo end-b >> '$log'" 2>/dev/null &
second=$!
wait "$first" "$second"
order="$(tr "\n" " " < "$log")"
check "two locked commands never overlap" '[ "$order" = "start-a end-a start-b end-b " ] || [ "$order" = "start-b end-b start-a end-a " ]'

run_locked "exit 7" 2>/dev/null
check "the command exit status is returned" '[ $? -eq 7 ]'
check "the lock is released after a failing command" '[ ! -e "$lock" ]'

mkdir "$lock"
sh -c 'echo $$' > "$lock/pid"
run_locked "true" 2>/dev/null
check "a lock held by a dead process is reclaimed" '[ $? -eq 0 ] && [ ! -e "$lock" ]'

mkdir "$lock"
echo $$ > "$lock/pid"
GATED_DELIVERY_VERIFY_LOCK_TIMEOUT_S=1 run_locked "echo ran > '$work/ran'" 2>/dev/null
status=$?
check "a live holder past the timeout returns 75 without running" '[ $status -eq 75 ] && [ ! -e "$work/ran" ]'
rm -rf "$lock"

[ "$failures" -eq 0 ] && echo "all slice script tests passed" || { echo "$failures failed"; exit 1; }
