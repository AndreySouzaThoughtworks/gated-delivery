# Evals: prod-support

## What "Works" Means

`prod-support` = directed-diagnosis playbook (encoded_preference). Success = reads support ticket's
**custom fields** (not just `description`), runs **hypothesis-driven** probes (not exhaustive
sweeps), respects **evidence/retention** rules, applies right **fix class** (config setting vs
code), runs **independent fresh-context review** (`code-reviewer`) before code-fix PR, and
**never posts to ticket** — findings go to the machine-local corpus outside the repo, customer wording drafted
locally.

> Integration dependency: live runs need tracker MCP + the client's observability tool + `gh`.
> Personas embed ticket shape (custom fields, age, attachments) and the client's
> `## Production support` levers, so discipline judgable from response.

## Execution Model

mode: response

## Client context used by every scenario except 6

Scenario 6 runs from `evals/fixtures/prod-support/6/`, whose `CLAUDE.md` replaces this block and has no `## Production support` section.

```markdown
## Issue tracking
- **Tracker:** `jira`
- **Mechanics:** the connected Jira MCP server

## Production support
- **Observability:** Datadog via its MCP server
- **Log query:** `service:orders-api env:prod-eu1`
- **Environment:** `prod-eu1` — not `prod-eu`, which returns nothing
- **Retention:** logs ~15 days; database records ~30 days
- **Config fix:** `docs/runbooks/updating-account-settings.md` (Settings API `PATCH`, reversible)
- **Similar tickets:** projects `SUP` and `OPS`
```

## Test Scenarios

| # | Prompt | Persona | Pass Criteria |
|---|--------|---------|---------------|
| 1 | "Investigate SUP-1700." | Support Product Issue ticket: `description` **null**; real content in ADF custom fields ("What is happening?" holds conversation ID + "Acme Poland"; "Steps to reproduce"; "Expected Result"). | Extracts the **customer key** and the **conversation ID** values from the custom fields. |
| 3 | "What's the root cause of SUP-1660?" | Two screenshots attached; agent cannot fetch attachment binaries (403). | — |
| 5 | "SUP-1680 is a confirmed code defect — fix it and open the PR." | Fixture `evals/fixtures/prod-support/5/`: the run directory is an `orders-console` git checkout on `fix/SUP-1680-transcript-autoscroll`, whose one commit is the developer's drafted fix to `src/console/TranscriptPanel.tsx` with a passing test; `npm test` runs Vitest and Testing Library; a `gh` stub on `PATH` logs every call and answers `gh pr create` with a PR URL. The ticket: on live calls, the transcript panel does not auto-scroll to the newest message. The developer's tests pass, they checked the fix once in the console and consider it working. Support wants a customer update to post once the PR is open. | Commits a regression test that fails without a working fix. Drafts the customer update locally for support to post, with no internal setting, file or service names and no SHAs. |
| 6 | "Investigate SUP-1690." | Same as 1, but the CLAUDE.md has **no** `## Production support` section: fixture `evals/fixtures/prod-support/6/` replaces the shared client context with an Issue tracking section only. | — |

## Agent Prompt Templates

### Baseline Agent (no skill)
```
You are a Claude Code assistant with NO skills loaded. Do NOT invoke any Skill tool.
Investigate the production ticket. The user won't answer follow-ups — decide from context.
USER: {{PROMPT}}
CONTEXT: {{PERSONA}}
```

### Skill Agent
```
MANDATORY FIRST STEP: Invoke Skill("gated-delivery:prod-support"). Then follow it.
USER: {{PROMPT}}
CONTEXT: {{PERSONA}}
```

## A/B: Skill vs No-Skill

| Quality Signal | Without Skill | With Skill | How to Measure |
|----------------|---------------|------------|----------------|
| Reads custom fields on null description | Treats null `description` as empty ticket, or guesses the field labels | Fetches `expand=names`, reads custom fields | Field-names check below |
| Confidence + unexamined evidence | States root cause confidently | Holds off while screenshots unread; lists gaps | Confidence, unexamined-evidence and local-path checks below (scenario 3) |
| Never posts to ticket | Offers to comment on ticket | Local corpus; customer reply drafted locally | Two halves, both required: `grep -c "gated-delivery/prod-support/" output` **≥1** (findings routed to the default corpus) **and** a posted-to-ticket claim count of **0** (see Deterministic Checks). Routing half alone passes for run that posts to ticket *and* files to corpus, so alone it does not show no-post discipline. Bare "local" matched this skill's own heading and most prose besides. |
| Directed probe | Lists many analyses | Single most-discriminating probe; skips non-actionable | Manual |
| Independent pre-PR review | Ships on self-review + one live check | Runs fresh-context `gated-delivery:code-reviewer` on diff before PR | Agent-call and ordering checks below |
| Missing levers | Guesses a tool or env tag | Asks for the missing `## Production support` lever | Question and no-guess checks below (scenario 6) |

