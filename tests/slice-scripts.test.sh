#!/usr/bin/env bash
set -uo pipefail

scripts="$(cd "$(dirname "$0")/.." && pwd)/plugin/skills/slice/scripts"
work="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$work"' EXIT
failures=0

pass() { echo "ok   $1"; }
fail() { echo "FAIL $1"; failures=$((failures + 1)); }
check() { if eval "$2"; then pass "$1"; else fail "$1"; fi; }

new_repo() {
  git init -q --template= -b main "$1"
  git -C "$1" -c user.email=t@t -c user.name=t commit -q --allow-empty -m init
  printf 'node_modules/\n' > "$1/.gitignore"
  git -C "$1" add .gitignore
  git -C "$1" -c user.email=t@t -c user.name=t commit -q -m ignore
}

# slice-tree.sh, in a repository with dependencies installed
repo="$work/repo"
new_repo "$repo"
mkdir "$repo/node_modules"
tree="$work/trees/s1"
(cd "$repo" && "$scripts/slice-tree.sh" "$tree" feat/T-1-a-s1 main) >/dev/null 2>&1
check "slice tree is created on its own branch" '[ "$(git -C "$tree" branch --show-current)" = feat/T-1-a-s1 ]'
check "slice tree links the repository node_modules" '[ "$(readlink "$tree/node_modules")" = "$repo/node_modules" ]'
check "the node_modules link leaves a new slice tree clean" '[ -d "$tree" ] && [ -z "$(git -C "$tree" status --porcelain)" ]'

(cd "$repo" && "$scripts/slice-tree.sh" "$tree" feat/T-1-a-s1 main) >/dev/null 2>&1
check "slice tree setup is re-runnable" '[ $? -eq 0 ] && [ "$(git -C "$tree" branch --show-current)" = feat/T-1-a-s1 ]'

ln -s "$work/trees" "$work/trees-link"
(cd "$repo" && "$scripts/slice-tree.sh" "$work/trees-link/s1" feat/T-1-a-s1 main) >/dev/null 2>&1
check "a tree named through a symlinked folder is recognised on re-run" '[ $? -eq 0 ]'

(cd "$repo" && "$scripts/slice-tree.sh" "$repo/inner" feat/T-1-b-s2 main) >/dev/null 2>&1
check "slice tree inside the repository is refused" '[ $? -ne 0 ] && [ ! -d "$repo/inner" ]'

(cd "$repo" && "$scripts/slice-tree.sh" "$work/trees/other" feat/T-1-a-s1 main) >/dev/null 2>&1
check "a branch already checked out in another tree is refused" '[ $? -ne 0 ]'

tree2="$work/trees/s2"
(cd "$repo" && "$scripts/slice-tree.sh" "$tree2" feat/T-1-b-s2 main) >/dev/null 2>&1
check "two slice trees coexist" '[ "$(git -C "$tree2" branch --show-current)" = feat/T-1-b-s2 ] && [ -d "$tree" ]'

rm -f "$tree2/node_modules" && mkdir "$tree2/node_modules" && touch "$tree2/node_modules/own-install"
(cd "$repo" && "$scripts/slice-tree.sh" "$tree2" feat/T-1-b-s2 main) >/dev/null 2>&1
check "a slice tree's own install survives a re-run" '[ -f "$tree2/node_modules/own-install" ]'

# review-tree.sh, run from a slice tree
review="$work/review/s1"
(cd "$tree" && "$scripts/review-tree.sh" "$review") >/dev/null 2>&1
tip="$(git -C "$tree" rev-parse HEAD 2>/dev/null)"
check "review tree is detached at the slice tip" '[ -n "$tip" ] && [ -d "$review" ] && [ -z "$(git -C "$review" branch --show-current)" ] && [ "$(git -C "$review" rev-parse HEAD)" = "$tip" ]'
check "review tree links the slice tree dependencies" '[ "$(readlink "$review/node_modules")" = "$repo/node_modules" ]'

