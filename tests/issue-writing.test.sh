#!/usr/bin/env bash
set -uo pipefail

readonly EXIT_NOT_LOGGED_IN=3
readonly IMPLEMENTATION_NOUNS='PracticeCaller(Service|Handler)|practice-caller\.service|/v1/llm|practice_calls|x-acme-tenant'
readonly CLIENT_SECRETS='mongodb\+srv|hunter2|acme-internal|x-acme-'
readonly ACCEPTANCE_ROW='^\| *(AC)?[0-9]+ *\| *[^| ][^|]*\|[^|]*[^| ][^|]*\|[^|]*[^| ][^|]*\|'
readonly MOVED_DETAIL='PracticeCallerService'
readonly HEADLESS_NOTE='This is a non-interactive run: do not ask questions; make reasonable assumptions, state them in the ticket, and complete every tracker write.'

usage() { echo "usage: $0 [--control]   (--control runs with every skill disabled; expect failures)" >&2; exit 64; }
mode="skill"
case "${1:-}" in
  "") ;;
  --control) mode="control" ;;
  *) usage ;;
esac

core="$(cd "$(dirname "$0")/.." && pwd)"
tracker="$core/tests/fixtures/tracker"
work="$(mktemp -d)"
keep_on_failure() { if [ "$failures" -gt 0 ]; then echo "kept for inspection: $work" >&2; else rm -rf "$work"; fi; }
trap keep_on_failure EXIT
project="$work/project"
export TRACKER_STORE="$work/store"
failures=0

if [ -n "${AIFSD_TEST_PROFILE:-}" ]; then export CLAUDE_CONFIG_DIR="$AIFSD_TEST_PROFILE"; fi
if (cd "$work" && claude -p ping </dev/null 2>&1) | grep -q 'Not logged in'; then
  echo "skip: profile ${CLAUDE_CONFIG_DIR:-~/.claude} is not logged in" >&2
  exit "$EXIT_NOT_LOGGED_IN"
fi

check() {
  local name="$1"; shift
  if "$@"; then echo "ok   $name"; else echo "FAIL $name"; failures=$((failures + 1)); fi
}

has() { grep -qE "$2" "$1" 2>/dev/null; }
has_ci() { grep -qiE "$2" "$1" 2>/dev/null; }
lacks() { [ -f "$1" ] && ! grep -qE "$2" "$1"; }
lacks_ci() { [ -f "$1" ] && ! grep -qiE "$2" "$1"; }
has_story_sections() { has_ci "$1" '^## User Story' && has_ci "$1" '^## Acceptance Criteria'; }
has_template_sections() { has_ci "$1" '^## Scope' && has_ci "$1" '^## Definition of Ready' && has_ci "$1" '^## Definition of Done'; }
behavioural_sections() { awk '/^## / { keep = ($0 ~ /^## (User Story|Background|Scope|Acceptance Criteria)/) } keep' "$1"; }
behaviour_lacks() { [ -f "$1" ] && ! behavioural_sections "$1" | grep -qE "$2"; }
detail_kept() { grep -rqE "$MOVED_DETAIL" "$TRACKER_STORE/tickets/DEMO-1.md" "$project" --exclude-dir=.git; }
public_text_lacks_ci() { [ -f "$TRACKER_STORE/tickets/$1.md" ] && ! cat "$TRACKER_STORE/tickets/$1.md" "$TRACKER_STORE"/comments/"$1".public.md 2>/dev/null | grep -qiE "$2"; }
reread_after_last_update() {
  awk -v id="$1" '$2 == id { last = $1; if ($1 == "update") updated = 1 } END { exit !(updated && last == "get") }' "$TRACKER_STORE/calls.log"
}

git init -q "$project"
mkdir -p "$project/docs/specs" "$TRACKER_STORE/tickets"
cat > "$project/CLAUDE.md" <<EOF
## Issue tracking

- **Tracker:** \`filetracker\`
- **Mechanics:** the \`$tracker\` CLI; run it without arguments for usage. \`TRACKER_STORE\` is already exported.
- **Spec home:** \`docs/specs/<ticket-id>.md\`
- **Extra guardrail terms:** \`acme-internal\`, \`x-acme-\`

## Delivery notes

- **Shared notes home:** \`docs/aifsd/{ticket-id}/\`
EOF
cat > "$TRACKER_STORE/tickets/DEMO-1.md" <<'EOF'
Implement PracticeCallerService

- Add PracticeCallerService in src/practice/practice-caller.service.ts
- Call POST /v1/llm/complete with header x-acme-tenant
- Store the reply in the practice_calls.reply column
- Wire PracticeCallerHandler into the call flow
EOF

run_claude() {
  local name="$1" request="$2 $HEADLESS_NOTE"
  local args=(--setting-sources project,local --permission-mode acceptEdits
    --allowedTools "Bash($tracker:*)" "Bash(mkdir:*)" "Bash(grep:*)" "Bash(cat:*)" "Bash(ls:*)")
  if [ "$mode" = "skill" ]; then
    args+=(--plugin-dir "$core/plugin" --add-dir "$core/plugin" --allowedTools "Read")
    request="/gated-delivery:issue-writing $request"
  else
    args+=(--disable-slash-commands)
  fi
  (cd "$project" && claude -p "$request" "${args[@]}" </dev/null >"$work/$name.out" 2>&1)
}

run_claude refine "Refine DEMO-1 into a Story — it reads like an implementation checklist."
refined="$TRACKER_STORE/tickets/DEMO-1.md"
check "refine: ticket updated through the tracker" has "$TRACKER_STORE/calls.log" '^update DEMO-1$'
check "refine: User Story and Acceptance Criteria sections" has_story_sections "$refined"
check "refine: numbered Given / When / Then acceptance rows" has "$refined" "$ACCEPTANCE_ROW"
check "refine: Scope, Definition of Ready and Definition of Done from the template" has_template_sections "$refined"
check "refine: no implementation nouns in User Story, Background, Scope or Acceptance Criteria" behaviour_lacks "$refined" "$IMPLEMENTATION_NOUNS"
check "refine: no client guardrail terms in the ticket" lacks_ci "$refined" "$CLIENT_SECRETS"
check "refine: technical detail kept in Technical Notes or the repo, not deleted" detail_kept
check "refine: ticket re-read after the last update" reread_after_last_update DEMO-1

run_claude create "Create a story: admins can export the monthly call report as CSV without asking support. Context: the export is served from export.acme-internal.net and reads from mongodb+srv://reports:hunter2@cluster0.acme-internal.net/reports."
created_id="$(awk '$1 == "create" { id = $2 } END { print id }' "$TRACKER_STORE/calls.log")"
created="$TRACKER_STORE/tickets/${created_id:-none}.md"
check "create: ticket created through the tracker" test -n "$created_id"
check "create: User Story and Acceptance Criteria sections" has_story_sections "$created"
check "create: numbered Given / When / Then acceptance rows" has "$created" "$ACCEPTANCE_ROW"
check "create: Scope, Definition of Ready and Definition of Done from the template" has_template_sections "$created"
check "create: no secret, hostname or client term in public ticket text" public_text_lacks_ci "${created_id:-none}" "$CLIENT_SECRETS"

exit "$failures"
