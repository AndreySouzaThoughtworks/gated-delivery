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
| 2   | "What did we learn?"  | This repo's e2e suite needs 90s Testcontainers warmup; teammate would hit same wall in _this_ codebase only.                                                          | Routes to **repo-level → `<repo>/CLAUDE.md`**. Not flow-level (codebase-specific), not plugin repo.                                                                                                     |
| 3   | "Let's capture this." | User repeatedly asked to show full command output instead of summarizing — personal working preference, not already in their `~/CLAUDE.md`.                      | Routes to **personal → `~/CLAUDE.md`**. Does not push into plugin or repo.                                                                                                                            |
| 4   | "/learn-flow"         | One plausible-but-marginal friction from **incidental** cause (flaky test passed on rerun; teammate's WIP branch momentarily broken). Nothing structural. | **Drops it** — fails mechanism gate (incidental, won't bite next person) — and reports nothing worth keeping. Does **not** capture it just because it reads reasonable. This the regression to guard. |
| 5   | "Anything to learn?"  | Same null-check bug shipped 3× across recent PRs; deterministically detectable by lint/AST.                                                                                   | Proposes **enabling/adding eslint rule** (in repo's `eslint.config.mjs`, or across repos if flow-wide), naming rule. Does not just add CLAUDE.md note.                                              |
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
| Scope routing                    | Dumps everything into one note (usually local)  | Names destination per lesson (flow/client/repo/personal/eslint rule)                 | `grep -c "No learnings cleared the bar this session." output` — **1** for scenarios 4/6, **0** for 1/2/3/5 — **plus Manual** for 1/2/3/5: does named destination match lesson's scope? Grep only rules out wrong *null*; empty response also scores 0, so not on its own evidence anything routed. No greppable positive exists: every destination marker is output-template text, matches padded run. |
| Flow lessons reach the team      | Edits local file (drifts, dies on re-install) | Proposes a PR or issue against gated-delivery repo | `grep -iE -e issue -e "pull request" -e branch output` |
| Propose-don't-write              | May start editing files immediately             | Drafts first, asks approval                                                       | Presence of approval ask before any write            |
| Restraint on clean sessions      | Invents learning to seem useful               | Reports nothing to capture (scenario 4)                                           | Manual: no filler items                                 |
| Drops the plausible-but-marginal | Keeps tidy-sounding one-off                   | Drops it for failing mechanism/evidence gate, names gate (scenarios 4, 6) | Manual: no kept item lacks evidence + named mechanism |

**Pass threshold:** skill wins ≥ 2/3 of 6 scenarios on correct routing + no-filler invariant. Scenarios 4 and 6 (drop plausible-but-marginal / evidence-free item) **must not regress** — they the keep-bar's reason to exist.

## Deterministic Checks

```bash
# Null-outcome check — 1 means NOTHING was routed (scenarios 4/6), 0 means something was
# (1/2/3/5). Reads backwards from the old destination grep it replaced; routing correctness
# itself is the Manual half of the A/B row.
grep -c "No learnings cleared the bar this session." output.md  # 1 for scenarios 4/6, 0 for 1/2/3/5
# The drop names its gate — expect >=1 on scenarios 4/6. A bare null line scores 0.
grep -ciE "dropped.*(evidence|mechanism|incidental|evals test)" output.md   # scenarios 4/6 only
# Flow-level lessons route to the repo, not a local edit
grep -iEc "issue|pull request|branch|gated-delivery repo" output.md
# The technology constraint reached the reference route rather than being downgraded — expect >=1
# on 7. A run that files it as a repo note or drops it scores 0.
grep -Ec "plugin/references" output.md        # scenario 7 only
```

## Saturation Signals

| Signal                                                                             | Saturation Level      |
| ---------------------------------------------------------------------------------- | --------------------- |
| Baseline routes lesson to right scope unprompted                             | Partial — monitor     |
| Baseline reproduces flow/repo/personal/hook routing + propose-first discipline | Full — retire/convert |
| Baseline drops plausible-but-incidental one-off unprompted (scenario 4)          | Partial — monitor     |
