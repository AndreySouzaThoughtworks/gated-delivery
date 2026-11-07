#!/usr/bin/env bash
set -uo pipefail

# shellcheck source=./require-live-gh-opt-in.sh
source "$(dirname "$0")/require-live-gh-opt-in.sh"

readonly SCRIPT_NAME=tests/live-gh.test.sh
readonly EXIT_SANDBOX_UNSAFE=65
readonly EXIT_TOOL_MISSING=66
readonly EXIT_SETUP_FAILED=67
readonly EXIT_INTERRUPTED=130
readonly DEFAULT_SANDBOX=AndreySouzaThoughtworks/aifsd-e2e-sandbox
readonly SANDBOX_VARIABLE=GATED_DELIVERY_GH_SANDBOX
readonly NOTES_REPO_VARIABLE=GATED_DELIVERY_NOTES_REPO
readonly REQUIRED_NAME_PART=sandbox
readonly BASE_BRANCH=main
readonly BRANCH_PREFIX=gated-delivery-live-gh-
readonly RANDOM_BYTES=6
readonly REPO_NAME_PATTERN='^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'
readonly NUMBER_PATTERN='^[1-9][0-9]*$'
readonly OBJECT_ID_PATTERN='^[0-9a-f]{40}$'
readonly SHOWN_TEXT_LIMIT=400
readonly PR_TITLE='test: live gh probe'
readonly COMMIT_IDENTITY=(-c user.name=gated-delivery-live-gh -c user.email=live-gh@example.invalid)
readonly THREAD_FIELDS=(isResolved comments)
readonly COMMENT_FIELDS=(url path)
readonly COMMENT_BODY='Throwaway review comment from tests/live-gh.test.sh. It lives and dies with the draft pull request.'
readonly COMMENT_LINE=1
readonly COMMENT_SIDE=RIGHT
readonly THREAD_ID_QUERY="query(\$owner: String!, \$repo: String!, \$number: Int!) { repository(owner: \$owner, name: \$repo) { pullRequest(number: \$number) { reviewThreads(first: 10) { nodes { id isResolved } } } } }"
readonly RESOLVE_THREAD_MUTATION="mutation(\$id: ID!) { resolveReviewThread(input: {threadId: \$id}) { thread { isResolved } } }"
readonly PROTECTION_USER_VARIABLE=GATED_DELIVERY_PROTECTION_GH_USER
readonly PROTECTION_PATH="branches/${BASE_BRANCH}/protection/required_status_checks"
readonly PROTECTION_DENIED_PATTERN='HTTP (403|404)'
readonly REMOTE_SLUG_PATTERN='[:/]([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)$'
readonly PARITY_SCRIPT=scripts/audit/required-checks-parity.ts
readonly IMPORT_GH_JSON='const { ghJson } = await import(process.argv[1]); console.log(JSON.stringify(ghJson(process.cwd(), JSON.parse(process.argv[2]))));'

core="$(cd "$(dirname "$0")/.." && pwd)"
scripts="${core}/plugin/scripts"
sandbox="${!SANDBOX_VARIABLE:-${DEFAULT_SANDBOX}}"
work=""
clone=""
branch=""
pr_number=""
branch_pushed=0
failures=0
skipped=0
cleanup_failed=0

refuse() {
  echo "${SCRIPT_NAME}: refusing to write to ${sandbox}: $1. Rule: this test writes one branch and one draft pull request, so it targets only a private repository that is not a fork and has ${REQUIRED_NAME_PART} in its name. Fix: set ${SANDBOX_VARIABLE}=<owner>/<name> to such a repository." >&2
  exit "${EXIT_SANDBOX_UNSAFE}"
}

setup_failed() {
  echo "${SCRIPT_NAME}: setup failed: $1. Rule: a failed step stops the run before the next write, and the cleanup trap then closes what the run created. Fix: read this message, fix the cause, rerun; if the output says cleanup failed, follow its manual steps." >&2
  exit "${EXIT_SETUP_FAILED}"
}

