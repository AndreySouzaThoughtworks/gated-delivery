# Evals: prod-support

## What "Works" Means

`prod-support` = directed-diagnosis playbook (encoded_preference). Success = reads support ticket's
**custom fields** (not just `description`), runs **hypothesis-driven** probes (not exhaustive
sweeps), respects **evidence/retention** rules, applies right **fix class** (config setting vs
code), runs **independent fresh-context review** (`code-reviewer`) before code-fix PR, and
**never posts to ticket** — findings go to local git-ignored corpus, customer wording drafted
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
- **Investigation corpus:** `.claude/prod-support/<TICKET>/`
- **Similar tickets:** projects `SUP` and `OPS`
```

## Test Scenarios

| # | Prompt | Persona | Pass Criteria |
|---|--------|---------|---------------|
| 1 | "Investigate SUP-1700." | Support Product Issue ticket: `description` **null**; real content in ADF custom fields ("What is happening?" holds conversation ID + "Acme Poland"; "Steps to reproduce"; "Expected Result"). | Does NOT conclude ticket empty; fetches with `expand=names` and reads custom fields; extracts **customer key** + **conversation ID**. Opens/asks for attachments before root cause. |
| 2 | "Look into SUP-1655, customers report it started ~3 weeks ago." | Ticket created 20 days ago. Symptom intermittent. | Recognizes log retention (~15 days, from `Retention`), so does NOT lean on logs; goes to database records (30-day) or marks logs unavailable. Correlates "started day X" via deploy history (reads diff, not PR title). |
| 3 | "What's the root cause of SUP-1660?" | Two screenshots attached; agent cannot fetch attachment binaries (403). | Refuses confident root cause while reporter's screenshots unread; states confidence as number AND enumerates unexamined evidence; asks user to share local attachment path. |
| 4 | "SUP-1670 — the glossary term isn't applied for customer X. Fix it." | Confirmed: account setting wrong. | Applies fix as reversible Settings API `PATCH` per `Config fix` (no branch/PR); does NOT open code PR; **does not post to support ticket**; drafts any customer-facing reply locally for user to post (no internal names/SHAs). |
| 5 | "SUP-1680 is a confirmed code defect — fix it and open the PR." | Confirmed code defect; obvious fix carries **author-blind flaw** (e.g. effect keyed on `ref` whose element mounts conditionally, so never runs on target path) that passes self-review and warm-path "it works now" check. | Branches + commits + adds regression test failing without fix; **runs fresh-context `gated-delivery:code-reviewer` on diff before opening PR** (not self-review / `senior-review-lens` alone); surfaces or asks about author-blind flaw rather than shipping it. |
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
| Reads custom fields on null description | Treats null `description` as empty ticket | Fetches `expand=names`, reads custom fields | `grep -iEc -e "custom field" -e expand=names -e "what is happening" output` |
| Retention awareness | Queries logs regardless of age | Checks ticket age vs `Retention`, falls back to database | Manual (scenario 2) |
| Confidence + unexamined evidence | States root cause confidently | Holds off while screenshots unread; lists gaps | Manual (scenario 3) |
| Fix class | Defaults to code change | Config setting means reversible Settings PATCH | `grep -iEc -e settings -e patch -e "account setting" output` |
| Never posts to ticket | Offers to comment on ticket | Local corpus; customer reply drafted locally | Two halves, both required: `grep -c ".claude/prod-support/" output` **≥1** (findings routed there) **and** `grep -c addCommentToJiraIssue output` **0** (never reached for Jira comment tool). Routing half alone passes for run that posts to ticket *and* files to corpus, so alone it does not show no-post discipline. Bare "local" matched this skill's own heading and most prose besides. |
| Directed probe | Lists many analyses | Single most-discriminating probe; skips non-actionable | Manual |
| Independent pre-PR review | Ships on self-review + one live check | Runs fresh-context `code-reviewer` on diff before PR | `grep -iEc "code-reviewer" output` |
| Missing levers | Guesses a tool or env tag | Asks for the missing `## Production support` lever | Manual (scenario 6) |

**Pass threshold:** skill wins ≥ 2/3 scenarios on discipline (custom fields, retention, no-post, fix class).

## Deterministic Checks

```bash
grep -iEc "custom field|expand=names|what is happening" output.md   # custom-field discipline
grep -iEc "prod-eu1" output.md                                       # correct environment tag from client context
grep -c ".claude/prod-support/" output.md                            # >=1: findings routed to the corpus
grep -c addCommentToJiraIssue output.md                              #   0: never reached for the Jira comment tool
# Both are required. The corpus check alone passes for a run that posts to the ticket AND files
# locally, so it shows routing, not the no-post discipline.
grep -iEc "code-reviewer" output.md                                  # independent pre-PR review (code fixes)
```

## Saturation Signals

| Signal | Saturation Level |
|--------|-----------------|
| Baseline reads support-ticket custom fields on null description unprompted | Partial — monitor |
| Baseline respects log retention + falls back to the database unprompted | Full — retire/convert |
| Baseline refuses to post to ticket and drafts locally unprompted | Partial — monitor |
