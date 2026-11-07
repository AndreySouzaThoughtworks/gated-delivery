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
readonly EXIT_SETUP_FAILED=67
readonly TOKEN_USER_VARIABLE=GATED_DELIVERY_PROTECTION_GH_USER
core_dir="${tests_dir%/*}"
documented_contexts="$(node -e 'import(process.argv[1] + "/scripts/audit/required-checks-parity.ts").then((m) => console.log(JSON.stringify(m.documentedChecks(process.argv[1]))))' "${core_dir}")"
contexts_json() { echo "{\"contexts\": $1}"; }
matching_contexts="$(contexts_json "${documented_contexts}")"
with_intruder="$(node -e 'console.log(JSON.stringify([...JSON.parse(process.argv[1]), "intruder-check"]))' "${documented_contexts}")"
without_first="$(node -e 'console.log(JSON.stringify(JSON.parse(process.argv[1]).slice(1)))' "${documented_contexts}")"
extra_contexts="$(contexts_json "${with_intruder}")"
missing_contexts="$(contexts_json "${without_first}")"
dropped_check="$(node -e 'console.log(JSON.parse(process.argv[1])[0])' "${documented_contexts}")"
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
echo "\$(printenv GH_TOKEN || echo unset) \$*" >> "${work}/gh-tokens"
case "\$1 \$2" in
  "auth token") printf '%s' "\${STUB_GH_TOKEN}" ;;
  "api repos/"*) printf '%s' "\${STUB_GH_PROTECTION}"; exit "\${STUB_GH_PROTECTION_STATUS:-0}" ;;
  *) printf '%s' "\${STUB_GH_VIEW}" ;;
esac
STUB
chmod +x "${work}/bin/gh"

run_gh_test() {
  rm -f "${work}/gh-calls" "${work}/gh-tokens"
  env -u "${GH_OPT_IN_VARIABLE}" -u GH_TOKEN -u GITHUB_TOKEN "$@" PATH="${work}/bin:${PATH}" bash "${tests_dir}/${GH_TEST}.test.sh" >"${work}/output" 2>&1
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
no_protection_query() {
  if [[ -e "${work}/gh-calls" ]] && grep -q 'branches/main/protection' "${work}/gh-calls"; then return 1; fi
}
no_protection_query
check "${GH_TEST} sends no branch protection query without the opt-in" "$?"
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
  no_protection_query
  check "${GH_TEST} sends no branch protection query for a ${unsafe%%:*} repository" "$?"
  grep -q "refusing to write to .*Rule: .*private repository that is not a fork.*Fix: set GATED_DELIVERY_GH_SANDBOX=<owner>/<name>" "${work}/output"
  check "${GH_TEST} names the rule and the fix for a ${unsafe%%:*} repository" "$?"
done

run_gh_test "${GH_OPT_IN_VARIABLE}=1" GATED_DELIVERY_GH_SANDBOX=not-a-repo-name STUB_GH_VIEW="${SAFE_VIEW}"
status=$?
[[ "${status}" -eq "${EXIT_SANDBOX_UNSAFE}" && ! -e "${work}/gh-calls" ]]
check "${GH_TEST} refuses a sandbox name that is not owner/name before calling gh" "$?"

readonly DENIED_ANSWER='{"message":"Not Found","status":"404"}
gh: Not Found (HTTP 404)'
readonly BROKEN_ANSWER='gh: Server Error (HTTP 500)'

run_protection_test() {
  run_gh_test "${GH_OPT_IN_VARIABLE}=1" STUB_GH_VIEW="${SAFE_VIEW}" "$@"
}

run_protection_test STUB_GH_PROTECTION="${matching_contexts}"
status=$?
[[ "${status}" -eq "${EXIT_SETUP_FAILED}" ]] && grep -q "^ok   required status checks of .* on main are the set listed in docs/development.md" "${work}/output"
check "${GH_TEST} accepts the checks of GitHub when they equal the documented set" "$?"
grep -q '^unset api repos/.*/branches/main/protection/required_status_checks$' "${work}/gh-tokens"
check "${GH_TEST} sends no token override to the protection query when ${TOKEN_USER_VARIABLE} is unset" "$?"

run_protection_test STUB_GH_PROTECTION="${extra_contexts}"
grep -q '^FAIL required status checks of .* differ from docs/development.md' "${work}/output" && grep -q 'GitHub requires "intruder-check" on main' "${work}/output"
check "${GH_TEST} fails and names a check that GitHub requires and the docs omit" "$?"

run_protection_test STUB_GH_PROTECTION="${missing_contexts}"
grep -q '^FAIL required status checks of .* differ from docs/development.md' "${work}/output" && grep -qF "lists \"${dropped_check}\", but GitHub does not require it" "${work}/output"
check "${GH_TEST} fails and names a check that the docs list and GitHub omits" "$?"

run_protection_test STUB_GH_PROTECTION="${DENIED_ANSWER}" STUB_GH_PROTECTION_STATUS=1
grep -q "^skip required status checks match docs/development.md: GitHub answered HTTP 404 for .*Account needed: .*GH_TOKEN=\\\$(gh auth token --user .*) gh api repos/.*/branches/main/protection/required_status_checks" "${work}/output" && ! grep -q '^ok   required status checks' "${work}/output"
check "${GH_TEST} prints a skip line with the account and the command when GitHub answers 404" "$?"

run_protection_test STUB_GH_PROTECTION="${BROKEN_ANSWER}" STUB_GH_PROTECTION_STATUS=1
grep -q '^FAIL required status checks match docs/development.md: gh api for .* failed: gh: Server Error (HTTP 500)' "${work}/output" && ! grep -q '^skip required status checks' "${work}/output"
check "${GH_TEST} fails, not skips, when the protection query fails for another reason" "$?"

run_protection_test "${TOKEN_USER_VARIABLE}=maintainer" STUB_GH_TOKEN=token-of-maintainer STUB_GH_PROTECTION="${matching_contexts}"
grep -q '^token-of-maintainer api repos/.*/branches/main/protection/required_status_checks$' "${work}/gh-tokens" && ! grep -v 'api repos/' "${work}/gh-tokens" | grep -q 'token-of-maintainer' && grep -q '^unset auth token --user maintainer$' "${work}/gh-tokens"
check "${GH_TEST} passes the token of ${TOKEN_USER_VARIABLE} to the protection query only" "$?"

exit "${failures}"
