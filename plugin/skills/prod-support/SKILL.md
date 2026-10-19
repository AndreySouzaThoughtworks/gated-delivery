---
name: prod-support
description: Playbook for investigating a production issue on a service you deliver: route the ticket, run a hypothesis-driven investigation, reproduce, ship a fix, record findings in a local handover corpus. Use when a support ticket is escalated, a customer-reported production bug reaches you, you mention a support ticket key, or someone says "prod support", "prod bug", "production incident" or "investigate this prod issue".
user-invocable: true
argument: "{TICKET} — the support ticket key (optional)"
---
# Prod Support Investigation

For a support ticket raising a production issue on a service you deliver. Work as **directed diagnosis**: form hypothesis from cheap signals you already have, run **single most informative probe**, learn, narrow. Frame as **evidence → reproduce → hypothesise → fix → regression-test**. No "cause is X" before probe supports it.

## Service conventions (set per client and service)

**Method** below is service-agnostic; these **levers** vary by client and service. Read them from the `## Production support` section of the nearest CLAUDE.md, plus `## Issue tracking` for ticket mechanics; `../../references/client-context.md`, relative to this file, holds each key's meaning and default. Keys: Observability, Log query, Environment, Auth errors, Retention, Runbook index, Config fix, Ship path, Investigation corpus, Deploy correlation, Intake fields, Similar tickets, Call capture. An absent key takes its default there; where that default is to ask, ask before relying on a guess. Client-wide rules ("never post to ticket / local corpus", the tracker mechanics) apply unchanged across that client's services.

## Step 1 — Understand the ticket

Use the tracker mechanics `## Issue tracking` names first — need them to read ticket. Then:

- Read ticket **and all comments**. Note the customer identifier the data uses (reporter says "Acme Poland"; data wants the account or tenant key — in conversation URLs and the stored records).
- **Read every populated field per the tracker adapter `issue-writing/trackers/<tracker>.md`**, and the fields `Intake fields` names, **before** concluding the ticket is empty. On intake boards the narrative often holds a **conversation or request ID**.
- **Open every attachment — usually primary evidence.** Screenshots show exact symptom, values, scope (all rows vs some) that text omits. Tracker attachment binaries often can't be fetched by MCP/WebFetch tools (some return 403), so **ask user to download and share local path**, then `Read` it. If you genuinely cannot see attachment, say so explicitly, treat cause as unconfirmed — **never present confident root cause while reporter's own screenshots unread.**
- **Search the tracker for similar / recent tickets now** — over the projects `Similar tickets` names, by error string, customer, keyword, or time window. Matching prior ticket can short-circuit whole investigation (known cause + fix), otherwise seeds hypotheses; doing it first cheap and high-leverage. **Don't dismiss match on narrow signature** — same root cause can surface differently on different endpoints.
- Route symptom via the repo's runbook index (`Runbook index`) to matching runbook/reference. That index is source of truth for symptom → doc map (and grows there); matched doc holds known causes, exact queries, config levers, prior-ticket precedent.

## Step 2 — Form ranked hypotheses

From cheap signals you now have — symptom, runbook's known causes, any similar ticket — write **2–4 hypotheses with falsifiable predictions** ("if X, we'd see Y in the logs / Z in code"). If prior ticket or runbook already pins cause and lever, skip straight to Reproduce (Step 4) / Fix (Step 5).

## Step 3 — Probe the top hypothesis, then narrow

Pick **single cheapest, most discriminating probe** that would confirm or kill top hypothesis. Run it, learn from result, re-rank, repeat until cause evidenced. **Skip any probe whose result you wouldn't act on.**

Reach for strategy your current hypothesis needs, load its skill only when you choose it:

- **Observability** (the tool and skill `Observability` names; run its own setup or discovery step first; use the exact `Environment` tag, never a look-alike):
  - *one conversation or request* — timeline of the ID (`Log query` plus `"<id>"`); find first line diverging from healthy call.
  - *breadth* — cross-customer scan of signature: one customer elevated = customer-side factor; many customers proportional = our regression.
  - auth / streaming 401s surface where `Auth errors` says, which is often front-end monitoring rather than backend logs.
- **Deploy correlation** (`gh` or the GitHub mechanics the client names; `git fetch --all --tags && git checkout main && git pull --ff-only` first — stale repo burns hypotheses) — for "started on day X": git log + the deploy source `Deploy correlation` names + release `merged_at`. **Read actual diff, never trust PR title.**
- **Code path / cross-repo** — on freshly pulled checkouts, read suspected path with `Explore`, cite `file:line`; trace across services when bug spans repos.
- **Config / glossary / engine** — configuration-class symptoms; runbook has exact checks.
- **Customer-side capture** — when the symptom points customer-side, request the capture `Call capture` names early through support, and keep investigating server-side meanwhile. Check the closest precedent ticket for the capture format it needed before asking; the wrong format costs a round trip. Call capture often lives outside the main observability tool.

**Subagents optional tactic, not method.** Fire one when chosen strategy genuinely independent, or big search you want kept out of main context — even couple in parallel.

