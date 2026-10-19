#!/usr/bin/env bash
# Create, or re-point, this slice's review worktree and make it runnable.
#
# Usage: review-tree.sh <review-tree> [<sha>]    run from inside the repository
#
# Prints the tree's path on success. Exits non-zero with the reason on stderr
# when the tree cannot be made ready, which every caller treats as a STOP.
set -euo pipefail
. "$(dirname "$0")/tree-common.sh"

REVIEW_TREE="${1:?usage: review-tree.sh <review-tree> [<sha>]}"
REPO="$(main_checkout)"
SHA="$(git rev-parse "${2:-HEAD}")"

assert_outside_repo "$REVIEW_TREE" "$REPO"

# Detached, because the slice branch is checked out in a writing tree and git
# refuses to hand the same branch to a second worktree. Re-point rather than
# add: every STOP in step 7 leaves the tree registered.
if is_registered_worktree "$REVIEW_TREE"; then
  git -C "$REVIEW_TREE" checkout --detach "$SHA"
else
  git worktree add --detach "$REVIEW_TREE" "$SHA"
fi

link_node_modules "$REVIEW_TREE" "$REPO"
echo "$REVIEW_TREE"
