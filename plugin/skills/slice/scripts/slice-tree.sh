#!/usr/bin/env bash
# Create, or reuse, a slice, batch or spec writing worktree.
#
# Usage: slice-tree.sh [--claim] <slice-tree> <branch> [<base>]    run from inside the repository
#
# Reuses a local branch, resumes a branch that exists only on origin at its
# pushed tip, or creates the branch from <base> (default origin/main). Prints
# the tree's path on success. Exits non-zero with the reason on stderr, which
# the caller treats as a STOP.
#
# --claim only creates: it refuses when the branch exists locally or on origin,
# or the tree path is already a worktree, so a claim never reuses another
# actor's tree or branch.
set -euo pipefail
. "$(dirname "$0")/tree-common.sh"

USAGE="usage: slice-tree.sh [--claim] <slice-tree> <branch> [<base>]"
CLAIM=false
if [ "${1:-}" = --claim ]; then CLAIM=true; shift; fi
SLICE_TREE="$(physical_path "${1:?$USAGE}")"
BRANCH="${2:?$USAGE}"
BASE="${3:-origin/main}"
REPO="$(main_checkout)"

assert_outside_repo "$SLICE_TREE" "$REPO"

if $CLAIM; then
  if is_registered_worktree "$SLICE_TREE"; then
    echo "claim refused: $SLICE_TREE is already a worktree" >&2
    exit 1
  fi
  # ls-remote exits 2 only when the ref is absent; any other failure refuses.
  remote_status=0
  git ls-remote --exit-code origin "refs/heads/$BRANCH" >/dev/null || remote_status=$?
  if [ "$remote_status" -ne 2 ]; then
    echo "claim refused: $BRANCH is on origin, or origin could not be checked" >&2
    exit 1
  fi
  # -b, never -B: it refuses a branch that already exists locally.
  git worktree add --no-track -b "$BRANCH" "$SLICE_TREE" "$BASE" >&2
elif is_registered_worktree "$SLICE_TREE"; then
  CURRENT="$(git -C "$SLICE_TREE" branch --show-current)"
  if [ "$CURRENT" != "$BRANCH" ]; then
    echo "$SLICE_TREE holds $CURRENT, not $BRANCH" >&2
    exit 1
  fi
elif git show-ref --verify --quiet "refs/heads/$BRANCH"; then
  # Another machine may have pushed more of this slice since the local branch
  # was last touched: continue from the newer tip, and stop rather than pick a
  # side when the two diverged.
  if git show-ref --verify --quiet "refs/remotes/origin/$BRANCH"; then
    if git merge-base --is-ancestor "$BRANCH" "origin/$BRANCH"; then
      git branch -f "$BRANCH" "origin/$BRANCH" >&2
    elif ! git merge-base --is-ancestor "origin/$BRANCH" "$BRANCH"; then
      echo "$BRANCH and origin/$BRANCH diverged; reconcile them before resuming" >&2
      exit 1
    fi
  fi
  # git refuses a branch already checked out in another tree, which is the
  # guard against two writers on one slice.
  git worktree add "$SLICE_TREE" "$BRANCH" >&2
elif git show-ref --verify --quiet "refs/remotes/origin/$BRANCH"; then
  # Another machine pushed this slice: continue from its tip, never re-create
  # it from the base, which would diverge from the pushed branch.
  git worktree add -b "$BRANCH" "$SLICE_TREE" "origin/$BRANCH" >&2
  git -C "$SLICE_TREE" branch --set-upstream-to "origin/$BRANCH" >/dev/null
else
  # --no-track: a branch made from origin/main would otherwise track it, and
  # with push.default=upstream its first push would land on main.
  git worktree add --no-track -b "$BRANCH" "$SLICE_TREE" "$BASE" >&2
fi

# The calling tree's dependencies: the main checkout's for a slice tree, the
# slice tree's own install for a batch tree cut from it.
link_node_modules "$SLICE_TREE" "$(deps_of "$(git rev-parse --show-toplevel)")" keep-own-install
echo "$SLICE_TREE"
