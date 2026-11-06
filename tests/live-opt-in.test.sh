#!/usr/bin/env bash
set -uo pipefail

readonly EXIT_REFUSED=64
readonly EXIT_NOT_LOGGED_IN=3
readonly OPT_IN_VARIABLE=GATED_DELIVERY_ALLOW_LIVE_CLAUDE
readonly LIVE_TESTS=(commit-convention code-reviewer-scope issue-writing)

tests_dir="$(cd "$(dirname "$0")" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
failures=0

check() {
  local name="$1" status="$2"
  if [[ "${status}" -eq 0 ]]; then echo "ok   ${name}"; else echo "FAIL ${name}"; failures=$((failures + 1)); fi
}

mkdir "${work}/bin"
printf '#!/usr/bin/env bash\ntouch "%s/claude-was-launched"\necho "Not logged in"\n' "${work}" > "${work}/bin/claude"
chmod +x "${work}/bin/claude"

run_test() {
  local name="$1"
  shift
  rm -f "${work}/claude-was-launched"
  env -u "${OPT_IN_VARIABLE}" "$@" PATH="${work}/bin:${PATH}" bash "${tests_dir}/${name}.test.sh" >"${work}/output" 2>&1
}

for name in "${LIVE_TESTS[@]}"; do
  run_test "${name}"
  status=$?
  [[ "${status}" -eq "${EXIT_REFUSED}" && ! -e "${work}/claude-was-launched" ]]
  check "${name} refuses without the opt-in and never launches claude" "$?"
  grep -q "${name}.test.sh: refusing to start.*Fix: rerun with ${OPT_IN_VARIABLE}=1" "${work}/output"
  check "${name} names its file, the rule and the fix" "$?"

  run_test "${name}" "${OPT_IN_VARIABLE}=0"
  status=$?
  [[ "${status}" -eq "${EXIT_REFUSED}" && ! -e "${work}/claude-was-launched" ]]
  check "${name} refuses when the variable holds another value" "$?"

  run_test "${name}" "${OPT_IN_VARIABLE}=1"
  status=$?
  [[ "${status}" -eq "${EXIT_NOT_LOGGED_IN}" && -e "${work}/claude-was-launched" ]]
  check "${name} proceeds to its login probe with the opt-in" "$?"
done

exit "${failures}"
