#!/usr/bin/env bash
set -uo pipefail

core="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
failures=0

check() {
  local name="$1" status="$2"
  if [[ "${status}" -eq 0 ]]; then echo "ok   ${name}"; else echo "FAIL ${name}"; failures=$((failures + 1)); fi
}

release="${work}/release"
mkdir "${release}" "${work}/payload"
printf '#!/bin/sh\necho planted\n' > "${work}/payload/gitleaks"
tar --create --gzip --file "${release}/gitleaks_8.30.1_linux_x64.tar.gz" --directory "${work}/payload" gitleaks

GITLEAKS_DOWNLOAD_BASE="file://${release}" GITLEAKS_INSTALL_DIR="${work}/bin" bash "${core}/scripts/ci/install-gitleaks.sh" >"${work}/output" 2>&1
status=$?
[[ "${status}" -ne 0 && ! -e "${work}/bin/gitleaks" ]]
check "an archive that does not match the pinned checksum is not installed" "$?"
grep -q 'install-gitleaks.sh: checksum mismatch.*Fix:' "${work}/output"
check "the refusal names the file, the rule and the fix" "$?"

GITLEAKS_DOWNLOAD_BASE="file://${work}/missing" GITLEAKS_INSTALL_DIR="${work}/bin" bash "${core}/scripts/ci/install-gitleaks.sh" >/dev/null 2>&1
status=$?
[[ "${status}" -ne 0 && ! -e "${work}/bin/gitleaks" ]]
check "a failed download installs nothing" "$?"

env -u GITLEAKS_INSTALL_DIR bash "${core}/scripts/ci/install-gitleaks.sh" >"${work}/output" 2>&1
status=$?
[[ "${status}" -ne 0 ]] && grep -q 'needs GITLEAKS_INSTALL_DIR' "${work}/output"
check "a missing install directory is refused with a fix" "$?"

exit "${failures}"
