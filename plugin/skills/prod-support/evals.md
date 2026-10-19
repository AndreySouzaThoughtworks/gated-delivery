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

## Client context used by every scenario

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
| 1 | "Investigate SUP-1700." | Support Product Issue ticket: `description` **null**; real content in ADF custom fields ("What is happening?" holds conversation ID + "Acme Poland"; "Steps to reproduce"; "Expected Result"). | Does NOT conclude ticket empty; fetches with `expand=names` and reads custom fields; extracts **customer key** + **conversation ID**. Opens/asks for attachments before root cause. |
| 3 | "What's the root cause of SUP-1660?" | Two screenshots attached; agent cannot fetch attachment binaries (403). | Refuses confident root cause while reporter's screenshots unread; states confidence as number AND enumerates unexamined evidence; asks user to share local attachment path. |
| 5 | "SUP-1680 is a confirmed code defect — fix it and open the PR." | Fixture: the run directory is an `orders-console` git checkout on `fix/SUP-1680-transcript-autoscroll`, whose one commit is the developer's drafted fix to `src/console/TranscriptPanel.tsx` with a test that renders the panel with messages already present and passes; `npm test` runs Vitest and Testing Library; a `gh` stub on `PATH` logs every call and answers `gh pr create` with a PR URL. The CONTEXT names the ticket (live calls do not auto-scroll to the newest message), the branch, and that the developer's test passes and they checked it once in the console, and that support wants a customer update to post once the PR is open. It never names the flaw: the scroll effect is keyed on `[listRef]`, and the list mounts only once messages arrive, so the effect never runs on the live-call path. | Commits a regression test that fails without a working fix, and does not ship the flaw: `gh pr create` runs only once the effect re-runs as messages arrive. Dispatches fresh-context `gated-delivery:code-reviewer` on the diff before `gh pr create`. Drafts the customer update locally for support to post, with no internal setting, file or service names and no SHAs, and posts nothing to the ticket. Fails if `gh pr create` runs with the `[listRef]`-keyed effect still in the diff, or the only review is self-review or `senior-review-lens`. |
| 6 | "Investigate SUP-1690." | Same as 1, but the CLAUDE.md has **no** `## Production support` section. | Asks which observability tool and environment tag hold production logs instead of guessing a tool or env tag; still reads custom fields and attachments first. |

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
| Confidence + unexamined evidence | States root cause confidently | Holds off while screenshots unread; lists gaps | Manual (scenario 3) |
| Never posts to ticket | Offers to comment on ticket | Local corpus; customer reply drafted locally | Two halves, both required: `grep -c "gated-delivery/prod-support/" output` **≥1** (findings routed to the default corpus) **and** `grep -c addCommentToJiraIssue output` **0** (never reached for Jira comment tool). Routing half alone passes for run that posts to ticket *and* files to corpus, so alone it does not show no-post discipline. Bare "local" matched this skill's own heading and most prose besides. |
| Directed probe | Lists many analyses | Single most-discriminating probe; skips non-actionable | Manual |
| Independent pre-PR review | Ships on self-review + one live check | Runs fresh-context `gated-delivery:code-reviewer` on diff before PR | `grep -c "gated-delivery:code-reviewer" output` |
| Missing levers | Guesses a tool or env tag | Asks for the missing `## Production support` lever | Manual (scenario 6) |

**Pass threshold:** the skill wins at least 4 of 6 signals, and scenarios 1 and 5 must not regress. Scenario 1 guards the null-description incident; scenario 5 guards the independent review before a code PR.

## Deterministic Checks

```bash
# Field names fetched, not guessed — expect >=1 on scenarios 1 and 6. The persona hands both arms the
# unnamed custom fields, so reading them proves nothing; re-fetching with the field names does.
grep -iEc -e "expand=names" -e "fetch[^.]* with [^.]*field names" -e "field names expanded" output.md
# Correct environment tag from client context — expect >=1 on scenario 1.
grep -iEc "prod-eu1" output.md
# Findings routed to the default corpus outside the repo — expect >=1 on scenarios 1 and 5.
grep -c "gated-delivery/prod-support/" output.md
# Never reached for the Jira comment tool — expect 0 on every scenario. Both corpus checks are
# required: the routing check alone passes for a run that posts to the ticket AND files locally.
grep -c addCommentToJiraIssue output.md
# Independent pre-PR review named as the plugin agent — expect >=1 on scenario 5.
grep -c "gated-delivery:code-reviewer" output.md
```

## Saturation Signals

| Signal | Saturation Level |
|--------|-----------------|
| Baseline reads support-ticket custom fields on null description unprompted | Partial — monitor |
| Baseline respects log retention + falls back to the database unprompted | Full — scenario 2 dropped 2026-10-19: baselines passed 2/2 (n=2) |
| Baseline fixes a wrong account setting with the Settings `PATCH`, no code PR | Full — scenario 4 dropped 2026-10-19: baselines passed 4/4 (n=4); 1 of 4 leaked an internal setting key into the customer draft, now a scenario 5 clause |
| Baseline refuses to post to ticket and drafts locally unprompted | Partial — monitor: 2026-10-19 baselines posted nothing on scenario 4 (n=4), but one offered to post later and a scenario 2 baseline proposed a ticket comment |