cleanup() {
  local status=$?
  trap - EXIT
  if [[ -n "${pr_number}" ]]; then
    gh pr close "${pr_number}" --repo "${sandbox}" >/dev/null 2>&1 || cleanup_failed=1
    closed="$(gh pr view "${pr_number}" --repo "${sandbox}" --json state --jq .state 2>&1)"
    if [[ "${closed}" == CLOSED ]]; then
      echo "ok   gh pr view prints state CLOSED for PR #${pr_number} after the cleanup closed it"
    else
      echo "FAIL gh pr view prints state CLOSED for PR #${pr_number} after the cleanup closed it: real output was ${closed:0:${SHOWN_TEXT_LIMIT}}"
      cleanup_failed=1
    fi
  fi
  if [[ "${branch_pushed}" -eq 1 ]]; then
    git -C "${clone}" push --quiet origin --delete "${branch}" >/dev/null 2>&1 || cleanup_failed=1
  fi
  if [[ "${cleanup_failed}" -eq 1 ]]; then
    echo "${SCRIPT_NAME}: cleanup failed. Rule: only PR #${pr_number:-none} and branch ${branch:-none} on ${sandbox} belong to this run. Fix: close the PR with gh pr close ${pr_number:-<number>} --repo ${sandbox}, then delete the branch with git push origin --delete ${branch:-<branch>}." >&2
    if [[ "${status}" -eq 0 ]]; then status=1; fi
  fi
  if [[ -n "${clone}" ]]; then rm -r -- "${clone}"; fi
  if [[ -n "${work}" ]]; then rm -r -- "${work}"; fi
  exit "${status}"
}

expect() {
  local name="$1" json="$2" expression="$3"
  if JSON_INPUT="${json}" EXPRESSION="${expression}" node -e 'const d = JSON.parse(process.env.JSON_INPUT); process.exit(Function("d", "return (" + process.env.EXPRESSION + ")")(d) ? 0 : 1);' 2>/dev/null; then
    echo "ok   ${name}"
  else
    echo "FAIL ${name}: expected ${expression}; real output was ${json:0:${SHOWN_TEXT_LIMIT}}"
    failures=$((failures + 1))
  fi
}

expect_when() {
  local name="$1" json="$2" guard="$3" expression="$4"
  if JSON_INPUT="${json}" GUARD="${guard}" node -e 'const d = JSON.parse(process.env.JSON_INPUT); process.exit(Function("d", "return (" + process.env.GUARD + ")")(d) ? 0 : 1);' 2>/dev/null; then
    expect "${name}" "${json}" "${expression}"
  else
    echo "skip ${name}: nothing in the real output satisfies ${guard}, so the assertion has no data to check"
    skipped=$((skipped + 1))
  fi
}

run_gate() {
  gate_status=0
  gate="$(cd "${clone}" && node "${scripts}/pr-gate.mjs" --body-file "${body_file}" --title "${PR_TITLE}" --final-slice y --pr "${pr_number}" 2>&1)" || gate_status=$?
}

run_ghjson() {
  (cd "${clone}" && node --input-type=module -e "${IMPORT_GH_JSON}" "${scripts}/slice-git.mjs" "$1" 2>&1)
}

repo_field_is() {
  node -e "const d = JSON.parse(process.argv[1]); process.exit(${2} ? 0 : 1)" "${view}" 2>/dev/null
}

checkout_slug() {
  local url
  url="$(git -C "${core}" remote get-url origin 2>/dev/null)" || return 1
  url="${url%.git}"
  [[ "${url}" =~ ${REMOTE_SLUG_PATTERN} ]] || return 1
  echo "${BASH_REMATCH[1]}"
}

skip_protection() {
  echo "skip required status checks match docs/development.md: $1"
  skipped=$((skipped + 1))
}

protection_query() {
  local token_user="${!PROTECTION_USER_VARIABLE:-}" token
  if [[ -z "${token_user}" ]]; then
    gh api "repos/$1/${PROTECTION_PATH}" 2>&1
    return
  fi
  token="$(gh auth token --user "${token_user}" 2>&1)" || { echo "gh auth token --user ${token_user} failed: ${token:0:${SHOWN_TEXT_LIMIT}}"; return 1; }
  GH_TOKEN="${token}" gh api "repos/$1/${PROTECTION_PATH}" 2>&1
}

check_required_checks_parity() {
  local repo owner protection parity
  repo="$(checkout_slug)" || { skip_protection "git remote get-url origin gives no <owner>/<name> for ${core}, so there is no repository to ask. Fix: add the remote origin, then rerun"; return; }
  owner="${repo%%/*}"
  if ! protection="$(protection_query "${repo}")"; then
    if [[ "${protection}" =~ ${PROTECTION_DENIED_PATTERN} ]]; then
      skip_protection "GitHub answered ${BASH_REMATCH[0]} for ${repo}, because reading branch protection needs admin on it. Account needed: ${owner}. Fix: rerun with ${PROTECTION_USER_VARIABLE}=${owner}, which passes GH_TOKEN=\$(gh auth token --user ${owner}) to this one call only, or run: GH_TOKEN=\$(gh auth token --user ${owner}) gh api repos/${repo}/${PROTECTION_PATH}"
    else
      echo "FAIL required status checks match docs/development.md: gh api for ${repo} failed: ${protection:0:${SHOWN_TEXT_LIMIT}}"
      failures=$((failures + 1))
    fi
    return
  fi
  if parity="$(printf '%s' "${protection}" | node "${core}/${PARITY_SCRIPT}" --repo "${core}" 2>&1)"; then
    echo "ok   required status checks of ${repo} on ${BASE_BRANCH} are the set listed in docs/development.md"
  else
    echo "FAIL required status checks of ${repo} on ${BASE_BRANCH} differ from docs/development.md:"
    echo "${parity}"
    failures=$((failures + 1))
  fi
}