review2="$work/review/s2"
(cd "$tree2" && "$scripts/review-tree.sh" "$review2") >/dev/null 2>&1
check "review tree uses a slice tree's own install" '[ "$(readlink "$review2/node_modules")" = "$tree2/node_modules" ]'

batch_tree="$work/trees/s2-b1"
(cd "$tree2" && "$scripts/slice-tree.sh" "$batch_tree" feat/T-1-b-s2-b1 HEAD) >/dev/null 2>&1
check "a batch tree uses its slice tree's own install" '[ "$(readlink "$batch_tree/node_modules")" = "$tree2/node_modules" ]'

# slice-tree.sh, in a repository with no dependencies
plain="$work/plain"
new_repo "$plain"
plain_tree="$work/trees/plain"
(cd "$plain" && "$scripts/slice-tree.sh" "$plain_tree" feat/T-2-a-s1 main) >/dev/null 2>&1
check "no node_modules link is made when the repository has none" '[ -d "$plain_tree" ] && [ ! -e "$plain_tree/node_modules" ] && [ ! -L "$plain_tree/node_modules" ]'

# slice-tree.sh resumes a branch that exists only on the remote
remote="$work/remote.git"
git init -q --bare "$remote"
git -C "$plain" remote add origin "$remote"
git -C "$plain" push -q origin main
git -C "$plain" checkout -q -b feat/T-2-b-s2
git -C "$plain" -c user.email=t@t -c user.name=t commit -q --allow-empty -m "s2 work"
pushed="$(git -C "$plain" rev-parse HEAD)"
git -C "$plain" push -q origin feat/T-2-b-s2
git -C "$plain" checkout -q main
git -C "$plain" branch -q -D feat/T-2-b-s2
remote_tree="$work/trees/remote"
(cd "$plain" && "$scripts/slice-tree.sh" "$remote_tree" feat/T-2-b-s2 origin/main) >/dev/null 2>&1
check "a branch only on the remote is resumed at its pushed tip" '[ "$(git -C "$remote_tree" rev-parse HEAD 2>/dev/null)" = "$pushed" ]'

fresh_tree="$work/trees/fresh"
(cd "$plain" && "$scripts/slice-tree.sh" "$fresh_tree" feat/T-2-c-s3 origin/main) >/dev/null 2>&1
check "a new branch from origin/main does not track origin/main" '[ -d "$fresh_tree" ] && ! git -C "$fresh_tree" rev-parse --abbrev-ref "@{u}" >/dev/null 2>&1'
git -C "$fresh_tree" -c push.default=upstream push -q -u origin HEAD:refs/heads/feat/T-2-c-s3 2>/dev/null
check "the claim push creates the slice branch, not main" '[ -n "$(git -C "$remote" rev-parse --verify -q refs/heads/feat/T-2-c-s3)" ] && [ "$(git -C "$remote" rev-parse main)" = "$(git -C "$plain" rev-parse origin/main)" ]'

# slice-tree.sh fast-forwards a stale local branch, and refuses a diverged one
git -C "$plain" worktree remove --force "$remote_tree"
git -C "$remote_tree" status >/dev/null 2>&1
other="$work/other-machine"
git clone -q --template= "$remote" "$other"
git -C "$other" checkout -q feat/T-2-b-s2
git -C "$other" -c user.email=t@t -c user.name=t commit -q --allow-empty -m "more s2 work"
git -C "$other" push -q origin feat/T-2-b-s2
newer="$(git -C "$other" rev-parse HEAD)"
git -C "$plain" fetch -q origin
stale_tree="$work/trees/stale"
(cd "$plain" && "$scripts/slice-tree.sh" "$stale_tree" feat/T-2-b-s2 origin/main) >/dev/null 2>&1
check "a stale local branch is fast-forwarded to origin" '[ "$(git -C "$stale_tree" rev-parse HEAD 2>/dev/null)" = "$newer" ]'

