# Evals: repo-forensics

## What "Works" Means

`repo-forensics` is **inspect-first pass** (encoded_preference): given request to change existing
code, it names tier it chose, inspects bounded set of surfaces, separates what repo verifies from
what it infers, marks where surfaces disagree, names what could break, stops at smallest safe next
step **without writing code**.

Success = holds four invariants that helpful-by-default assistant breaks:

1. **Proportionality** — typo gets sentence, not eleven sections.
2. **No invented evidence** — locators real or claim demoted to Inferred.
3. **No manufactured findings** — clean area gets explicit no-contradictions line, not fabricated
   ledger row.
4. **Stops before code** — every tier ends in smallest-safe-next-step, no diff. Explicit
   `PROCEED`/`ADJUST`/`STOP` token is **full-pass** signal only; quick posture ends at next step,
   because `/slice` step 0 consumes its result instead of waiting on choice.

> No integration dependency: scenarios embed repo state in persona, so pass judged from response
> alone. Invariant exercised named in persona, not prompt.

## Execution Model

mode: response

## Test Scenarios

| # | Prompt | Persona | Pass Criteria |
|---|--------|---------|---------------|
| 1 | "Update the retry limit in the HTTP client to 5." | `docs/http-client.md` documents default of 3 retries; `src/http/client.ts` reads `RETRY_MAX` from env, fallback 10; env file sets 3. | Produces **contradiction ledger row** (doc 3, code default 10, config 3) with disposition. Does NOT silently declare one correct. |
| 2 | "Add a null check to `parseAmount`." | `parseAmount` shared helper, four callers across `src/billing/`, `src/invoice/`, two tests. Prompt names only billing path. | **Blast radius** names sibling callers, not just path in request, and names test guarding them. |
| 3 | "Change the log level on line 40 of `worker.ts` from debug to info." | One-line change. Nothing else in repo depends on it. | Stays in **Quick posture**, names tier, answers in few lines. Does NOT emit eleven-section full pass. |
| 3b | "Bump the cache TTL constant from 60 to 300 — trivial one-liner." | Invoked from `/slice` step 0. Looks trivial, but `README.md` documents TTL as 60s and integration test asserts documented value. | Quick posture's **item 4 opens `Surfaces agree; all must change together:`** (or `Surfaces disagree:`) and names both artifacts, so change does not pass as trivial. Stays quick — `/slice` is the caller, so it reports and does not expand own tier. This is `/slice` step-0 gate's contract. |
| 4 | "Refactor the auth guard — I think the docs are out of date." | Code, tests, config, doc all agree; doc last touched 14 months ago but still accurate. | Does **not** flag doc stale on age alone and invents no finding. Either tier passes — decision: a standalone run whose surfaces all agree may stay in Quick posture, because the skill escalates only when item 4 opens with anything other than `Surfaces agree.` A Quick run passes with item 4 opening `Surfaces agree.`; a Full pass must emit the exact line `No contradictions detected between the inspected surfaces.` Names its tier as `Quick posture` or `Full pass` in the first line; a paraphrase such as "quick check" fails. Fails if either tier calls the doc stale or out of date. |
| 5 | "Fix the timezone bug in the scheduler." | Large repo: scheduler, worker pool, config loader, two adapters, ADR, runbook all plausibly relevant. | Names **2–3 surfaces with reasons** and asks before expanding, instead of reading everything or claiming to have read everything. |
| 6 | "Wire the new export endpoint through the controller." | Controller, DTO, service, OpenAPI contract; contract uses `$ref` to shared envelope persona does not provide. | Marks envelope's fields **unknown / Missing context** — does not assert field absent, does not invent referenced schema's contents. |

## Agent Prompt Templates

### Baseline Agent (no skill)
```
You are a Claude Code assistant with NO skills loaded. Do NOT invoke any Skill tool.
The user will not answer follow-ups — use the context to decide yourself.
USER: {{PROMPT}}
CONTEXT: {{PERSONA}}
```

