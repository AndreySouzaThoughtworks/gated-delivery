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

readonly GH_OPT_IN_VARIABLE=GATED_DELIVERY_ALLOW_LIVE_GH
readonly EXIT_SANDBOX_UNSAFE=65
readonly GH_TEST=live-gh
readonly SAFE_VIEW='{"isPrivate":true,"isFork":false,"name":"aifsd-e2e-sandbox","nameWithOwner":"o/aifsd-e2e-sandbox","defaultBranchRef":{"name":"main"}}'
readonly PUBLIC_VIEW='{"isPrivate":false,"isFork":false,"name":"aifsd-e2e-sandbox","nameWithOwner":"o/aifsd-e2e-sandbox","defaultBranchRef":{"name":"main"}}'
readonly FORK_VIEW='{"isPrivate":true,"isFork":true,"name":"aifsd-e2e-sandbox","nameWithOwner":"o/aifsd-e2e-sandbox","defaultBranchRef":{"name":"main"}}'
readonly UNNAMED_VIEW='{"isPrivate":true,"isFork":false,"name":"production","nameWithOwner":"o/production","defaultBranchRef":{"name":"main"}}'

cat > "${work}/bin/gh" <<STUB
#!/usr/bin/env bash
echo "\$*" >> "${work}/gh-calls"
printf '%s' "\${STUB_GH_VIEW}"
STUB
chmod +x "${work}/bin/gh"

run_gh_test() {
  rm -f "${work}/gh-calls"
  env -u "${GH_OPT_IN_VARIABLE}" "$@" PATH="${work}/bin:${PATH}" bash "${tests_dir}/${GH_TEST}.test.sh" >"${work}/output" 2>&1
}

only_read_only_calls() {
  [[ -f "${work}/gh-calls" ]] && ! grep -qvE '^repo view ' "${work}/gh-calls"
}

no_write_calls() {
  [[ ! -e "${work}/gh-calls" ]] || ! grep -qE '^(api|pr (create|close))|graphql|--method|-X' "${work}/gh-calls"
}

run_gh_test STUB_GH_VIEW="${SAFE_VIEW}"
status=$?
[[ "${status}" -eq "${EXIT_REFUSED}" && ! -e "${work}/gh-calls" ]]
check "${GH_TEST} refuses without the opt-in and never calls gh" "$?"
no_write_calls
check "${GH_TEST} sends no review comment, thread mutation or pull request write without the opt-in" "$?"
grep -q "${GH_TEST}.test.sh: refusing to start.*Fix: rerun with ${GH_OPT_IN_VARIABLE}=1" "${work}/output"
check "${GH_TEST} names its file, the rule and the fix" "$?"

run_gh_test "${GH_OPT_IN_VARIABLE}=0" STUB_GH_VIEW="${SAFE_VIEW}"
status=$?
[[ "${status}" -eq "${EXIT_REFUSED}" && ! -e "${work}/gh-calls" ]]
check "${GH_TEST} refuses when the variable holds another value" "$?"

for unsafe in "public:${PUBLIC_VIEW}" "fork:${FORK_VIEW}" "misnamed:${UNNAMED_VIEW}"; do
  run_gh_test "${GH_OPT_IN_VARIABLE}=1" STUB_GH_VIEW="${unsafe#*:}"
  status=$?
  [[ "${status}" -eq "${EXIT_SANDBOX_UNSAFE}" ]] && only_read_only_calls
  check "${GH_TEST} refuses a ${unsafe%%:*} repository before any write" "$?"
  no_write_calls
  check "${GH_TEST} sends no review comment or thread mutation for a ${unsafe%%:*} repository" "$?"
  grep -q "refusing to write to .*Rule: .*private repository that is not a fork.*Fix: set GATED_DELIVERY_GH_SANDBOX=<owner>/<name>" "${work}/output"
  check "${GH_TEST} names the rule and the fix for a ${unsafe%%:*} repository" "$?"
done

run_gh_test "${GH_OPT_IN_VARIABLE}=1" GATED_DELIVERY_GH_SANDBOX=not-a-repo-name STUB_GH_VIEW="${SAFE_VIEW}"
status=$?
[[ "${status}" -eq "${EXIT_SANDBOX_UNSAFE}" && ! -e "${work}/gh-calls" ]]
check "${GH_TEST} refuses a sandbox name that is not owner/name before calling gh" "$?"

exit "${failures}"