git -C "$plain" worktree remove --force "$stale_tree"
git -C "$plain" branch -q -f feat/T-2-b-s2 "$pushed"
git -C "$plain" checkout -q feat/T-2-b-s2
git -C "$plain" -c user.email=t@t -c user.name=t commit -q --allow-empty -m "local-only work"
git -C "$plain" checkout -q main
diverged_tree="$work/trees/diverged"
(cd "$plain" && "$scripts/slice-tree.sh" "$diverged_tree" feat/T-2-b-s2 origin/main) >/dev/null 2>&1
check "a local branch diverged from origin is refused" '[ $? -ne 0 ] && [ ! -d "$diverged_tree/.git" ] && [ ! -f "$diverged_tree/.git" ]'

# batch-pick.sh, run from the slice's writing tree
g() { git -C "$1" -c user.email=t@t -c user.name=t "${@:2}"; }
pick_repo="$work/pick"
new_repo "$pick_repo"
printf 'a\nb\nc\n' > "$pick_repo/shared.txt"; g "$pick_repo" add shared.txt; g "$pick_repo" commit -q -m shared
g "$pick_repo" checkout -q -b slice
slice_base="$(git -C "$pick_repo" rev-parse HEAD)"
for b in b1 b2 b3; do g "$pick_repo" branch -q "$b" "$slice_base"; done
g "$pick_repo" checkout -q b1; echo one > "$pick_repo/one.txt"; g "$pick_repo" add one.txt; g "$pick_repo" commit -q -m "feat: AC1"; echo uno >> "$pick_repo/one.txt"; g "$pick_repo" commit -qam "feat: AC2"
g "$pick_repo" checkout -q b2; echo two > "$pick_repo/two.txt"; g "$pick_repo" add two.txt; g "$pick_repo" commit -q -m "feat: AC3"
g "$pick_repo" checkout -q b3; printf 'a\nB3\nc\n' > "$pick_repo/shared.txt"; g "$pick_repo" commit -qam "feat: AC4"
g "$pick_repo" checkout -q slice
printf 'a\nSLICE\nc\n' > "$pick_repo/shared.txt"; g "$pick_repo" commit -qam "feat: earlier batch"

range="$(cd "$pick_repo" && GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t "$scripts/batch-pick.sh" b1 "$slice_base" 2>/dev/null)"
check "a batch is picked onto the slice with one commit per AC" '[ "$(git -C "$pick_repo" log --format=%s -2 | tr "\n" "|")" = "feat: AC2|feat: AC1|" ]'
check "the printed range covers exactly the picked batch" '[ "$(git -C "$pick_repo" log --format=%s $range | tr "\n" "|")" = "feat: AC2|feat: AC1|" ]'

(cd "$pick_repo" && GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t "$scripts/batch-pick.sh" b2 "$slice_base") >/dev/null 2>&1
check "a second independent batch picks cleanly after the first" '[ $? -eq 0 ] && [ -f "$pick_repo/two.txt" ] && [ -f "$pick_repo/one.txt" ]'

before="$(git -C "$pick_repo" rev-parse HEAD)"
(cd "$pick_repo" && GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t "$scripts/batch-pick.sh" b3 "$slice_base") >/dev/null 2>&1
status=$?
check "a conflicting batch exits 3 and leaves the slice as it was" '[ $status -eq 3 ] && [ "$(git -C "$pick_repo" rev-parse HEAD)" = "$before" ] && [ -z "$(git -C "$pick_repo" status --porcelain)" ]'

pick() { (cd "$pick_repo" && GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t "$scripts/batch-pick.sh" "$@"); }

before="$(git -C "$pick_repo" rev-parse HEAD)"
out="$(pick b1 "$slice_base" 2>/dev/null)"; status=$?
check "re-picking a batch already on the slice is a no-op, not a conflict" '[ $status -eq 0 ] && [ "$(git -C "$pick_repo" rev-parse HEAD)" = "$before" ] && [ "$out" = "$before..$before" ]'

g "$pick_repo" branch -q b-empty "$slice_base"
out="$(pick b-empty "$slice_base" 2>/dev/null)"; status=$?
check "a batch with no commits is a no-op, not a conflict" '[ $status -eq 0 ] && [ "$out" = "$before..$before" ]'

