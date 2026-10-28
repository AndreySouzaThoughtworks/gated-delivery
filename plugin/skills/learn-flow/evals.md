# Evals: learn-flow

## What "Works" Means

`learn-flow` is **reflection-and-encoding** skill (encoded_preference): at session break, turn each surviving mistake into a proposed deterministic check — extend an existing guard, else a new check in CI and watcher — naming the mistake, its whole category, where it runs, and a failing example proving it rejects the bad case. Only judgment lessons end as prose, routed by scope, with the reason no check can decide it. Success = clear **keep-bar**, **check-first** ending with failing example, **propose-don't-write**, and willing to capture nothing.

> Scenarios embed session context in persona, so the judgment is made from the response without live git/gh.

## Execution Model

mode: response

## Test Scenarios

| #   | Prompt                | Persona                                                                                                                                                                       | Pass Criteria                                                                                                                                                                                                    |
| --- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | "/learn-flow"         | On SHOP-311 and SHOP-318, copying a `## Deterministic Checks` command from an `evals.md` into an interactive zsh failed twice: there `grep` is a wrapper around ugrep, which rejected the pattern ("exceeds complexity limits"), while `run-checks.mjs` runs `/usr/bin/grep` under bash and passed. Nothing in the evals says which grep the checks assume. Behaviour of flow itself. | — |
| 4   | "/learn-flow"         | One plausible-but-marginal friction from **incidental** cause (flaky test passed on rerun; teammate's WIP branch momentarily broken). Nothing structural. | — |
| 6   | "/learn-flow"         | Vague feeling `/slice` "could be smoother" — no concrete trigger, can't point to moment, can't state before/after test.                                            | — |
| 7   | "/learn-flow"         | A field the platform accepts and silently discards, found by shipping a schema that did nothing. Constraint of the technology, not of the flow or one codebase.                                          | — |
| 8   | "/learn-flow"         | This client's tracker rejects ticket keys with a zero number at push time; true in every repo of this client, not for other clients. | — |
| 9   | "/learn-flow"         | Reviewer twice rejected a PR description for tone: accurate, but it blamed the previous author. Cause is taste and intent; no rule can decide it, and the repo has no check that reads tone. | — |
| 10  | "/learn-flow"         | Agent twice used `as any` to silence a type error; repo already runs `eslint.config.mjs` in the watcher and CI, with `no-explicit-any` off. Second sighting, in two files. | — |

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
MANDATORY FIRST STEP: Invoke Skill("gated-delivery:learn-flow"). Then follow it.
The user will not answer follow-ups — use the context to decide yourself.
USER: {{PROMPT}}
CONTEXT: {{PERSONA}}
```

## A/B: Skill vs No-Skill

| Quality Signal                   | Without Skill                                   | With Skill                                                       | How to Measure                                          |
| -------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------- |
| Check before prose               | Writes a rule line into a prose file            | Proposes a check with category, where it runs, failing example   | Deterministic Checks (1, 10 vs 9) **plus Manual**: is the failing example one the check really rejects? Template text prints the field names, so a count alone does not prove it. |
| Prose only for judgment          | Adds prose for everything                       | Prose carries a reason no machine can decide it                  | Deterministic Checks (9 vs 1, 10) |
| Restraint on clean sessions      | Invents learning to seem useful                 | Reports nothing to capture (scenarios 4, 6)                      | Null-outcome check, **plus Manual**: an empty response also scores 0 |
| Propose-don't-write              | May start editing files immediately             | Drafts first, asks approval                                      | Deterministic Checks: the approval question, and no Edit, Write or `gh` create in the transcript |

**Pass threshold:** skill wins at least 6 of the 7 scenarios on check-first encoding and the no-filler invariant. Scenarios 4 and 6 (drop plausible-but-marginal / evidence-free item) **must not regress**.

## Deterministic Checks

```bash
# Null-outcome — 1 means NOTHING was routed (4/6), 0 means something was (1/7/8/9/10).
# expect: ==1 on 4,6
# expect: ==0 on 1,7,8,9,10
grep -c "No learnings cleared the bar this session." output.md
# The drop names the gate that scenario fails. A bare null line scores 0, and so does a drop that
# names the other scenario's gate: 4 is incidental (mechanism gate), 6 has no concrete moment (evidence gate).
# expect: >=1 on 4
grep -ciE "dropped.*(incidental|no mechanism)" output.md
# expect: >=1 on 6
grep -ciE "dropped.*(no evidence|no evals test)" output.md
# A check proposal states the input it rejects, keyed on the field label rather than the
# "### Check" heading, which prints even when the lesson under it is prose. The label needs text
# after it: the template prints the bare field name, so a count of the label alone proves nothing.
# expect: >=1 on 1,10
# expect: ==0 on 4,6,9
grep -cE "Fails on:[[:space:]]*[^[:space:]<].{8,}" output.md
# A prose lesson says why no check can decide it — expect >=1 on 9, 0 where a check was proposed.
# expect: >=1 on 9
# expect: ==0 on 1,10
grep -c "Why not a check:" output.md
# Flow-level work routes to the gated-delivery repo as a PR or issue. The skill's template prints no
# "proposed as" line, so a run that follows it never writes one; key on the Check or Prose heading
# naming the repo, or on the PR or issue named against it.
# expect: >=1 on 1
# expect: ==0 on 4,6
grep -ciE "^[> ]*#{2,4} *(Check|Prose)[^→]*→.*gated-delivery|(PR|pull request|issue)[^.]{0,30}(against|to|in) (the )?gated-delivery|gh (issue|pr) create" output.md
# A client-level lesson lands in the client's CLAUDE.md under its commit-convention section.
# expect: >=1 on 8
grep -c "Commit convention" output.md
# The existing lint config is extended and the failing example is the escape it must reject.
# expect: >=1 on 10
grep -ciE "Check:.*extend.*eslint\.config\.mjs" output.md
# expect: >=1 on 10
grep -ciE "Fails on:.*as any" output.md
# The technology constraint reached the reference route — expect >=1 on 7.
# expect: >=1 on 7
grep -Ec "plugin/references" output.md
# Something survived, so the approval question is asked; nothing survived, so it is not — expect >=1 on 1,7,8,9,10 and 0 on 4,6.
# expect: >=1 on 1,7,8,9,10
# expect: ==0 on 4,6
grep -c "Approve which of these" output.md
# Propose, don't write: no file edit and no filed issue or PR before approval, which a headless run never gets — expect 0 on all.
# expect: ==0 on 1,4,6,7,8,9,10
grep -cE '"name":"(Edit|Write)","input"' transcript.jsonl
# expect: ==0 on 1,4,6,7,8,9,10
grep -cE '"name":"Bash","input":\{"command":"gh (issue|pr) create' transcript.jsonl
# The flow check extends the lint in run-checks.mjs — expect >=1 on 1.
# expect: >=1 on 1
grep -ciE 'Check:.*run-checks\.mjs.*lint' output.md
# The Prose heading names the destination of the lesson. Reference route: plugin/references, and not a repo CLAUDE.md — expect >=1 and 0 on 7.
# expect: >=1 on 7
grep -E '^[> ]*#{2,4} .*Prose' output.md | grep -c 'plugin/references'
# expect: ==0 on 7
grep -E '^[> ]*#{2,4} .*Prose' output.md | grep -c 'CLAUDE.md'
# A reference lesson is not dropped for lacking an evals scenario — expect 0 on 7.
# expect: ==0 on 7
grep -ciE 'dropped.*evals test' output.md
# Client route: the Prose heading names the client — expect >=1 on 8. Not flow-level: no gated-delivery destination — expect 0 on 8 and 9.
# expect: >=1 on 8
grep -E '^[> ]*#{2,4} .*Prose' output.md | grep -ciE 'client'
# expect: ==0 on 8,9
grep -E '^[> ]*#{2,4} .*Prose' output.md | grep -c 'gated-delivery'
# Repo route: the Prose heading names the repo CLAUDE.md — expect >=1 on 9.
# expect: >=1 on 9
grep -E '^[> ]*#{2,4} .*Prose' output.md | grep -ciE 'repo.*CLAUDE\.md'
# The reason no machine can decide is stated in the Why not a check line — expect >=1 on 9.
# expect: >=1 on 9
grep 'Why not a check:' output.md | grep -ciE 'tone|taste|judg|intent|cannot|can.t'
# A type-escape lesson ends as a check in the existing lint: category, the rule as an error, where it runs — expect >=1 on 10, for each.
# expect: >=1 on 10
grep -ciE 'Category:.*escape' output.md
# expect: >=1 on 10
grep -ciE 'no-explicit-any.*error|error.*no-explicit-any' output.md
# expect: >=1 on 10
grep -ciE 'Runs in:.*(watcher.*CI|CI.*watcher)' output.md
```

## Saturation Signals

| Signal                                                                             | Saturation Level      |
| ---------------------------------------------------------------------------------- | --------------------- |
| Baseline routes lesson to right scope unprompted                             | Partial — monitor     |
| Baseline routes a codebase-only lesson to the repo's `CLAUDE.md` unprompted | Full — scenario 2 retired 2026-10-19: no-skill baseline passed n=2 ("I saved this in a new `CLAUDE.md` file at the repo root … Only this repo uses Testcontainers") |
| Baseline routes a personal preference to `~/CLAUDE.md` unprompted | Full — scenario 3 retired 2026-10-19: no-skill baseline passed n=2 ("add this line to `~/CLAUDE.md`") |
| Baseline proposes a named lint rule for a recurring deterministic bug unprompted | Full — scenario 5 retired 2026-10-19: no-skill baseline passed n=2 ("`@typescript-eslint/no-unnecessary-condition` … Make them errors in CI") |
| Baseline reproduces flow/repo/personal/hook routing + propose-first discipline | Full — retire/convert |
| Baseline drops plausible-but-incidental one-off unprompted (scenario 4)          | Partial — monitor     |
