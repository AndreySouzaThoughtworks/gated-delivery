#!/usr/bin/env bash
# Pick one parallel batch's commits onto the slice branch, in order.
#
# Usage: batch-pick.sh <batch-branch> <batch-base>    run from the slice's writing tree
#
# Cherry-picks the batch's commits the slice does not yet carry, oldest first,
# keeping one commit per AC. "Carry" is by patch, not SHA: a batch already
# picked has new SHAs on the slice, and picking it again would build its ACs
# twice. Prints "<before>..<after>", the batch's range on the slice for 6.4;
# a batch with nothing left to pick prints an empty range.
#
# Exits 1 on a dirty tree, a missing branch, or a pick that fails for any
# reason but a conflict (a hook, signing), with git's reason on stderr.
# Exits 3 on a conflict. Either way HEAD and the tree are restored exactly.
set -uo pipefail

BATCH_BRANCH="${1:?usage: batch-pick.sh <batch-branch> <batch-base>}"
BATCH_BASE="${2:?usage: batch-pick.sh <batch-branch> <batch-base>}"
PICK_FAILED=1
PICK_CONFLICT=3

if [ -n "$(git status --porcelain)" ]; then
  echo "writing tree has uncommitted changes; commit or stash them before picking" >&2
  exit "$PICK_FAILED"
fi
for ref in "$BATCH_BRANCH" "$BATCH_BASE"; do
  if ! git rev-parse --verify -q "$ref^{commit}" >/dev/null; then
    echo "no such commit or branch: $ref" >&2
    exit "$PICK_FAILED"
  fi
done

BEFORE="$(git rev-parse HEAD)"
TO_PICK="$(git cherry HEAD "$BATCH_BRANCH" "$BATCH_BASE" | sed -n 's/^+ //p')"
if [ -z "$TO_PICK" ]; then
  echo "$BEFORE..$BEFORE"
  exit 0
fi

# shellcheck disable=SC2086
if ! ERR="$(git cherry-pick --empty=drop $TO_PICK 2>&1 >/dev/null)"; then
  CONFLICTED="$(git diff --name-only --diff-filter=U)"
  git cherry-pick --abort >/dev/null 2>&1
  git reset -q --hard "$BEFORE"
  if [ -n "$CONFLICTED" ]; then
    echo "$BATCH_BRANCH conflicts with the slice at $BEFORE in: $CONFLICTED" >&2
    exit "$PICK_CONFLICT"
  fi
  echo "picking $BATCH_BRANCH failed: $ERR" >&2
  exit "$PICK_FAILED"
fi
echo "$BEFORE..$(git rev-parse HEAD)"
