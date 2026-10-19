#!/usr/bin/env bash
# Pick one parallel batch's commits onto the slice branch, in order.
#
# Usage: batch-pick.sh <batch-branch> <batch-base>    run from the slice's writing tree
#
# Cherry-picks <batch-base>..<batch-branch> onto HEAD, keeping one commit per
# AC. Prints "<before>..<after>", the batch's range on the slice for 6.4.
# Exits 1 on a dirty tree, and 3 on a conflict after restoring HEAD exactly:
# the caller then runs that batch again, sequentially, on the new tip.
set -euo pipefail

BATCH_BRANCH="${1:?usage: batch-pick.sh <batch-branch> <batch-base>}"
BATCH_BASE="${2:?usage: batch-pick.sh <batch-branch> <batch-base>}"
PICK_CONFLICT=3

if [ -n "$(git status --porcelain)" ]; then
  echo "writing tree has uncommitted changes; commit or stash them before picking" >&2
  exit 1
fi

BEFORE="$(git rev-parse HEAD)"
if ! git cherry-pick "$BATCH_BASE..$BATCH_BRANCH" >/dev/null 2>&1; then
  git cherry-pick --abort >/dev/null 2>&1 || true
  git reset -q --hard "$BEFORE"
  echo "$BATCH_BRANCH conflicts with the slice at $BEFORE" >&2
  exit "$PICK_CONFLICT"
fi
echo "$BEFORE..$(git rev-parse HEAD)"
