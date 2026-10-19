#!/usr/bin/env bash
# Create, or reuse, the writing worktree for one slice of a parallel wave.
#
# Usage: slice-tree.sh <slice-tree> <branch> [<base>]    run from inside the repository
#
# Reuses a local branch, resumes a branch that exists only on origin at its
# pushed tip, or creates the branch from <base> (default origin/main). Prints
# the tree's path on success. Exits non-zero with the reason on stderr, which
# the caller treats as a STOP.
set -euo pipefail
. "$(dirname "$0")/tree-common.sh"

SLICE_TREE="$(physical_path "${1:?usage: slice-tree.sh <slice-tree> <branch> [<base>]}")"
BRANCH="${2:?usage: slice-tree.sh <slice-tree> <branch> [<base>]}"
BASE="${3:-origin/main}"
REPO="$(main_checkout)"

assert_outside_repo "$SLICE_TREE" "$REPO"

if is_registered_worktree "$SLICE_TREE"; then
  CURRENT="$(git -C "$SLICE_TREE" branch --show-current)"
  if [ "$CURRENT" != "$BRANCH" ]; then
    echo "$SLICE_TREE holds $CURRENT, not $BRANCH" >&2
    exit 1
  fi
elif git show-ref --verify --quiet "refs/heads/$BRANCH"; then
  # git refuses a branch already checked out in another tree, which is the
  # guard against two writers on one slice.
  git worktree add "$SLICE_TREE" "$BRANCH"
elif git show-ref --verify --quiet "refs/remotes/origin/$BRANCH"; then
  # Another machine pushed this slice: continue from its tip, never re-create
  # it from the base, which would diverge from the pushed branch.
  git worktree add -b "$BRANCH" "$SLICE_TREE" "origin/$BRANCH"
  git -C "$SLICE_TREE" branch --set-upstream-to "origin/$BRANCH" >/dev/null
else
  git worktree add -b "$BRANCH" "$SLICE_TREE" "$BASE"
fi

link_node_modules "$SLICE_TREE" "$(deps_of "$REPO")" keep-own-install
echo "$SLICE_TREE"
