#!/usr/bin/env bash
# Run one command while holding this machine's verify lock, so verify runs from
# parallel slices never share ports, containers or a booted application.
#
# Usage: verify-lock.sh '<command>'
#
# Exits with the command's status, or 75 when the lock stays held past the
# timeout. The lock is a kernel flock on a file, taken through perl because
# macOS ships no flock(1): the kernel releases it when the last process
# holding it exits, so a killed holder never leaves it behind, and the
# command inherits it, so an orphaned test run keeps it until it really ends.
set -uo pipefail

LOCK="${GATED_DELIVERY_VERIFY_LOCK:-$HOME/.local/state/gated-delivery/verify.lock}"
TIMEOUT_S="${GATED_DELIVERY_VERIFY_LOCK_TIMEOUT_S:-1800}"
COMMAND="${1:?usage: verify-lock.sh '<command>'}"

mkdir -p "$(dirname "$LOCK")"

exec perl -e '
  use Fcntl qw(:flock);
  my ($lock, $timeout, $command) = @ARGV;
  my $lock_timed_out = 75;
  $^F = 255;  # keep the lock open across exec, so the command holds it
  open(my $fh, ">>", $lock) or die "cannot open $lock: $!\n";
  my $waited = 0;
  until (flock($fh, LOCK_EX | LOCK_NB)) {
    if ($waited >= $timeout) {
      print STDERR "verify lock $lock still held after ${timeout}s\n";
      exit $lock_timed_out;
    }
    print STDERR "waiting for verify lock $lock\n" if $waited == 0;
    sleep 1;
    $waited++;
  }
  exec("bash", "-c", $command) or die "cannot run bash: $!\n";
' "$LOCK" "$TIMEOUT_S" "$COMMAND"