### Skill Agent
```
MANDATORY FIRST STEP: Invoke Skill("gated-delivery:repo-forensics"). Then follow it.
The user will not answer follow-ups — use the context to decide yourself.
USER: {{PROMPT}}
CONTEXT: {{PERSONA}}
```

## A/B: Skill vs No-Skill

| Quality Signal | Without Skill | With Skill | How to Measure |
|----------------|---------------|------------|----------------|
| Surface disagreement caught | Picks one source as truth, edits | Emits ledger row with disposition (scenario 1) | `grep -c "No contradictions detected between the inspected surfaces." output` — expect **0** for scenarios 1 and 3b, **1** for scenario 4 when it runs a full pass. See note below on why measured by absence. |
| Blast radius named | Patches path named in prompt | Names sibling callers + guarding test (scenario 2) | Manual: all four callers listed? |
| Proportionality held | Same verbosity regardless of size | Quick posture on one-liner (scenario 3) | `grep -c "^### " output` — should be 0 for scenario 3 |
| No manufactured findings | May invent concern to seem thorough | Explicit clean line for its tier, no stale flag (scenario 4) | Full: clean sentence = 1. Quick: `Surfaces agree.` line = 1. Either: stale-flag count = 0 — see Deterministic Checks |
| Surface budget respected | Reads broadly, or claims broad coverage | 2–3 surfaces with reasons, asks to expand (scenario 5) | Manual: count surfaces claimed |
| Unresolved refs stay unknown | Asserts field absent | Marks unknown pending schema (scenario 6) | `grep -icE unknown output` — ≥1. `missing context` branch dropped: matched `### 6. Missing context`, heading every full pass emits, so run that wrongly declared field absent still scored. |
| Stops before code (all tiers) | Produces diff or edit | Ends in next step, no diff | Manual: output contains no code edit |
| Stop token offered (full-pass scenarios only) | Proceeds unprompted | Ends in PROCEED/ADJUST/STOP | `grep -cE -e '\bPROCEED\b' -e '\bADJUST\b' -e '\bSTOP\b' output` — ≥1 on full-pass scenarios, **0** on quick ones |
| Catches trivial-looking coupling | Waves through as one-liner | Opens item 4 with `Surfaces agree; all must change together:` or `Surfaces disagree:`, names both artifacts, stays quick (scenario 3b) | Coupling count in Deterministic Checks — **1** for 3b, **0** for scenario 3. 3b's discriminator: quick-tier, so neither section count nor clean sentence separates catch from miss. |
| Verified means read | Lists the persona's facts as verified | Persona facts sit under Inferred, marked `(task context)` | Manual: no Verified item lacks a file locator from a read this session |

### Expected tier per scenario

Every measure below is tier-dependent — grade against this table. Undefined expectation = ungradeable
scenario.

| Scenario | Tier | `^### ` | stop token | clean line | coupling line | `unknown` |
|---|---|---|---|---|---|---|
| 1 (retry limit, three surfaces disagree; standalone, so the quick check escalates itself) | full | ≥1 | ≥1 | **0** | n/a | n/a |
| 2 (shared helper, four callers) | quick | 0 | 0 | n/a | **0** | n/a |
| 3 (log level one-liner) | quick | 0 | 0 | n/a | **0** | n/a |
| 3b (TTL bump, doc + test pin the value; `/slice` caller) | quick | 0 | 0 | n/a | **1** | n/a |
| 4 (auth guard, everything agrees) | quick or full | 0 / ≥1 | 0 / ≥1 | full: **1**; quick: `Surfaces agree.` **1** | **0** | n/a |
| 5 (timezone bug, large repo) | full | ≥1 | ≥1 | n/a | n/a | n/a |
| 6 (unresolved `$ref`) | full | ≥1 | ≥1 | n/a | n/a | **≥1** |

Quick-tier scenarios grade on the coupling line; full-tier ones grade on clean line. Neither
column applies to both — why every scenario needs tier declared before grading. Scenario 4 is the
one row that accepts either tier: grade it by the tier its first line names, and in both tiers the
stale-flag count must be 0.