pick no-such-branch "$slice_base" >/dev/null 2>&1
check "a missing batch branch is an error, not a conflict" '[ $? -eq 1 ] && [ "$(git -C "$pick_repo" rev-parse HEAD)" = "$before" ]'

g "$pick_repo" branch -q b4 "$slice_base"
g "$pick_repo" branch -q b4-side "$slice_base"
g "$pick_repo" checkout -q b4-side; echo side > "$pick_repo/side.txt"; g "$pick_repo" add side.txt; g "$pick_repo" commit -q -m "feat: side"
g "$pick_repo" checkout -q b4; echo four > "$pick_repo/four.txt"; g "$pick_repo" add four.txt; g "$pick_repo" commit -q -m "feat: AC5"
g "$pick_repo" merge -q --no-ff --no-edit b4-side
g "$pick_repo" checkout -q slice
err="$(cd "$pick_repo" && env -u GIT_COMMITTER_NAME -u GIT_COMMITTER_EMAIL -u GIT_AUTHOR_NAME -u GIT_AUTHOR_EMAIL -u EMAIL GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 git -c user.useConfigOnly=true -c user.name= -c user.email= rev-parse HEAD >/dev/null; cd "$pick_repo" && env -u GIT_COMMITTER_NAME -u GIT_COMMITTER_EMAIL -u GIT_AUTHOR_NAME -u GIT_AUTHOR_EMAIL -u EMAIL GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=user.useConfigOnly GIT_CONFIG_VALUE_0=true "$scripts/batch-pick.sh" b4 "$slice_base" 2>&1 >/dev/null)"; status=$?
check "a pick that fails for a reason other than a conflict exits 1 and shows why" '[ $status -eq 1 ] && [ -n "$err" ] && [ "$(git -C "$pick_repo" rev-parse HEAD)" = "$before" ] && [ -z "$(git -C "$pick_repo" status --porcelain)" ]'

echo dirt > "$pick_repo/dirt.txt"
(cd "$pick_repo" && "$scripts/batch-pick.sh" b2 "$slice_base") >/dev/null 2>&1
check "a dirty writing tree is refused" '[ $? -eq 1 ] && [ "$(git -C "$pick_repo" rev-parse HEAD)" = "$before" ]'
rm "$pick_repo/dirt.txt"

# verify-lock.sh
lock="$work/verify.lock"
log="$work/lock.log"
run_locked() { GATED_DELIVERY_VERIFY_LOCK="$lock" "$scripts/verify-lock.sh" "$@"; }

for i in 1 2 3 4 5 6; do
  run_locked "echo s >> '$log'; sleep 0.3; echo e >> '$log'" 2>/dev/null &
done
wait
check "six concurrent locked commands never overlap" '[ "$(tr -d "\n" < "$log")" = "sesesesesese" ]'

run_locked "exit 7" 2>/dev/null
check "the command exit status is returned" '[ $? -eq 7 ]'
run_locked "true" 2>/dev/null
check "the lock is free after a failing command" '[ $? -eq 0 ]'

run_locked "sleep 3" 2>/dev/null &
holder=$!
sleep 0.5
GATED_DELIVERY_VERIFY_LOCK_TIMEOUT_S=1 run_locked "echo ran > '$work/ran'" 2>/dev/null
status=$?
check "a live holder past the timeout returns 75 without running" '[ $status -eq 75 ] && [ ! -e "$work/ran" ]'
wait "$holder"

GATED_DELIVERY_VERIFY_LOCK="$lock" "$scripts/verify-lock.sh" "sleep 2 & wait" 2>/dev/null &
wrapper=$!
sleep 0.5
kill -9 "$wrapper" 2>/dev/null
GATED_DELIVERY_VERIFY_LOCK_TIMEOUT_S=1 run_locked "true" 2>/dev/null
check "an orphaned verify run still holds the lock" '[ $? -eq 75 ]'
sleep 2
run_locked "true" 2>/dev/null
check "the lock frees itself once every holder has exited" '[ $? -eq 0 ]'

