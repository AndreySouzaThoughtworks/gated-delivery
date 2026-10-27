#!/usr/bin/env bash
# Create, or re-point, this slice's review worktree and make it runnable.
#
# Usage: review-tree.sh <review-tree> [<sha>]
#   run from the slice's writing tree: the main checkout, or its slice tree in
#   a parallel wave. <sha> defaults to that tree's HEAD.
#
# Prints the tree's path on success. Exits non-zero with the reason on stderr
# when the tree cannot be made ready, which every caller treats as a STOP.
set -euo pipefail
. "$(dirname "$0")/tree-common.sh"

REVIEW_TREE="$(physical_path "${1:?usage: review-tree.sh <review-tree> [<sha>]}")"
WRITING_TREE="$(git rev-parse --show-toplevel)"
SHA="$(git rev-parse "${2:-HEAD}")"

MAIN_CHECKOUT="$(main_checkout)"
assert_outside_repo "${REVIEW_TREE}" "${MAIN_CHECKOUT}"
assert_outside_repo "${REVIEW_TREE}" "${WRITING_TREE}"

# Detached, because the slice branch is checked out in the writing tree and
# git refuses to hand the same branch to a second worktree. Re-point rather
# than add: every STOP in step 7 leaves the tree registered.
WORKTREES="$(git worktree list --porcelain)"
if grep -qxF "worktree ${REVIEW_TREE}" <<<"${WORKTREES}"; then
  git -C "${REVIEW_TREE}" checkout --detach "${SHA}" >&2
else
  git worktree add --detach "${REVIEW_TREE}" "${SHA}" >&2
fi

# The writing tree's dependencies, so a slice that installed its own is
# graded against them.
WRITING_DEPS="$(deps_of "${WRITING_TREE}")"
link_node_modules "${REVIEW_TREE}" "${WRITING_DEPS}"
echo "${REVIEW_TREE}"
