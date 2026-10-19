#!/usr/bin/env bash
# Run one command while holding this machine's verify lock, so verify runs from
# parallel slices never share ports, containers or a boot-smoke app at once.
#
# Usage: verify-lock.sh '<command>'
#
# Exits with the command's status, or 75 when the lock stays held past the
# timeout. mkdir is the lock because it is atomic everywhere; flock is not on
# macOS.
set -uo pipefail

LOCK="${GATED_DELIVERY_VERIFY_LOCK:-$HOME/.local/state/gated-delivery/verify.lock}"
TIMEOUT_S="${GATED_DELIVERY_VERIFY_LOCK_TIMEOUT_S:-1800}"
LOCK_TIMED_OUT=75
COMMAND="${1:?usage: verify-lock.sh '<command>'}"

mkdir -p "$(dirname "$LOCK")"

holder_is_alive() {
  local pid
  pid="$(cat "$LOCK/pid" 2>/dev/null || true)"
  # A lock dir with no pid yet is a holder between mkdir and its write.
  [ -z "$pid" ] && return 0
  kill -0 "$pid" 2>/dev/null
}

waited=0
announced=""
until mkdir "$LOCK" 2>/dev/null; do
  if ! holder_is_alive; then
    rm -rf "$LOCK"
    continue
  fi
  if [ "$waited" -ge "$TIMEOUT_S" ]; then
    echo "verify lock $LOCK still held by pid $(cat "$LOCK/pid" 2>/dev/null) after ${TIMEOUT_S}s" >&2
    exit "$LOCK_TIMED_OUT"
  fi
  if [ -z "$announced" ]; then
    echo "waiting for verify lock held by pid $(cat "$LOCK/pid" 2>/dev/null)" >&2
    announced=1
  fi
  sleep 1
  waited=$((waited + 1))
done

echo $$ > "$LOCK/pid"
trap 'rm -rf "$LOCK"' EXIT
trap 'exit 130' INT TERM

bash -c "$COMMAND"
