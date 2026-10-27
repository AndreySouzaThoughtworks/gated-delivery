# Evals: learn-flow

## What "Works" Means

`learn-flow` is **reflection-and-encoding** skill (encoded_preference): at session break, turn each surviving mistake into a proposed deterministic check — extend an existing guard, else a new check in CI and watcher — naming the mistake, its whole category, where it runs, and a failing example proving it rejects the bad case. Only judgment lessons end as prose, routed by scope, with the reason no check can decide it. Success = clear **keep-bar**, **check-first** ending with failing example, **propose-don't-write**, and willing to capture nothing.

> Scenarios embed session context in persona, so the judgment is made from the response without live git/gh.

## Execution Model

mode: response

## Test Scenarios

| #   | Prompt                | Persona                                                                                                                                                                       | Pass Criteria                                                                                                                                                                                                    |
| --- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | "/learn-flow"         | On SHOP-311 and SHOP-318, copying a `## Deterministic Checks` command from an `evals.md` into an interactive zsh failed twice: there `grep` is a wrapper around ugrep, which rejected the pattern ("exceeds complexity limits"), while `run-checks.mjs` runs `/usr/bin/grep` under bash and passed. Nothing in the evals says which grep the checks assume. Behaviour of flow itself. | Proposes a **check** against the gated-delivery repo (PR or issue): extend `run-checks.mjs --lint` to fail a fence the pinned grep rejects, with the failing fence as example. Not a prose note, not a local skill edit.                                                              |
| 4   | "/learn-flow"         | One plausible-but-marginal friction from **incidental** cause (flaky test passed on rerun; teammate's WIP branch momentarily broken). Nothing structural. | **Drops it** — fails mechanism gate (incidental, won't bite next person) — and reports nothing worth keeping. Does **not** capture it just because it reads reasonable. This the regression to guard. |
| 6   | "/learn-flow"         | Vague feeling `/slice` "could be smoother" — no concrete trigger, can't point to moment, can't state before/after test.                                            | **Drops it** (no evidence + no evals test). Does **not** file flow-level change against gated-delivery repo on hunch.                                                                                        |
| 7   | "/learn-flow"         | A field the platform accepts and silently discards, found by shipping a schema that did nothing. Constraint of the technology, not of the flow or one codebase.                                          | Routes to **domain reference → `plugin/references/`**. Does not drop it for having no `evals.md` scenario, and does not file it as a repo CLAUDE.md note.                                              |
| 8   | "/learn-flow"         | This client's tracker rejects ticket keys with a zero number at push time; true in every repo of this client, not for other clients. | Routes to **client-level → client's CLAUDE.md** under `## Commit convention`. Not flow-level (one client), not one repo's CLAUDE.md.                                                                       |
| 9   | "/learn-flow"         | Reviewer twice rejected a PR description for tone: accurate, but it blamed the previous author. Cause is taste and intent; no rule can decide it, and the repo has no check that reads tone. | Ends as **prose** under `Why not a check:` saying a machine cannot decide tone; routed to the repo `CLAUDE.md`. Does **not** invent a lint rule for it. |
| 10  | "/learn-flow"         | Agent twice used `as any` to silence a type error; repo already runs `eslint.config.mjs` in the watcher and CI, with `no-explicit-any` off. Second sighting, in two files. | Ends as a **check**: category "type escapes", extends the existing `eslint.config.mjs` (`no-explicit-any` to error), runs in watcher and CI, `Fails on:` a file with `as any`. Not a `CLAUDE.md` line. |

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
| Propose-don't-write              | May start editing files immediately             | Drafts first, asks approval                                      | Manual: approval ask before any write |

**Pass threshold:** skill wins at least 4 of 5 scenarios on check-first encoding and the no-filler invariant. Scenarios 4 and 6 (drop plausible-but-marginal / evidence-free item) **must not regress**.

## Deterministic Checks

```bash
# Null-outcome — 1 means NOTHING was routed (4/6), 0 means something was (1/7/8/9/10).
# expect: ==1 on 4,6
# expect: ==0 on 1,7,8,9,10
grep -c "No learnings cleared the bar this session." output.md
# The drop names its gate. A bare null line scores 0.
# expect: >=1 on 4,6
grep -ciE "dropped.*(evidence|mechanism|incidental|evals test|failing example)" output.md
# A check proposal states the input it rejects, keyed on the field label rather than the
# "### Check" heading, which prints even when the lesson under it is prose.
# expect: >=1 on 1,10
# expect: ==0 on 4,6,9
grep -c "Fails on:" output.md
# A prose lesson says why no check can decide it — expect >=1 on 9, 0 where a check was proposed.
# expect: >=1 on 9
# expect: ==0 on 1,10
grep -c "Why not a check:" output.md
# Flow-level work routes to the gated-delivery repo as a PR or issue, keyed on the proposal itself.
# expect: >=1 on 1
# expect: ==0 on 4,6
grep -iEc "proposed as:?[^.]{0,40}\b(issue|PR|pull request)\b|gh (issue|pr) create" output.md
# The technology constraint reached the reference route — expect >=1 on 7.
# expect: >=1 on 7
grep -Ec "plugin/references" output.md
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
