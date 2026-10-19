---
name: prod-support
description: Playbook for investigating a production issue on a service you deliver: route the ticket, run a hypothesis-driven investigation, reproduce, ship a fix, record findings in a local handover corpus. Use when a support ticket is escalated, a customer-reported production bug reaches you, you mention a support ticket key, or someone says "prod support", "prod bug", "production incident" or "investigate this prod issue".
user-invocable: true
argument: "{TICKET} — the support ticket key (optional)"
---
# Prod Support Investigation

For a support ticket raising a production issue on a service you deliver. Work as **directed diagnosis**: form hypothesis from cheap signals you already have, run **single most informative probe**, learn, narrow. Frame as **evidence → reproduce → hypothesise → fix → regression-test**. No "cause is X" before probe supports it.

## Service conventions (set per client and service)

**Method** below service-agnostic; these **levers** vary by client and service. Read them from the `## Production support` section of the nearest CLAUDE.md (contract: `docs/client-context.md` in this plugin), plus `## Issue tracking` for ticket mechanics. A lever that is absent: use the default below, or ask before relying on a guess. Client-wide rules ("never post to ticket / local corpus", the tracker mechanics) apply unchanged across that client's services.

| Lever | `## Production support` key | Default when absent |
|-------|-----------------------------|---------------------|
| Observability tool and how to drive it | Observability | Ask which tool holds production logs |
| Log query for this service | Log query | Ask |
| Environment tag, and look-alikes that return nothing | Environment | Ask; never guess an env tag |
| Where auth / streaming 401s surface | Auth errors | Backend logs, then front-end monitoring if the tool has it |
| Log retention, and the fallback data source past it | Retention | Check the tool's retention before querying |
| Symptom → runbook index | Runbook index | the index the repo's instructions name, commonly `docs/CONTEXT.md` |
| Reversible config-fix runbook | Config fix | None — a config fix needs the client's documented path |
| Ship path | Ship path | the repo's path-to-production doc, commonly `docs/PATH_TO_PRODUCTION.md` |
| Git-ignored scratch corpus | Investigation corpus | `.claude/prod-support/<TICKET>/` (must be in `.gitignore`) |
| Deploy correlation | Deploy correlation | git log + release tags of the service repo |
| Support ticket intake fields | Intake fields | read every populated field, not only `description` |
| Projects to search for similar tickets | Similar tickets | the `## Issue tracking` Incident tracker, else the project the ticket lives in |
| Telephony / network capture stack | Call capture | Ask |

## Step 1 — Understand the ticket

Use the tracker mechanics `## Issue tracking` names first — need them to read ticket. Then:

- Read ticket **and all comments**. Note the customer identifier the data uses (reporter says "Acme Poland"; data wants the account or tenant key — in conversation URLs and the stored records).
- **Real report may live in custom fields, not `description`.** Support boards fed by an intake form populate **custom fields** — `description` often `null`. Fetch with every field populated (Jira: `expand=names`, read the ADF custom fields) and read the fields `Intake fields` names **before** concluding ticket empty — typically the narrative (often holds a **conversation or request ID**), steps to reproduce, expected result, plus customer ID, affected product, severity. Restricting the fetch to the standard set hides all these, makes populated ticket look blank.
- **Open every attachment — usually primary evidence.** Screenshots show exact symptom, values, scope (all rows vs some) that text omits. Tracker attachment binaries often can't be fetched by MCP/WebFetch tools (Jira returns 403), so **ask user to download and share local path**, then `Read` it. If you genuinely cannot see attachment, say so explicitly, treat cause as unconfirmed — **never present confident root cause while reporter's own screenshots unread.**
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
- **Code path / cross-repo** — read suspected path with `Explore`, cite `file:line`; trace across services when bug spans repos.
- **Config / glossary / engine** — configuration-class symptoms; runbook has exact checks.
- **Customer-side capture** — when symptom points customer-side, kick off `chrome://net-export` early via support (round-trip latency; not HAR), keep investigating server-side meanwhile. SIP / call-audio → the stack `Call capture` names (often different from the main observability tool).

**Subagents optional tactic, not method.** Fire one when chosen strategy genuinely independent, or big search you want kept out of main context — even couple in parallel.

## Step 4 — Reproduce (when it earns its place)

Reproduce to lock in fix's acceptance check or hand vendor runnable case — **skip for pinned config fix you're not escalating** (nothing to reproduce). When you do: if direct API call triggers bug (e.g. a vendor translation endpoint with text + settings causing it), capture **`.http` file** (VS Code REST Client): failing call, contrast/baseline call, fixed call, each with expected output in comment. **Never hardcode real key** — use `@key = {{$dotenv KEY_NAME}}` or placeholder, staging only.

## Step 5 — Fix, then report

**If fix is a customer configuration setting** (common config-class case), apply it via the runbook `Config fix` names — reversible, no branch, no PR. No such runbook → treat as code change or ask.