for tool in gh git node; do
  command -v "${tool}" >/dev/null 2>&1 || { echo "${SCRIPT_NAME}: ${tool} is not on PATH. Rule: the test drives the real ${tool}. Fix: install ${tool}, then rerun." >&2; exit "${EXIT_TOOL_MISSING}"; }
done
[[ "${sandbox}" =~ ${REPO_NAME_PATTERN} ]] || refuse "${SANDBOX_VARIABLE} must be <owner>/<name>"

view="$(gh repo view "${sandbox}" --json isPrivate,isFork,name,nameWithOwner,defaultBranchRef 2>&1)" || refuse "gh repo view failed (${view:0:${SHOWN_TEXT_LIMIT}})"
repo_field_is "${view}" 'd.isPrivate === true' || refuse "the repository is not private"
repo_field_is "${view}" 'd.isFork === false' || refuse "the repository is a fork, or gh did not report isFork"
repo_field_is "${view}" "d.name.toLowerCase().includes('${REQUIRED_NAME_PART}')" || refuse "the repository name does not contain ${REQUIRED_NAME_PART}"
repo_field_is "${view}" "d.defaultBranchRef?.name === '${BASE_BRANCH}'" || refuse "the default branch is not ${BASE_BRANCH}"

echo "== required status checks (read only): gh api ${PROTECTION_PATH}"
check_required_checks_parity

work="$(mktemp -d)"
trap cleanup EXIT
trap 'exit "${EXIT_INTERRUPTED}"' INT TERM

echo "== notes-repo.mjs prepare (gh repo clone)"
prepared="$(env -u "${NOTES_REPO_VARIABLE}" node "${scripts}/notes-repo.mjs" prepare --repo-name "${sandbox}" 2>"${work}/prepare.err")" || {
  prepare_error="$(head -c "${SHOWN_TEXT_LIMIT}" "${work}/prepare.err")"
  setup_failed "notes-repo.mjs prepare failed: ${prepare_error}"
}
clone="$(node -e 'process.stdout.write(String(JSON.parse(process.argv[1]).path ?? ""))' "${prepared}")"
[[ -d "${clone}/.git" ]] || setup_failed "notes-repo.mjs prepare printed no checkout path in ${prepared:0:${SHOWN_TEXT_LIMIT}}"
expect "notes-repo prepare prints inRepo false" "${prepared}" 'd.inRepo === false'
expect "notes-repo prepare prints path as a non-empty string" "${prepared}" 'typeof d.path === "string" && d.path.length > 0'
expect "notes-repo prepare prints branch ${BASE_BRANCH}" "${prepared}" "d.branch === \"${BASE_BRANCH}\""
expect "notes-repo prepare prints clean true" "${prepared}" 'd.clean === true'
expect "notes-repo prepare prints behind as a whole number" "${prepared}" 'Number.isInteger(d.behind) && d.behind >= 0'

suffix="$(od -An -N"${RANDOM_BYTES}" -tx1 /dev/urandom | tr -d ' \n')"
branch="${BRANCH_PREFIX}${suffix}"
probe_file="live-gh-${suffix}.txt"
echo "${branch}" > "${clone}/${probe_file}"
git -C "${clone}" checkout -q -b "${branch}" || setup_failed "git checkout -b ${branch} failed"
git -C "${clone}" add -- "${probe_file}" || setup_failed "git add ${probe_file} failed"
git -C "${clone}" "${COMMIT_IDENTITY[@]}" commit -q -m "${PR_TITLE} ${suffix}" || setup_failed "git commit failed"
echo "== creating branch ${branch} on ${sandbox}"
branch_pushed=1
git -C "${clone}" push -q origin "HEAD:refs/heads/${branch}" || setup_failed "git push of ${branch} failed"
pr_url="$(gh pr create --repo "${sandbox}" --draft --base "${BASE_BRANCH}" --head "${branch}" --title "${PR_TITLE} ${suffix}" --body "Throwaway pull request from ${SCRIPT_NAME}. The test closes it and deletes branch ${branch} when it ends." 2>&1)" || setup_failed "gh pr create failed (${pr_url:0:${SHOWN_TEXT_LIMIT}})"
candidate="${pr_url##*/}"
[[ "${candidate}" =~ ${NUMBER_PATTERN} ]] || setup_failed "gh pr create printed no pull request number in: ${pr_url:0:${SHOWN_TEXT_LIMIT}}"
pr_number="${candidate}"
echo "== created draft PR #${pr_number} on ${sandbox}; if cleanup fails, close it and delete branch ${branch} by hand"

