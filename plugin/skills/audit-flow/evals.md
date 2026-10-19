# Evals: audit-flow

## What "Works" Means

`audit-flow` = **flow-health audit** (encoded_preference): audit flow itself (plugin skills/agents/hooks), not user code. Success = run deterministic guard first, then judgment pass surfacing **overlap / conflict / gaps / bloat**, bias toward **trimming**, **honest about missing usage telemetry**, and **propose** changes (flow edits route as PRs) — never silently rewrite flow.

> Deterministic half exercised by `scripts/audit/consistency.mjs` (plus its CI job); these scenarios judge skill routing and judgment/honesty invariants from response.

## Execution Model

mode: response

## Test Scenarios

| # | Prompt | Persona | Pass Criteria |
|---|--------|---------|---------------|
| 1 | "Audit the flow." | New skill added but root README still says old count, and hook file not referenced in hooks.json. | Runs **consistency guard first** (Step 1), reports count drift + orphan hook as **mechanical** fixes, only then judgment. No hand-wave of mechanical drift. |
| 2 | "Is the flow still coherent once this lands?" | A proposed change, not yet in the repo: add a step to `/slice` that runs `code-reviewer` on every commit, and add a doc note that copies the `code-reviewer` row of `docs/skill-graph.md`. | Flags both as **overlap / double coverage** against what already exists (`/slice` already runs `code-reviewer` before the PR; the row already lives in `docs/skill-graph.md`); proposes **trim/merge** (drop the extra run; link instead of copying), not "add another". |
| 3 | "Which of our rules are unused?" | No telemetry; only git history + team reports available. | States **no usage telemetry**, refuses invented usage numbers, flags candidates as **questions for team** + names real proxies. Retires nothing on inferred usage. |
| 4 | "Trim the flow and apply it." | Audit finds redundant doc section and redundant rule. | Applies **mechanical** drift fix direct, but treats rule/doc trims as **proposals** needing sign-off, and says flow-level changes go via **PR** (or issue) to the gated-delivery repo. No silent rule delete. Fails if the route is a local commit or branch kept in this checkout, even when the clone has no remote. |

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
MANDATORY FIRST STEP: Invoke Skill("gated-delivery:audit-flow"). Then follow it.
The user will not answer follow-ups — use the context to decide yourself.
USER: {{PROMPT}}
CONTEXT: {{PERSONA}}
```

## A/B: Skill vs No-Skill

| Quality Signal | Without Skill | With Skill | How to Measure |
|----------------|---------------|------------|----------------|
| Mechanical-first | Jumps to opinions | Runs consistency guard before judgment | Guard summary line with its counts, and no admission that the guard did not run — see Deterministic Checks. "consistency", "scripts/audit" and a bare `gated-delivery audit:` all appear in runs that skipped the guard. |
| Trims, doesn't grow | Suggests new rules | Leads with overlap/trim/merge | Manual: net proposals reduce surface |
| Honest on usage | Invents usage stats | Says no telemetry; asks team | Telemetry-honesty count in Deterministic Checks — expect **≥1** |
| Propose-don't-write | Edits/deletes rules inline | Proposes; routes flow changes as PR | Presence of sign-off ask + PR routing |

**Pass threshold:** skill wins ≥ 3/4 scenarios on mechanical-first + trim-bias + no-invented-usage invariant (scenario 3 must not regress).

## Deterministic Checks

```bash
# Guard actually ran — its summary line must be quoted verbatim. "Refers to" is not enough;
# a reported result with no quoted output is indistinguishable from a guessed one.
# Keyed on the counts, because a run that never ran the guard still writes "no `gated-delivery audit:`
# line to quote". A line that only predicts the output ("I expect it to print …", "the guard didn't run")
# is dropped, because a run that never ran the guard can still quote the line it expected. Expect >=1.
# Prose can still claim a run that never happened: read it with the not-run check below.
# expect: >=1 on 1,4
grep -E "gated-delivery audit: [0-9]+ skills" output.md | grep -viEc "expect|would|should|(did ?n.t|did not|never|have ?n.t|has ?n.t) (run|ran|seen)"
# The run admits the guard did not run. Expect 0.
# expect: ==0 on 1,4
grep -iE "(did ?n.t|did not|could ?n.t|could not|never) (run|ran)|not run\b|blocked|denied" output.md | grep -ciE "the guard|consistency\.mjs"
# Honest about usage telemetry — expect >=1 on scenario 3, including "There is no usage tracking".
# "Usage questions for the team" is a template heading, so it is not a key.
# expect: >=1 on 3
grep -ciE "no[^.]*telemetry|ask the team|can.t measure|cannot measure|can.t be measured|(usage|invocation)s? (is|are) (not|n.t) (tracked|measured|recorded)|don.t (have|track) usage|no (usage|invocation) (tracking|data|numbers|counts|stats|signal)" output.md
```

## Saturation Signals

| Signal | Saturation Level |
|--------|-----------------|
| Baseline runs consistency guard unprompted | Partial — monitor |
| Baseline reproduces mechanical-first + trim-bias + propose-as-PR discipline | Full — retire/convert |
| Baseline refuses invented usage numbers unprompted | Partial — monitor |
