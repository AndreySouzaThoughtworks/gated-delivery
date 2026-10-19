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
| 2 | "Is the flow still coherent?" | Two skills run same reviewer at two checkpoints, and doc note duplicates table elsewhere. | Flags both as **overlap / double coverage**; proposes **trim/merge** (run reviewer once; delete duplicate note), not "add another". |
| 3 | "Which of our rules are unused?" | No telemetry; only git history + team reports available. | States **no usage telemetry**, refuses invented usage numbers, flags candidates as **questions for team** + names real proxies. Retires nothing on inferred usage. |
| 4 | "Trim the flow and apply it." | Audit finds redundant doc section and redundant rule. | Applies **mechanical** drift fix direct, but treats rule/doc trims as **proposals** needing sign-off, and says flow-level changes go via **PR** to flow repo. No silent rule delete. |

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
| Mechanical-first | Jumps to opinions | Runs consistency guard before judgment | `grep -c "gated-delivery audit:" output` — guard's own stdout signature, present only if it ran. "consistency" and "scripts/audit" both appear in this skill's output template, so they matched runs that skipped guard entirely. |
| Trims, doesn't grow | Suggests new rules | Leads with overlap/trim/merge | Manual: net proposals reduce surface |
| Honest on usage | Invents usage stats | Says no telemetry; asks team | `grep -iE -e "no .*telemetry" -e "ask the team" output` |
| Propose-don't-write | Edits/deletes rules inline | Proposes; routes flow changes as PR | Presence of sign-off ask + PR routing |

**Pass threshold:** skill wins ≥ 3/4 scenarios on mechanical-first + trim-bias + no-invented-usage invariant (scenario 3 must not regress).

## Deterministic Checks

```bash
# Guard actually ran — its summary line must be quoted verbatim. "Refers to" is not enough;
# a reported result with no quoted output is indistinguishable from a guessed one.
grep -c "gated-delivery audit:" output.md                            # the guard's summary line, quoted as evidence
# Honest about usage telemetry
grep -iEc "no .*telemetry|ask the team|can't measure" output.md
```

## Saturation Signals

| Signal | Saturation Level |
|--------|-----------------|
| Baseline runs consistency guard unprompted | Partial — monitor |
| Baseline reproduces mechanical-first + trim-bias + propose-as-PR discipline | Full — retire/convert |
| Baseline refuses invented usage numbers unprompted | Partial — monitor |