## Step 4 — Reproduce (when it pays off)

Reproduce to lock in fix's acceptance check or hand vendor runnable case — **skip for pinned config fix you're not escalating** (nothing to reproduce). When you do: if direct API call triggers bug (e.g. a third-party endpoint called with the input and settings that cause it), capture **`.http` file** (VS Code REST Client): failing call, contrast/baseline call, fixed call, each with expected output in comment. **Never hardcode real key** — use `@key = {{$dotenv KEY_NAME}}` or placeholder, staging only.

## Step 5 — Fix, then report

**If fix is a customer configuration setting** (common config-class case), apply it via the runbook `Config fix` names — reversible, no branch, no PR. No such runbook → treat as code change or ask.

**If code change**, branch off `main` and commit following the `## Commit convention` (default: branch `fix/<TICKET>-<slug>`, subject `fix(<TICKET>): …`; `/gated-delivery:commit`). Self-review diff: minimal blast radius, no behaviour change for unaffected customers/paths, regression test that fails without fix. **Then, before opening PR, run fresh-context `gated-delivery:code-reviewer` on diff against acceptance criteria** — and name it as `gated-delivery:code-reviewer` in any plan you hand back, not as "an independent review". Self-review — and `senior-review-lens` — is author-context-bound: shares blind spot that produced bug, so misses author-blind defects (fix inert on very path it targets, effect that never re-runs, check green for wrong reason). Separate reviewer with fresh context catches those; single warm-path live validation won't — "it works when I click it now" can pass while real failing path stays broken. Resolve what it surfaces, then open PR with evidence-rich body — context → confirmed root cause → fix + why safe → rejected alternatives → validation — work review threads, ship via the `Ship path`.

**Never post to the support ticket.** Record findings, likely cause, status, next steps in local handover corpus (`Investigation corpus`, below — machine-local, never pushed) — that is deliverable. Tracker comments can post customer-visible, so if ticket update or customer-facing reply wanted, **draft locally, hand to user / support owner to post themselves**. Drafting style: polite, brief, factual; "we" voice; no internal service/file/migration names, no SHAs or version specifics.

## Investigation notes (local scratch — never committed)

Keep working evidence in **machine-local scratchpad outside the repo** — the `Investigation corpus` path, default `~/.local/state/gated-delivery/prod-support/<TICKET>/` (outside every repo, so nothing to git-ignore and no protected-directory prompt on each write; a client path inside a repo must be in its `.gitignore`): `findings.md` (root cause, ruled-out hypotheses, confidence) and optionally `discovery.md` / `progress.md`. This corpus **transient and never pushed** — holds highest-PII material of whole flow (logs, settings dumps, caller IDs, transcripts, screenshots), and git history permanent and org-wide. Two rules:

- **Never commit the corpus.** Anything that must persist is **sanitised** lesson, folded into runbook or the repo's context index (PII-free by construction) in fix PR — that, plus support ticket (status), is inheritance path. One committable artifact is **`.http` repro** (Step 4): PII/secret-free by construction (placeholders / `$dotenv`, staging only), so commits *with fix PR*, not in scratchpad.
- **Keep even local copy PII-lean and clean up** when ticket closes: reference opaque conversation IDs only, and keep everything the secrets and PII list in `gated-delivery:issue-writing` (*Publishing to the tracker*, guardrail scan) names out of any file you might later commit.

## Rules

- **Confirm before you commit.** Don't call something the cause — or fix it — until evidence confirms. A runbook that already pins the cause, or a prior ticket with the same root cause, *is* that evidence. If you can't evidence the cause, say so; state confidence as a number ("~85%") **and enumerate the evidence you have NOT examined** (unopened screenshots, unread logs, purged records). Keep "mechanism exists in code" separate from "this is what happened to these calls"; the latter needs records or screenshots.
- **Probe/repro must exercise bug path, not adjacent one.** Same observable output ≠ same root cause: exit code, empty result, or 500 can match for completely unrelated reasons. Before trusting probe's confirm/kill — or calling repro valid — confirm failing branch actually hit (assert on value only that branch produces, or instrument intermediate state). Check that turns green after fix but was red for wrong reason proves nothing.
- **Test a probe before running it:** "what do I do differently for each possible result?" If every outcome leads to the same action, or none, skip it.
- **Check the ticket's creation date against `Retention` before querying logs.** Past it, skip the logs and go straight to the longer-lived source, or mark logs unavailable.

## When this skill has done its job — reflect twice

1. **On the issue.** Root cause evidenced (not guessed); fix shipped or queued with clear PR; findings recorded in local handover corpus; and — if API-reproducible — PII-free `.http` repro committed with fix PR. Fold any new domain lesson into matching runbook or the repo's context index in fix PR — that how next person inherits it. If step you ran late would have sped things up had you known sooner, pull it earlier next time.
2. **On this skill.** Note where skill itself slowed you down or fell short — missing or wrong strategy, unclear step, probe order that wasted effort, something you had to work around. Surface to user with concrete proposed improvement, so skill keeps getting sharper. A missing client lever belongs in that client's `## Production support` section, not in this skill.