**If code change**, branch off `main` and commit following the `## Commit convention` (default: branch `fix/<TICKET>-<slug>`, subject `fix(<TICKET>): …`; `/gated-delivery:commit`). Self-review diff: minimal blast radius, no behaviour change for unaffected customers/paths, regression test that fails without fix. **Then, before opening PR, run fresh-context `gated-delivery:code-reviewer` on diff against acceptance criteria.** Self-review — and `senior-review-lens` — is author-context-bound: shares blind spot that produced bug, so misses author-blind defects (fix inert on very path it targets, effect that never re-runs, check green for wrong reason). Separate reviewer with fresh context catches those; single warm-path live validation won't — "it works when I click it now" can pass while real failing path stays broken. Resolve what it surfaces, then open PR with evidence-rich body — context → confirmed root cause → fix + why safe → rejected alternatives → validation — work review threads, ship via the `Ship path`.

**Never post to the support ticket.** Record findings, likely cause, status, next steps in local handover corpus (`Investigation corpus`, below — git-ignored, never pushed) — that is deliverable. Tracker comments can post customer-visible, so if ticket update or customer-facing reply wanted, **draft locally, hand to user / support owner to post themselves**. Drafting style: polite, brief, factual; "we" voice; no internal service/file/migration names, no SHAs or version specifics.

## Investigation notes (local scratch — never committed)

Keep working evidence in **local, git-ignored scratchpad** — the `Investigation corpus` path, default `.claude/prod-support/<TICKET>/` (confirm it is in `.gitignore`): `findings.md` (root cause, ruled-out hypotheses, confidence) and optionally `discovery.md` / `progress.md`. This corpus **transient and never pushed** — holds highest-PII material of whole flow (logs, settings dumps, caller IDs, transcripts, screenshots), and git history permanent and org-wide. Two rules:

- **Never commit the corpus.** Anything that must persist is **sanitised** lesson, folded into runbook or the repo's context index (PII-free by construction) in fix PR — that, plus support ticket (status), is inheritance path. One committable artifact is **`.http` repro** (Step 4): PII/secret-free by construction (placeholders / `$dotenv`, staging only), so commits *with fix PR*, not in scratchpad.
- **Keep even local copy PII-lean and clean up** when ticket closes: reference opaque conversation IDs only; redact caller numbers, transcript content, agent emails; never paste settings dumps, SIP URIs, IPs, hostnames, or customer screenshots into file you might later commit.

## Rules

- **Directed, not exhaustive.** Run probe that tests current hypothesis — not every analysis. Skip what you won't act on.
- **Confirm before you commit.** Hypothesise from cheap signals, but don't call something the cause — or fix it — until evidence confirms. Runbook that already pins cause, or prior ticket with same root cause, *is* that evidence — no live probe needed; otherwise run one. If you can't evidence cause, say so; state confidence as number ("~85%") **and enumerate evidence you have NOT examined** (unopened screenshots, unread logs, purged records) — confidence number hiding unread primary evidence worse than none. Keep "mechanism exists in code" separate from "this is what happened to these calls" — latter needs records/screenshots.
- **Probe/repro must exercise bug path, not adjacent one.** Same observable output ≠ same root cause: exit code, empty result, or 500 can match for completely unrelated reasons. Before trusting probe's confirm/kill — or calling repro valid — confirm failing branch actually hit (assert on value only that branch produces, or instrument intermediate state). Check that turns green after fix but was red for wrong reason proves nothing.
- **Exact `Environment` tag** for observability queries (never a look-alike); auth/streaming 401s where `Auth errors` says.
- **Fresh local repos** before reading code; read diff, not PR title.
- **Never post to ticket.** Findings go in local handover corpus; ticket/customer wording drafted locally for user or support owner to post.

## Pitfalls (from real investigations)

- **Stale local repo** — regression commit not in old checkout. `fetch && pull --ff-only` first.
- **Over-claimed certainty** — "100% confident" call refuted day later. Hold off until probe confirms.
- **Dismissed right hypothesis on narrow signature** — bug surfaced differently elsewhere. Check broader population (and similar tickets) before refuting.
- **Asked for wrong artefact** — HAR instead of `chrome://net-export/`. Check closest precedent ticket first.
- **Ran probe whose outcome changes nothing** — before recommending any investigation step, ask: "what do I do differently for each possible result?" If both outcomes lead to same action (or no action), skip probe.
- **Queried logs after they expired** — observability retention is finite (one real case: ~15 days for logs, ~30 days for the database). Check ticket creation date against `Retention` first; past it, skip the logs, go straight to the longer-lived source or mark logs unavailable.
- **Trusted self-review + one live check** — fix passed self-review and qa validation but was inert on real (cold-load) path; only external fresh-context review caught it. Run `gated-delivery:code-reviewer` before PR, validate *failing* path, not just "it works now."

## When this skill has done its job — reflect twice

1. **On the issue.** Root cause evidenced (not guessed); fix shipped or queued with clear PR; findings recorded in local (git-ignored) handover corpus; and — if API-reproducible — PII-free `.http` repro committed with fix PR. Fold any new domain lesson into matching runbook or the repo's context index in fix PR — that how next person inherits it. If step you ran late would have sped things up had you known sooner, pull it earlier next time.
2. **On this skill.** Note where skill itself slowed you down or fell short — missing or wrong strategy, unclear step, probe order that wasted effort, something you had to work around. Surface to user with concrete proposed improvement, so skill keeps getting sharper. A missing client lever belongs in that client's `## Production support` section, not in this skill.
