#!/usr/bin/env bash

readonly LIVE_GH_OPT_IN_VARIABLE=GATED_DELIVERY_ALLOW_LIVE_GH
readonly LIVE_GH_OPT_IN_VALUE=1
readonly EXIT_LIVE_GH_NOT_ALLOWED=64

if [[ "${!LIVE_GH_OPT_IN_VARIABLE:-}" != "${LIVE_GH_OPT_IN_VALUE}" ]]; then
  echo "${BASH_SOURCE[1]}: refusing to start. Rule: a test that runs a mutating gh command creates a branch and a draft pull request on a real GitHub repository, so it runs only on request. Fix: rerun with ${LIVE_GH_OPT_IN_VARIABLE}=${LIVE_GH_OPT_IN_VALUE} to accept those writes." >&2
  exit "${EXIT_LIVE_GH_NOT_ALLOWED}"
fi
