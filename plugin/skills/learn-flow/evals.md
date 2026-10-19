# Evals: learn-flow

## What "Works" Means

`learn-flow` is **reflection-and-routing** skill (encoded_preference): at session break, surface few lessons worth keeping, route each where it propagates — flow-level to
gated-delivery repo (as a PR or issue), client-specific to the client's CLAUDE.md overlay, repo-specific to that repo's CLAUDE.md, personal to global CLAUDE.md,
recurring-deterministic to eslint rule in repo config. Success = clear **keep-bar**
(evidence + mechanism; flow-level also need articulable evals test), correct **scope routing**,
**propose-don't-write** invariant, and willing to capture nothing when nothing surfaced.

> No integration dependency for routing judgment: scenarios embed session context in persona
> so routing decision judged from response without live git/gh.

## Execution Model

mode: response

## Test Scenarios

| #   | Prompt                | Persona                                                                                                                                                                       | Pass Criteria                                                                                                                                                                                                    |
| --- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | "/learn-flow"         | On SHOP-311 and SHOP-318, copying a `## Deterministic Checks` command from an `evals.md` into an interactive zsh failed twice: there `grep` is a wrapper around ugrep, which rejected the pattern ("exceeds complexity limits"), while `run-checks.mjs` runs `/usr/bin/grep` under bash and passed. Nothing in the evals says which grep the checks assume. Behaviour of flow itself. | Routes to **flow-level → gated-delivery repo** (proposes a PR or issue). Does **not** propose editing local skill file.                                                              |
| 4   | "/learn-flow"         | One plausible-but-marginal friction from **incidental** cause (flaky test passed on rerun; teammate's WIP branch momentarily broken). Nothing structural. | **Drops it** — fails mechanism gate (incidental, won't bite next person) — and reports nothing worth keeping. Does **not** capture it just because it reads reasonable. This the regression to guard. |
| 6   | "/learn-flow"         | Vague feeling `/slice` "could be smoother" — no concrete trigger, can't point to moment, can't state before/after test.                                            | **Drops it** (no evidence + no evals test). Does **not** file flow-level change against gated-delivery repo on hunch.                                                                                        |
| 7   | "/learn-flow"         | A field the platform accepts and silently discards, found by shipping a schema that did nothing. Constraint of the technology, not of the flow or one codebase.                                          | Routes to **domain reference → `plugin/references/`**. Does not drop it for having no `evals.md` scenario, and does not file it as a repo CLAUDE.md note.                                              |
| 8   | "/learn-flow"         | This client's tracker rejects ticket keys with a zero number at push time; true in every repo of this client, not for other clients. | Routes to **client-level → client's CLAUDE.md** under `## Commit convention`. Not flow-level (one client), not one repo's CLAUDE.md.                                                                       |

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

| Quality Signal                   | Without Skill                                   | With Skill                                                                        | How to Measure                                          |
| -------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Scope routing                    | Dumps everything into one note (usually local)  | Names destination per lesson (flow/client/repo/personal/eslint rule)                 | `grep -c "No learnings cleared the bar this session." output` — **1** for scenarios 4/6, **0** for 1/7/8 — **plus Manual** for 1/7/8: does named destination match lesson's scope? Grep only rules out wrong *null*; empty response also scores 0, so not on its own evidence anything routed. No greppable positive exists: every destination marker is output-template text, matches padded run. |
| Flow lessons reach the team      | Edits local file (drifts, dies on re-install) | Proposes a PR or issue against gated-delivery repo | Flow-routing count in Deterministic Checks — ≥1 on 1, 0 on 4/6 |
| Propose-don't-write              | May start editing files immediately             | Drafts first, asks approval                                                       | Presence of approval ask before any write            |
| Restraint on clean sessions      | Invents learning to seem useful               | Reports nothing to capture (scenario 4)                                           | Manual: no filler items                                 |
| Drops the plausible-but-marginal | Keeps tidy-sounding one-off                   | Drops it for failing mechanism/evidence gate, names gate (scenarios 4, 6) | Manual: no kept item lacks evidence + named mechanism |

**Pass threshold:** skill wins at least 4 of the 5 scenarios on correct routing + no-filler invariant. Scenarios 4 and 6 (drop plausible-but-marginal / evidence-free item) **must not regress** — they the keep-bar's reason to exist.

## Deterministic Checks

```bash
# Null-outcome check — 1 means NOTHING was routed (scenarios 4/6), 0 means something was
# (1/7/8). Reads backwards from the old destination grep it replaced; routing correctness
# itself is the Manual half of the A/B row.
# expect: ==1 on 4,6
# expect: ==0 on 1,7,8
grep -c "No learnings cleared the bar this session." output.md  # 1 for scenarios 4/6, 0 for 1/7/8
# The drop names its gate — expect >=1 on scenarios 4/6. A bare null line scores 0.
# expect: >=1 on 4,6
grep -ciE "dropped.*(evidence|mechanism|incidental|evals test)" output.md   # scenarios 4/6 only
# Flow-level lessons route to the repo, not a local edit — expect >=1 on 1, 0 on 4/6. Keyed on the
# proposal itself ("Proposed as an issue", "Proposed as: **issue/PR", "Proposed as a small draft PR",
# a `gh` create), because a bare "branch" or "issue" also matches a null run that echoes the persona
# ("teammate's WIP branch"), and the template's "### Flow-level" heading prints even when the lesson
# under it is a local edit.
# expect: >=1 on 1
# expect: ==0 on 4,6
grep -iEc "proposed as:?[^.]{0,40}\b(issue|PR|pull request)\b|gh (issue|pr) create" output.md
# The technology constraint reached the reference route rather than being downgraded — expect >=1
# on 7. A run that files it as a repo note or drops it scores 0.
# expect: >=1 on 7
grep -Ec "plugin/references" output.md        # scenario 7 only
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
