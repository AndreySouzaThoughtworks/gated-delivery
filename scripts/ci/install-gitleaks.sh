#!/usr/bin/env bash
set -euo pipefail

readonly GITLEAKS_VERSION=8.30.1
readonly GITLEAKS_ARCHIVE_SHA256=551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb
readonly GITLEAKS_ARCHIVE="gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz"
readonly DOWNLOAD_BASE="${GITLEAKS_DOWNLOAD_BASE:-https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}}"
readonly INSTALL_DIR="${GITLEAKS_INSTALL_DIR:?scripts/ci/install-gitleaks.sh needs GITLEAKS_INSTALL_DIR; set it to the directory that receives the binary}"

download="$(mktemp -d)"
trap 'rm -rf "$download"' EXIT

curl --fail --silent --show-error --location --output "${download}/${GITLEAKS_ARCHIVE}" "${DOWNLOAD_BASE}/${GITLEAKS_ARCHIVE}"

actual="$(sha256sum "${download}/${GITLEAKS_ARCHIVE}" | cut -d' ' -f1)"
if [[ "${actual}" != "${GITLEAKS_ARCHIVE_SHA256}" ]]; then
  echo "scripts/ci/install-gitleaks.sh: checksum mismatch for ${GITLEAKS_ARCHIVE}: expected ${GITLEAKS_ARCHIVE_SHA256}, got ${actual}. Rule: the archive must match the pinned release checksum. Fix: do not install it; if the release is legitimate, copy the new checksum from the release's gitleaks_${GITLEAKS_VERSION}_checksums.txt." >&2
  exit 1
fi

mkdir -p "${INSTALL_DIR}"
tar --extract --gzip --file "${download}/${GITLEAKS_ARCHIVE}" --directory "${INSTALL_DIR}" gitleaks

if [[ -n "${GITHUB_PATH:-}" ]]; then echo "${INSTALL_DIR}" >> "${GITHUB_PATH}"; fi