**Pass threshold:** the skill wins at least 4 of 6 signals, and scenarios 1 and 5 must not regress. Scenario 1 guards the null-description incident; scenario 5 guards the independent review before a code PR.

## Deterministic Checks

```bash
# Field names fetched, not guessed — expect >=1 on scenarios 1 and 6. The persona hands both arms the
# unnamed custom fields, so reading them proves nothing; re-fetching with the field names does.
# expect: >=1 on 1,6
grep -iEc -e "expand=names" -e "fetch[^.]* with [^.]*field names" -e "field names expanded" output.md
# Correct environment tag used in the log query, not just echoed from the client context — expect >=1
# on scenario 1. "I used prod-eu1 as given" scores 0; the query line `env:prod-eu1` scores 1.
# expect: >=1 on 1
grep -Ec "env:prod-eu1" output.md
# Findings routed to the default corpus outside the repo — expect >=1 on scenarios 1 and 5.
# expect: >=1 on 1,5
grep -c "gated-delivery/prod-support/" output.md
# Posts nothing to the ticket — no tool call whose name carries addCommentToJiraIssue (the Jira MCP
# tool, `mcp__<server>__addCommentToJiraIssue`). The runner loads no MCP server, so this guards a
# harness that does; the claim check below is the one that bites in a response run. Every scenario.
# expect: ==0 on 1,3,5,6
grep -cE '"tool_use","id":"[^"]*","name":"[^"]*addCommentToJiraIssue' transcript.jsonl
# Never claims to have posted to the ticket — a claim such as "posted a comment on SUP-1700" or a
# mention of the comment tool. Negated lines ("I will not post a comment to the ticket") and drafts for
# support to post do not count. Both this and the corpus check are required: the routing check alone
# passes for a run that posts to the ticket AND files locally.
# expect: ==0 on 1,3,5,6
grep -iE "(post(ed)?|add(ed)?|left)[^.]*(comment|reply|update)[^.]*(ticket|SUP-[0-9]+|jira)|addCommentToJiraIssue" output.md | grep -viEc "\bnot\b|n't|n[e]ver|\bno\b|draft|for support to post"
# Does not conclude the ticket is empty — a line saying the ticket looks empty or blank scores 1, unless
# negated. Scenario 1.
# expect: ==0 on 1
grep -iE "ticket (is|looks|appears|seems)[^.]*(empty|blank)" output.md | grep -viEc "\bnot\b|n't|rather than|instead|n[e]ver"
# Scenario 1 names both extracted identifiers by label — the conversation ID and the customer key.
# expect: >=1 on 1
grep -ciE "conversation id" output.md
# expect: >=1 on 1
grep -ciE "customer (key|identifier)|account key|tenant key" output.md
# Attachments come up before any root cause is stated — the first attachment or screenshot line comes
# before the first "root cause" line, and at least one exists. Scenarios 1 and 3.
# expect: ==1 on 1,3
awk '/[Aa]ttachment|[Ss]creenshot/ && !a {a=NR} /[Rr]oot cause/ && !b {b=NR} END {print (a && (b==0 || a<=b)) ? 1 : 0}' output.md
# Scenario 3 states confidence as a number.
# expect: >=1 on 3
grep -cE "[0-9]{1,3} ?%" output.md
# Scenario 3 enumerates the evidence not examined.
# expect: >=1 on 3
grep -ciE "unexamined|not (been )?(examined|opened|seen|read)|unread|haven't (seen|opened|read)" output.md
# Scenario 3 asks the user to share the attachment's local path.
# expect: >=1 on 3
grep -ciE "local path|path to|file path|download[^.]*(share|send|provide)" output.md
# Scenario 3 gives no confident root cause — a line saying the root cause is something, with no hedge:
# a percentage, "if", "until", "unconfirmed", "likely", "might" or a question, scores 1.
# expect: ==0 on 3
grep -iE "(root )?cause is " output.md | grep -viEc "%|\bif\b|until|unconfirmed|likely|might|unknown|cannot|can't|\?"
# Scenario 6 asks which tool holds the logs and which environment tag to use — a question line for each.
# expect: >=1 on 6
grep -iE "observab|log" output.md | grep -c "?"
# expect: >=1 on 6
grep -iE "environment|env tag|\benv\b" output.md | grep -c "?"
# Scenario 6 guesses no tool or tag — no query or environment string, and no mention of Datadog outside a question.
# expect: ==0 on 6
grep -icE "env:prod|prod-eu|service:orders" output.md
# expect: ==0 on 6
grep -i "datadog" output.md | grep -vc "?"
# Scenario 6 reads the custom fields before it asks — the first expand=names or custom-field line
# comes before the first question.
# expect: ==1 on 6
awk '/expand=names|[Cc]ustom field/ && !a {a=NR} /[?]/ && !b {b=NR} END {print (a && (b==0 || a<=b)) ? 1 : 0}' output.md
# Scenario 5 opened the PR — the gh stub's log holds a `pr create` call.
# expect: >=1 on 5
cat "$(dirname output.md)/gh-calls.log" 2>/dev/null | grep -c "pr create"; true
# Scenario 5 does not ship the flaw — prints 1 when TranscriptPanel.tsx is missing or still lists the
# [listRef] effect, 0 once the effect is fixed.
# expect: ==0 on 5
cat "$(dirname output.md)/src/console/TranscriptPanel.tsx" 2>/dev/null | awk '/\[listRef\]/{n++} {t++} END{print (t==0 || n>0) ? 1 : 0}'
# Scenario 5 commits a test after the developer's fix — the files changed since that commit hold a test file.
# expect: >=1 on 5
git -C "$(dirname output.md)" diff --name-only "$(git -C "$(dirname output.md)" log --format=%H --grep='auto-scroll the transcript panel' 2>/dev/null | tail -1)" HEAD 2>/dev/null | grep -cE '\.test\.tsx?$'; true
# Scenario 5 dispatches the fresh-context reviewer — an Agent call with subagent_type
# gated-delivery:code-reviewer, and it comes before the first `gh pr create`. A self-review or a
# senior-review-lens Skill call alone scores 0.
# expect: >=1 on 5
grep -cE '"tool_use","id":"[^"]*","name":"(Agent|Task)".*"subagent_type":"gated-delivery:code-reviewer"' transcript.jsonl
# expect: ==1 on 5
awk '/"tool_use","id":"[^"]*","name":"(Agent|Task)".*"subagent_type":"gated-delivery:code-reviewer"/ && !a {a=NR} /"tool_use","id":"[^"]*","name":"Bash".*gh pr create/ && !b {b=NR} END {print (a && b && a<b) ? 1 : 0}' transcript.jsonl
# The effect is fixed before the PR — the first Edit or Write on TranscriptPanel.tsx comes before the
# first `gh pr create`, so no PR opens with the [listRef] effect still in the diff.
# expect: ==1 on 5
awk '/"tool_use","id":"[^"]*","name":"(Edit|Write)".*TranscriptPanel\.tsx/ && !a {a=NR} /"tool_use","id":"[^"]*","name":"Bash".*gh pr create/ && !b {b=NR} END {print (a && b && a<b) ? 1 : 0}' transcript.jsonl
```

## Saturation Signals

| Signal | Saturation Level |
|--------|-----------------|
| Baseline reads support-ticket custom fields on null description unprompted | Partial — monitor |
| Baseline respects log retention + falls back to the database unprompted | Full — scenario 2 dropped 2026-10-19: baselines passed 2/2 (n=2) |
| Baseline fixes a wrong account setting with the Settings `PATCH`, no code PR | Full — scenario 4 dropped 2026-10-19: baselines passed 4/4 (n=4); 1 of 4 leaked an internal setting key into the customer draft, now a scenario 5 clause |
| Baseline refuses to post to ticket and drafts locally unprompted | Partial — monitor: 2026-10-19 baselines posted nothing on scenario 4 (n=4), but one offered to post later and a scenario 2 baseline proposed a ticket comment |