# Both tree scripts print only the tree's path on stdout, so `$(script ...)` captures one line
out_repo="$work/out-repo"
new_repo "$out_repo"
out_tree="$work/trees/out-s1"
out="$(cd "$out_repo" && "$scripts/slice-tree.sh" "$out_tree" feat/T-3-a-s1 main 2>/dev/null)"
check "slice-tree.sh prints only the tree path when it creates the tree" '[ "$out" = "$out_tree" ]'
out="$(cd "$out_repo" && "$scripts/slice-tree.sh" "$out_tree" feat/T-3-a-s1 main 2>/dev/null)"
check "slice-tree.sh prints only the tree path on a re-run" '[ "$out" = "$out_tree" ]'
git -C "$out_repo" branch -q feat/T-3-b-s2 main
out_tree2="$work/trees/out-s2"
out="$(cd "$out_repo" && "$scripts/slice-tree.sh" "$out_tree2" feat/T-3-b-s2 main 2>/dev/null)"
check "slice-tree.sh prints only the tree path for an existing local branch" '[ "$out" = "$out_tree2" ]'
out_review="$work/review/out-s1"
out="$(cd "$out_tree" && "$scripts/review-tree.sh" "$out_review" 2>/dev/null)"
check "review-tree.sh prints only the tree path when it creates the tree" '[ "$out" = "$out_review" ]'
out="$(cd "$out_tree" && "$scripts/review-tree.sh" "$out_review" "$(git -C "$out_tree" rev-parse HEAD~1)" 2>/dev/null)"
check "review-tree.sh prints only the tree path when it re-points the tree" '[ "$out" = "$out_review" ]'

# Claim race: two actors claim one slice; exactly one holds it
race="$work/race"
new_repo "$race"
race_remote="$work/race.git"
git init -q --bare "$race_remote"
git -C "$race" remote add origin "$race_remote"
git -C "$race" push -q origin main 2>/dev/null
git -C "$race" fetch -q origin
race_branch=feat/T-4-a-s1
stale_clone="$work/race-stale"
git clone -q "$race_remote" "$stale_clone" 2>/dev/null
claim_push() { git -C "$1" push -q --force-with-lease="refs/heads/$race_branch:" origin "HEAD:refs/heads/$race_branch" >/dev/null 2>&1; }
remote_tip() { git -C "$race_remote" rev-parse --verify -q "refs/heads/$race_branch"; }

alice_tree="$work/trees/T-4-s1-alice"
out="$(cd "$race" && "$scripts/slice-tree.sh" --claim "$alice_tree" "$race_branch" origin/main 2>/dev/null)"
check "a claim creates a new tree and prints only its path" '[ "$out" = "$alice_tree" ] && [ "$(git -C "$alice_tree" branch --show-current 2>/dev/null)" = "$race_branch" ]'
bob_tree="$work/trees/T-4-s1-bob"
(cd "$race" && "$scripts/slice-tree.sh" --claim "$bob_tree" "$race_branch" origin/main) >/dev/null 2>&1
check "a claim is refused when the branch exists locally, before any push" '[ $? -ne 0 ] && [ ! -e "$bob_tree" ] && [ "$(git -C "$alice_tree" branch --show-current)" = "$race_branch" ]'
g "$alice_tree" commit -q --allow-empty -m "chore(T-4): claim s1 for alice" 2>/dev/null
alice_claim="$(git -C "$alice_tree" rev-parse HEAD 2>/dev/null)"
claim_push "$alice_tree"
check "the first create-only claim push lands" '[ $? -eq 0 ] && [ "$(remote_tip)" = "$alice_claim" ]'


bob_push_tree="$work/trees/T-4-s1-bob-push"
git -C "$race" worktree add -q --detach "$bob_push_tree" origin/main 2>/dev/null
g "$bob_push_tree" commit -q --allow-empty -m "chore(T-4): claim s1 for bob"
claim_push "$bob_push_tree"
check "a second claim push from another tree of the same clone is rejected" '[ $? -ne 0 ] && [ "$(remote_tip)" = "$alice_claim" ]'