echo "== slice-git.mjs ghJson: gh pr view --json state"
viewed="$(run_ghjson "[\"pr\", \"view\", \"${branch}\", \"--json\", \"state\"]")" || { echo "FAIL gh pr view --json state: ${viewed:0:${SHOWN_TEXT_LIMIT}}"; failures=$((failures + 1)); viewed="{}"; }
expect "gh pr view --json state prints the field state" "${viewed}" '"state" in d'
expect "gh pr view --json state is OPEN for the draft pull request" "${viewed}" 'd.state === "OPEN"'

echo "== slice-state.mjs: gh pr list --json"
list_fields="$(grep -oE 'PR_LIST_FIELDS = "[^"]+"' "${scripts}/slice-state.mjs" | cut -d'"' -f2)"
list_limit="$(grep -oE 'PR_LIST_LIMIT = "[0-9]+"' "${scripts}/slice-state.mjs" | cut -d'"' -f2)"
[[ -n "${list_fields}" && -n "${list_limit}" ]] || setup_failed "plugin/scripts/slice-state.mjs no longer defines PR_LIST_FIELDS and PR_LIST_LIMIT as string constants, so this test cannot learn the gh pr list fields the script parses"
listed="$(run_ghjson "[\"pr\", \"list\", \"--state\", \"all\", \"--limit\", \"${list_limit}\", \"--json\", \"${list_fields}\"]")" || { echo "FAIL gh pr list --json ${list_fields}: ${listed:0:${SHOWN_TEXT_LIMIT}}"; failures=$((failures + 1)); listed="[]"; }
ours="d.find((pr) => pr.headRefName === \"${branch}\")"
expect "gh pr list prints a JSON array" "${listed}" 'Array.isArray(d)'
IFS=',' read -r -a list_field_names <<< "${list_fields}"
for field in "${list_field_names[@]}"; do
  expect "gh pr list prints the field ${field} on every pull request" "${listed}" "d.length > 0 && d.every((pr) => \"${field}\" in pr)"
done
expect "gh pr list prints headRefName and state as strings on every pull request" "${listed}" 'd.every((pr) => typeof pr.headRefName === "string" && typeof pr.state === "string")'
expect "gh pr list finds the throwaway pull request by headRefName" "${listed}" "${ours} !== undefined"
expect "gh pr list prints number as a whole number on every pull request" "${listed}" 'd.every((pr) => Number.isInteger(pr.number))'
expect "gh pr list prints number ${pr_number} for the throwaway pull request" "${listed}" "${ours}.number === ${pr_number}"
expect "gh pr list prints isDraft true for the throwaway pull request" "${listed}" "${ours}.isDraft === true"
expect "gh pr list prints state OPEN for the throwaway pull request" "${listed}" "${ours}.state === \"OPEN\""
expect "gh pr list prints headRefOid as a 40-character object id on every pull request" "${listed}" "d.every((pr) => /${OBJECT_ID_PATTERN}/.test(pr.headRefOid))"
expect "gh pr list prints mergeCommit null for the unmerged throwaway pull request" "${listed}" "${ours}.mergeCommit === null"
expect "gh pr list prints only the states OPEN, CLOSED and MERGED" "${listed}" 'd.every((pr) => ["OPEN", "CLOSED", "MERGED"].includes(pr.state))'
expect_when "gh pr list prints mergeCommit.oid as an object id on every merged pull request" "${listed}" 'd.some((pr) => pr.state === "MERGED")' "d.filter((pr) => pr.state === \"MERGED\").every((pr) => /${OBJECT_ID_PATTERN}/.test(pr.mergeCommit?.oid))"
expect_when "gh pr list prints mergeCommit null on every closed pull request" "${listed}" 'd.some((pr) => pr.state === "CLOSED")' 'd.filter((pr) => pr.state === "CLOSED").every((pr) => pr.mergeCommit === null)'

echo "== pr-gate.mjs: gh api graphql review threads"
body_file="${work}/pr-body-${branch}.md"
echo "Throwaway body." > "${body_file}"
run_gate
expect "pr-gate reads data.repository.pullRequest.reviewThreads.nodes and prints no unresolved thread (exit ${gate_status})" "${gate}" 'Array.isArray(d.unresolvedThreads) && d.unresolvedThreads.length === 0'
expect "pr-gate prints title null and bodyPath null for a conforming title and body file (exit ${gate_status})" "${gate}" 'd.title === null && d.bodyPath === null'

echo "== pr-gate.mjs: one real review thread, then resolved"
head_sha="$(git -C "${clone}" rev-parse HEAD)"
comment="$(gh api "repos/${sandbox}/pulls/${pr_number}/comments" -f body="${COMMENT_BODY}" -f commit_id="${head_sha}" -f path="${probe_file}" -F line="${COMMENT_LINE}" -f side="${COMMENT_SIDE}" 2>&1)" || setup_failed "gh api pulls/${pr_number}/comments failed (${comment:0:${SHOWN_TEXT_LIMIT}})"
run_gate
expect "pr-gate prints exactly one unresolved thread after the review comment (exit ${gate_status})" "${gate}" 'd.unresolvedThreads.length === 1'
comment_url="$(node -e 'process.stdout.write(String(JSON.parse(process.argv[1]).html_url ?? ""))' "${comment}")"
expect "pr-gate prints the thread url that GitHub gave the review comment" "${gate}" "d.unresolvedThreads[0]?.url === \"${comment_url}\" && d.unresolvedThreads[0].url.length > 0"
expect "pr-gate prints the thread path ${probe_file}" "${gate}" "d.unresolvedThreads[0]?.path === \"${probe_file}\""
expect "pr-gate exits 1 while a thread is unresolved" "{\"status\": ${gate_status}}" 'd.status === 1'
threads="$(gh api graphql -F owner="${sandbox%%/*}" -F repo="${sandbox#*/}" -F number="${pr_number}" -f query="${THREAD_ID_QUERY}" 2>&1)" || setup_failed "gh api graphql review thread lookup failed (${threads:0:${SHOWN_TEXT_LIMIT}})"
thread_id="$(node -e 'const nodes = JSON.parse(process.argv[1]).data.repository.pullRequest.reviewThreads.nodes; process.stdout.write(nodes.length === 1 ? nodes[0].id : "")' "${threads}")"
[[ -n "${thread_id}" ]] || setup_failed "the pull request does not hold exactly one review thread in ${threads:0:${SHOWN_TEXT_LIMIT}}"
resolved="$(gh api graphql -f query="${RESOLVE_THREAD_MUTATION}" -f id="${thread_id}" 2>&1)" || setup_failed "gh api graphql resolveReviewThread failed (${resolved:0:${SHOWN_TEXT_LIMIT}})"
expect "resolveReviewThread prints isResolved true" "${resolved}" 'd.data.resolveReviewThread.thread.isResolved === true'
run_gate
expect "pr-gate prints no unresolved thread after the thread is resolved (exit ${gate_status})" "${gate}" 'd.unresolvedThreads.length === 0'
expect "pr-gate exits 0 after the thread is resolved" "{\"status\": ${gate_status}}" 'd.status === 0'
for type_name in PullRequestReviewThread PullRequestReviewComment; do
  type_fields="$(gh api graphql -f query="{ __type(name: \"${type_name}\") { fields { name } } }" 2>&1)" || { echo "FAIL gh api graphql introspection of ${type_name}: ${type_fields:0:${SHOWN_TEXT_LIMIT}}"; failures=$((failures + 1)); type_fields="{}"; }
  if [[ "${type_name}" == PullRequestReviewThread ]]; then wanted=("${THREAD_FIELDS[@]}"); else wanted=("${COMMENT_FIELDS[@]}"); fi
  for field in "${wanted[@]}"; do
    expect "GraphQL type ${type_name} has the field ${field} that pr-gate reads" "${type_fields}" "d.data.__type.fields.some((field) => field.name === \"${field}\")"
  done
done

if [[ "${failures}" -gt 0 ]]; then
  echo "${failures} live gh assertion(s) failed: the real gh output differs from what the scripts parse."
  exit 1
fi
if [[ "${skipped}" -gt 0 ]]; then
  echo "live gh assertions passed, ${skipped} assertions skipped: each skip line above says what it needs."
  exit 0
fi
echo "all live gh assertions passed"
