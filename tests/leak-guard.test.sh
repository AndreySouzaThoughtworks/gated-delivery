#!/usr/bin/env bash
set -uo pipefail

guard="$(cd "$(dirname "$0")/.." && pwd)/scripts/leak-guard.sh"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
failures=0

expect_exit() {
  local name="$1" expected="$2"; shift 2
  "$@" >/dev/null 2>&1
  local actual=$?
  if [ "$actual" -eq "$expected" ]; then echo "ok   $name"; else echo "FAIL $name (exit $actual, want $expected)"; failures=$((failures + 1)); fi
}

mkdir -p "$work/repo"
printf 'acme\nACME-[0-9]+\n\n' > "$work/denylist"
echo "generic content" > "$work/repo/clean.md"

expect_exit "clean tree passes with a blank denylist line" 0 env GATED_DELIVERY_DENYLIST="$work/denylist" "$guard" "$work/repo"

echo "see ticket Acme-42" > "$work/repo/leak.md"
expect_exit "client term is rejected case-insensitively" 1 env GATED_DELIVERY_DENYLIST="$work/denylist" "$guard" "$work/repo"
rm "$work/repo/leak.md"

expect_exit "missing denylist fails closed" 2 env GATED_DELIVERY_DENYLIST="$work/absent" "$guard" "$work/repo"
: > "$work/empty"
expect_exit "empty denylist fails closed" 2 env GATED_DELIVERY_DENYLIST="$work/empty" "$guard" "$work/repo"

printf 'acme\n(unclosed\n' > "$work/bad-denylist"
expect_exit "invalid denylist pattern fails closed" 2 env GATED_DELIVERY_DENYLIST="$work/bad-denylist" "$guard" "$work/repo"

echo "locked" > "$work/repo/locked.md"
chmod 000 "$work/repo/locked.md"
expect_exit "unreadable file alone fails closed" 2 env GATED_DELIVERY_DENYLIST="$work/denylist" "$guard" "$work/repo"
echo "see ticket Acme-42" > "$work/repo/leak.md"
expect_exit "a leak is reported even when another file is unreadable" 1 env GATED_DELIVERY_DENYLIST="$work/denylist" "$guard" "$work/repo"
rm -f "$work/repo/leak.md"
chmod 600 "$work/repo/locked.md"

git_repo="$work/git"
git init -q --template= "$git_repo"
printf 'ignored/\n' > "$git_repo/.gitignore"
mkdir -p "$git_repo/ignored"
echo "acme notes" > "$git_repo/ignored/scratch.md"
git -C "$git_repo" add .gitignore
expect_exit "in a repo, git-ignored files are not scanned" 0 env GATED_DELIVERY_DENYLIST="$work/denylist" "$guard" "$git_repo"

echo "acme leak" > "$git_repo/staged.md"
git -C "$git_repo" add staged.md
echo "clean now" > "$git_repo/staged.md"
expect_exit "in a repo, the staged content is scanned, not the working copy" 1 env GATED_DELIVERY_DENYLIST="$work/denylist" "$guard" "$git_repo"

history_repo="$work/history"
git init -q --template= "$history_repo"
git -C "$history_repo" config user.email t@example.com
git -C "$history_repo" config user.name t
git -C "$history_repo" config commit.gpgsign false
echo "acme leak" > "$history_repo/notes.md"
git -C "$history_repo" add notes.md
git -C "$history_repo" commit -q -m leak
echo "clean" > "$history_repo/notes.md"
git -C "$history_repo" commit -q -am clean
expect_exit "a revision argument scans that commit, so a leak removed later is still caught" 1 env GATED_DELIVERY_DENYLIST="$work/denylist" "$guard" "$history_repo" HEAD~1
expect_exit "a revision argument passes a clean commit" 0 env GATED_DELIVERY_DENYLIST="$work/denylist" "$guard" "$history_repo" HEAD
expect_exit "an unknown revision fails closed" 2 env GATED_DELIVERY_DENYLIST="$work/denylist" "$guard" "$history_repo" no-such-rev

expect_report() {
  local name="$1" expected="$2" reported="$3" unreported="$4"; shift 4
  local report actual
  report="$("$@" 2>&1 >/dev/null)"
  actual=$?
  if [ "$actual" -ne "$expected" ]; then echo "FAIL $name (exit $actual, want $expected)"; failures=$((failures + 1)); return; fi
  if [ -n "$reported" ] && [[ "$report" != *"$reported"* ]]; then echo "FAIL $name (report lacks $reported)"; failures=$((failures + 1)); return; fi
  if [ -n "$unreported" ] && [[ "$report" == *"$unreported"* ]]; then echo "FAIL $name (report names $unreported)"; failures=$((failures + 1)); return; fi
  echo "ok   $name"
}

sha512_base64_chars=86
hashed_term="\"integrity\": \"sha512-q0AcMe$(printf "%0$((sha512_base64_chars - 6))d" 0)==\""
short_hashed_term='"integrity": "sha512-q0AcMe9+/Zx=="'
fixture_dir="evals/fixtures/scenario"
integrity_line=4

write_lockfile() {
  local path="$1" package="$2" integrity="$3"
  mkdir -p "$(dirname "$path")"
  printf '{\n  "packages": {\n    "node_modules/%s": {\n      %s\n    }\n  }\n}\n' "$package" "$integrity" > "$path"
}

write_lockfile "$work/lock-hash/$fixture_dir/package-lock.json" x "$hashed_term"
expect_report "a client term inside a fixture lockfile integrity hash is skipped" 0 "" "" env GATED_DELIVERY_DENYLIST="$work/denylist" "$guard" "$work/lock-hash"
expect_report "a skipped integrity hash is reported with its file and line" 0 "leak-guard: skipped lockfile integrity hash at $fixture_dir/package-lock.json:$integrity_line" "" env GATED_DELIVERY_DENYLIST="$work/denylist" "$guard" "$work/lock-hash"

write_lockfile "$work/lock-elsewhere/$fixture_dir/package-lock.json" acme "$hashed_term"
expect_report "a client term elsewhere in a fixture lockfile is still caught" 1 '"node_modules/acme"' "sha512-" env GATED_DELIVERY_DENYLIST="$work/denylist" "$guard" "$work/lock-elsewhere"

mkdir -p "$work/not-lock/$fixture_dir"
printf '{\n  %s\n}\n' "$hashed_term" > "$work/not-lock/$fixture_dir/notes.json"
write_lockfile "$work/not-lock/$fixture_dir/package-lock.json" x "$hashed_term"
expect_report "an integrity key outside package-lock.json is still scanned" 1 "notes.json" "package-lock.json:$integrity_line:" env GATED_DELIVERY_DENYLIST="$work/denylist" "$guard" "$work/not-lock"

write_lockfile "$work/lock-outside/package-lock.json" x "$hashed_term"
expect_report "a client term in a lockfile integrity hash outside evals/fixtures is caught" 1 "package-lock.json:$integrity_line:" "" env GATED_DELIVERY_DENYLIST="$work/denylist" "$guard" "$work/lock-outside"

write_lockfile "$work/lock-short/$fixture_dir/package-lock.json" x "$short_hashed_term"
expect_report "a client term in a malformed or short integrity hash is caught" 1 "package-lock.json:$integrity_line:" "" env GATED_DELIVERY_DENYLIST="$work/denylist" "$guard" "$work/lock-short"

exit "$failures"