(cd "$stale_clone" && "$scripts/slice-tree.sh" --claim "$work/trees/T-4-s1-carol" "$race_branch" origin/main) >/dev/null 2>&1
check "a claim is refused when only ls-remote sees the branch on origin" '[ $? -ne 0 ] && [ ! -e "$work/trees/T-4-s1-carol" ]'

git -C "$stale_clone" checkout -q -b "$race_branch" origin/main
g "$stale_clone" commit -q --allow-empty -m "chore(T-4): claim s1 for carol"
claim_push "$stale_clone"
check "a second claim push from another clone is rejected" '[ $? -ne 0 ] && [ "$(remote_tip)" = "$alice_claim" ]'

fetched_clone="$work/race-fetched"
git clone -q "$race_remote" "$fetched_clone" 2>/dev/null
git -C "$fetched_clone" checkout -q --detach origin/main
git -C "$fetched_clone" -c user.email=t@t -c user.name=t commit -q --allow-empty -m "on top of nothing"
git -C "$fetched_clone" checkout -q -b on-top "origin/$race_branch"
g "$fetched_clone" commit -q --allow-empty -m "fast-forward on alice's claim"
claim_push "$fetched_clone"
check "a create-only claim push is rejected even when it fast-forwards" '[ $? -ne 0 ] && [ "$(remote_tip)" = "$alice_claim" ]'
git -C "$fetched_clone" checkout -q --detach origin/main
git -C "$fetched_clone" branch -q -D on-top
(cd "$fetched_clone" && "$scripts/slice-tree.sh" --claim "$work/trees/T-4-s1-dave" "$race_branch" origin/main) >/dev/null 2>&1
check "a claim is refused when the branch is on origin" '[ $? -ne 0 ] && [ ! -e "$work/trees/T-4-s1-dave" ]'

(cd "$race" && "$scripts/slice-tree.sh" --claim "$alice_tree" feat/T-4-b-s2 origin/main) >/dev/null 2>&1
check "a claim is refused when the tree path is already registered, and that tree is kept" '[ $? -ne 0 ] && [ "$(git -C "$alice_tree" branch --show-current)" = "$race_branch" ] && [ -z "$(git -C "$race" rev-parse --verify -q refs/heads/feat/T-4-b-s2)" ]'

g "$race" branch -q feat/T-4-c-s3 main
g "$race" commit -q --allow-empty -m "main moves on"
idle_tip="$(git -C "$race" rev-parse feat/T-4-c-s3)"
(cd "$race" && "$scripts/slice-tree.sh" --claim "$work/trees/T-4-s3-erin" feat/T-4-c-s3 main) >/dev/null 2>&1
check "a claim is refused when the branch exists locally in no tree, and the branch is not moved" '[ $? -ne 0 ] && [ ! -e "$work/trees/T-4-s3-erin" ] && [ "$(git -C "$race" rev-parse feat/T-4-c-s3)" = "$idle_tip" ]'

out="$(cd "$race" && "$scripts/slice-tree.sh" "$alice_tree" "$race_branch" origin/main 2>/dev/null)"
check "without --claim the holder's own tree still resumes" '[ $? -eq 0 ] && [ "$out" = "$alice_tree" ]'

# The resume path that fast-forwards a stale local branch prints only the path
git -C "$race" worktree remove --force "$alice_tree"
git -C "$fetched_clone" checkout -q -b more "origin/$race_branch"
g "$fetched_clone" commit -q --allow-empty -m "more s1 work"
git -C "$fetched_clone" push -q origin "HEAD:refs/heads/$race_branch" >/dev/null 2>&1
git -C "$race" fetch -q origin
ff_tree="$work/trees/T-4-s1-alice-resume"
out="$(cd "$race" && "$scripts/slice-tree.sh" "$ff_tree" "$race_branch" origin/main 2>/dev/null)"
check "slice-tree.sh prints only the tree path when it fast-forwards a stale local branch" '[ "$out" = "$ff_tree" ] && [ "$(git -C "$ff_tree" rev-parse HEAD)" = "$(git -C "$race" rev-parse "origin/$race_branch")" ]'

[ "$failures" -eq 0 ] && echo "all slice script tests passed" || { echo "$failures failed"; exit 1; }
