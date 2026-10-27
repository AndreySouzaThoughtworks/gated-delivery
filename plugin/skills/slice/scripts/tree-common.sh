#!/usr/bin/env bash
# Shared by review-tree.sh and slice-tree.sh. Source it; it defines functions only.

# Outside the repository: a worktree nested under one carrying a
# pnpm-workspace.yaml is captured by that workspace, and pnpm install then
# exits 0 having installed nothing.
assert_outside_repo() {
  local tree="$1" repo="$2"
  case "${tree}" in
    "${repo}"/*) echo "worktree must sit outside ${repo}" >&2; return 1 ;;
    /*) ;;
    *) echo "worktree must be an absolute path, got: ${tree}" >&2; return 1 ;;
  esac
}

# git lists worktrees by physical path, so /tmp/x and /private/tmp/x are one
# tree on macOS. The parent is created so the path can be resolved before the
# tree exists.
physical_path() {
  local parent name resolved
  parent="$(dirname "$1")"
  name="$(basename "$1")"
  mkdir -p "${parent}"
  resolved="$(cd "${parent}" && pwd -P)"
  echo "${resolved}/${name}"
}

# The main checkout, not the current worktree: a slice tree is itself a
# worktree, and its node_modules is a link back to the main checkout's.
main_checkout() {
  local common_dir physical
  common_dir="$(git rev-parse --git-common-dir)"
  physical="$(cd "${common_dir}" && pwd -P)"
  dirname "${physical}"
}

# Where a tree's dependencies really live: the target of its link, its own
# install, or nothing when the repository installs none.
deps_of() {
  local modules="$1/node_modules"
  if [[ -L "${modules}" ]]; then readlink "${modules}"
  elif [[ -d "${modules}" ]]; then echo "${modules}"
  fi
}

# A `node_modules/` ignore rule matches directories only, so the link would
# show as untracked and every new tree would start dirty. info/exclude lives
# in the common dir and applies to every worktree.
exclude_node_modules_link() {
  local exclude
  exclude="$(git rev-parse --git-common-dir)/info/exclude"
  mkdir -p "$(dirname "${exclude}")"
  grep -qxF '/node_modules' "${exclude}" 2>/dev/null || echo '/node_modules' >> "${exclude}"
}

# Point a tree's node_modules at <source>. The link's target is compared, not
# its existence: a stale link would have a gate verify against dependencies
# the writer does not have. With keep-own-install, a real directory is the
# tree's own install (a slice that changes the manifest) and is never removed.
link_node_modules() {
  local tree="$1" source="$2" mode="${3:-}"
  local link="${tree}/node_modules"
  [[ -n "${source}" ]] || return 0
  if [[ "${mode}" = keep-own-install ]] && [[ -d "${link}" ]] && [[ ! -L "${link}" ]]; then
    return 0
  fi
  exclude_node_modules_link
  local current=""
  if [[ -L "${link}" ]]; then current="$(readlink "${link}")"; fi
  if [[ "${current}" != "${source}" ]]; then
    rm -rf "${link:?}"
    ln -s "${source}" "${link}"
  fi
}
