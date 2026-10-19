# Shared by review-tree.sh and slice-tree.sh. Source it; it defines functions only.

# Outside the repository: a worktree nested under one carrying a
# pnpm-workspace.yaml is captured by that workspace, and pnpm install then
# exits 0 having installed nothing.
assert_outside_repo() {
  local tree="$1" repo="$2"
  case "$tree" in
    "$repo"/*) echo "worktree must sit outside $repo" >&2; return 1 ;;
    /*) ;;
    *) echo "worktree must be an absolute path, got: $tree" >&2; return 1 ;;
  esac
}

# The main checkout, not the current worktree: a slice tree is itself a
# worktree, and its node_modules is a link back to the main checkout's.
main_checkout() {
  dirname "$(cd "$(git rev-parse --git-common-dir)" && pwd -P)"
}

# The link's target, not its existence: a reused tree can hold a real
# node_modules, or a link to a tree that has moved, and either has the gate
# verify against dependencies the orchestrator does not have.
link_node_modules() {
  local tree="$1" repo="$2"
  local link="$tree/node_modules"
  if [ "$(readlink "$link" 2>/dev/null || true)" != "$repo/node_modules" ]; then
    rm -rf "${link:?}"
    ln -s "$repo/node_modules" "$link"
  fi
}

is_registered_worktree() {
  git worktree list --porcelain | grep -qxF "worktree $1"
}
