#!/usr/bin/env bash

readonly LIVE_OPT_IN_VARIABLE=GATED_DELIVERY_ALLOW_LIVE_CLAUDE
readonly LIVE_OPT_IN_VALUE=1
readonly EXIT_LIVE_NOT_ALLOWED=64

if [[ "${!LIVE_OPT_IN_VARIABLE:-}" != "${LIVE_OPT_IN_VALUE}" ]]; then
  echo "${BASH_SOURCE[1]}: refusing to start. Rule: a test that launches a real claude -p session spends your logged-in subscription, so it runs only on request. Fix: rerun with ${LIVE_OPT_IN_VARIABLE}=${LIVE_OPT_IN_VALUE} to accept that usage." >&2
  exit "${EXIT_LIVE_NOT_ALLOWED}"
fi