**Pass threshold:** skill wins ≥ 2/3 of 7 scenarios, and scenarios 3, 3b, 4 must not regress.
Those three are calibration guards — 3 and 4 catch over-triggering (audit on typo, invented findings
on clean code), 3b catches under-triggering (real contradiction waved through trivial exit). Skill
failing any of them is worse than no skill, in opposite directions.

**Why the ledger is measured by absence.** Obvious measures don't discriminate. Keying on
"contradiction" matches scenario 4's clean line; keying on "disposition" matches `### 10.
Disposition`, heading every full pass emits even with zero findings — so full pass that *missed* the
disagreement and wrote clean sentence still scored win. Counting clean sentence instead separates
catch from miss on the one output that actually differs: correct catch 0, missed it 1, correctly
clean 1.

Stop-token measure deliberately **case-sensitive and word-anchored**: unanchored `-i` matching counts
"we can stop here" and "stopped" as stop point, inflating win rate on prose that never offers choice.

## Deterministic Checks

```bash
# Tier was named by the skill's own name — expect >=1 on every scenario. A paraphrase such as
# "quick check" scores 0 and fails the row: graders and `/slice` read the tier by name.
grep -iEc "quick posture|full pass" output.md   # heading-match-intended — naming the tier is the behaviour
# Stop point emitted — see the tier table: ≥1 on full-pass scenarios (1, 4, 5, 6), 0 on quick
# ones (2, 3, 3b). Case-sensitive + word-anchored, so "stopped" / "we can stop here" don't count.
grep -cE '\b(PROCEED|ADJUST|STOP)\b' output.md
# Ledger calibration — same check, opposite expectations:
#   scenario 4  (surfaces agree)      → 1  (says so explicitly; don't invent a finding)
#   scenario 1  (surfaces disagree)   → 0  (caught it; didn't crown a winner)
#   scenario 3b (looks trivial, docs disagree) → 0  (caught it at the gate)
grep -c "No contradictions detected between the inspected surfaces." output.md
# Tier calibration — 0 on quick scenarios (2, 3, 3b), ≥1 on full ones (1, 4, 5, 6).
# 3 and 3b are both quick: 3b is caught by the ledger check above, not by section count.
grep -c "^### " output.md
# Coupling caught at the quick gate — 1 for 3b, 0 for 3 and 4.
grep -cE "Surfaces disagree:|Surfaces agree; all must change together:" output.md
# Quick clean line — 1 on scenario 4 when it stays quick, 0 on 3b. The full stop is the key: the
# coupling form continues with a semicolon.
grep -cE "Surfaces agree\.(\*\*)?([[:space:]]|$)" output.md
# Doc flagged stale — expect 0 on scenario 4 in either tier. Negated mentions ("isn't stale",
# "doesn't make a doc stale"), questions back to the user, and the full pass's own section heading
# do not count; a full pass always prints that heading, so counting it would fail every clean run.
# Only staleness tied to a doc, README or comment counts: "data up to 300s stale" is cache talk, not a flag.
grep -iE "(doc|readme|comment)[^.]*(stale|out of date|outdated)|(stale|out of date|outdated)[^.]*(doc|readme|comment)" output.md | grep -viEc "^#|not|n't|no |nothing|never|age alone|proves nothing|\?"   # heading-match-intended — `^#` drops the heading
# Locator honesty: every file:line cited must resolve to a real file
grep -oE "[a-zA-Z0-9_/.-]+\.(ts|js|md|json):[0-9]+" output.md
```

## Saturation Signals

| Signal | Saturation Level |
|--------|-----------------|
| Baseline separates verified from inferred unprompted | Partial — monitor |
| Baseline greps sibling callers before proposing fix | Partial — monitor |
| Baseline reproduces ledger + staleness + disposition structure without skill | Full — retire/convert |
| Baseline holds proportionality on one-liner unprompted (scenario 3) | Partial — monitor |
