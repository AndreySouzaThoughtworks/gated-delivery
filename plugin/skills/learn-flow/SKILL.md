---
name: learn-flow
description: Reflect at a session break and route each lesson by scope: flow-level to an gated-delivery change proposal, client-level to the client's CLAUDE.md, repo-level to that repo's CLAUDE.md, personal to the global CLAUDE.md, recurring mistakes to a lint rule. Use on /learn-flow, "what did we learn", "lessons learned", "let's capture this", or after a /slice or /spec session with friction. Propose, never silently write.
---
# learn-flow — capture lessons and improve the flow

Flow improve only if usage feed back. This skill = **capture** half of loop: reflect on session, decide what worth keeping, route each lesson where it propagate. Plugin installed read-only and shared, so flow-level improvement cannot be local edit — go to **gated-delivery repo**, reach every install.

Default to **drop**. Each candidate _presumed dropped_ until it clear keep-bar below. Expected outcome of clean session = _nothing captured_ — not one filler item to look useful.

## When to invoke

| Trigger                                                                | Pass                                 |
| ---------------------------------------------------------------------- | ------------------------------------ |
| User types `/learn-flow`                                               | Full pass                            |
| User says "what did we learn", "lessons learned", "let's capture this" | Full pass                            |
| End of a `/slice` or `/spec` session that hit non-trivial friction     | Full pass                            |
| A fix whose root cause was non-obvious                                 | Quick pass (1 item)                  |
| Routine session, no surprises                                          | Skip — no capture is a valid outcome |

No auto-fire on every mid-session correction — note silently, surface in next full pass.

## Step 1 — Reflect (start from the null)

Starting hypothesis = **"this session produced nothing worth shipping"** — that default, and for most sessions correct. Job _not_ find lessons; job see whether anything can **overturn** hypothesis by surviving keep-bar in Step 2.

Scan adversarially. For each thing that nag — gotcha, correction, sequence that worked, time sink — ask rejection question _first_: **"why is this _not_ worth keeping?"** Make candidate defend survival; no fishing.

After a `/slice` session, scan two places for the ticket(s) worked. **The Local notes home** — `## Delivery notes` in the client's CLAUDE.md, default `~/.local/state/aifsd/` — holds the executor's raw entries: assumptions, surprises, deviations, `## REFACTOR-NOTE`s. **`handoff.md` in the Shared notes home** — same section, default `docs/aifsd/{ticket-id}/` — holds what `/slice` step 7.6 promoted out of those notes: evidenced carry-forward items and the decisions taken at each slice-end checkpoint. Both are ready-made evidence you otherwise miss; the notes are richer, the handoff is what survived.

If nothing overturn null in 30 seconds, say so and stop. Typing `/learn-flow` does **not** obligate capture — "nothing this time" = common, correct outcome.

## Step 2 — Apply the keep-bar (drop is the default)

Each candidate **presumed dropped**. Survive only if clear **both** gates — name evidence and mechanism inline, so reader can check work:

- **Evidence.** Point to concrete moment it happened — exact correction, agent-notes or `handoff.md` line, error/stack, command that failed. No pointer → vibe → drop.
- **Mechanism.** Name _why this bite again_ — structural cause in tool/repo/flow, not accident of this session. Test: _"would next person on same path hit same wall, because of how things are built?"_ If depend on this session specifics (transient flake, one-time bad merge, config that happened to sit somewhere odd) → drop. Prior sighting (matching agent-notes entry, memory file, "second time I hit this") = _strongest_ corroboration mechanism real — bonus, not requirement.

**Flow-level clear third gate.** To route to gated-delivery repo — where it ship to every install — you must **state the `evals.md` scenario it would add**: failing-before / passing-after test, in shape of that skill existing scenarios. Cannot write that test → lesson not property of flow — downgrade to repo/personal, or drop. Articulating test = bar for "worth packing into shared plugin."

This gate asks about skill behaviour. A lesson about a *technology* — a field the platform discards, a setting with no effect, a shape that parses clean and does nothing — has no skill scenario to add, and belongs in a domain reference rather than being downgraded. Step 3 routes it.

## Step 3 — Categorize (route by scope)

For each candidate, pick exactly one destination. Pick by _who benefits_:

- **Flow-level → gated-delivery repo.** Lesson about how gated-delivery skill/agent/hook/recipe behave, or convention applying to **everyone** using flow (not one client, not one codebase). Cannot be local edit — installed plugin read-only and shared. Capture as **change proposal against the gated-delivery repo — a local branch with the diff (default), or an issue or draft PR once the repo has a remote**. Only path that improve flow for every install.
- **Domain reference → `plugin/references/`.** Constraint belonging to a *technology* rather than to the flow or to one codebase, which a competent engineer would not guess and would otherwise find by shipping something that silently does nothing. Same change-proposal route against the gated-delivery repo as flow-level, and the `evals.md` gate above does not apply. Admission test is in `references/reference-graph.md`; an existing reference takes an edit, a new subject takes a row and a file.
- **Client-level → client's CLAUDE.md overlay.** Lesson true across one client's repos — its tracker, conventions, internal tooling, review routing — but not for other clients. Edit the client folder's CLAUDE.md, in the section `docs/client-context.md` names for it (`## Issue tracking`, `## Commit convention`, `## Delivery notes`, `## Stack recipes`, `## Review routing`, `## Domain references`, `## Verification`). Never route it into the core plugin.
- **Repo-level → `<repo>/CLAUDE.md`.** Lesson specific to _this_ codebase (build quirks, layout, in-repo command). Edit that repo CLAUDE.md.
- **Personal → `~/CLAUDE.md`.** Preference about how _you_ like work, not flow or repo.
- **Lint rule.** _Recurring_ mistake, deterministically detectable (AST / lint). Propose **enabling or adding eslint rule** — in repo `eslint.config.mjs` (where team lint already run on commit), or across repos if flow-wide. No rule for one-off.
- **Drop.** Failed gate in Step 2, already documented, or too narrow. Showing what you dropped — and which gate it failed — build trust in filter.

Lesson fit two → pick most durable / widest-reaching (flow > reference > client > repo > personal > drop).

## Step 4 — Propose

**If nothing survived Step 2, entire output = one line:**

```
No learnings cleared the bar this session.
```

No empty headings — blank template invite padding. Render section only for destination with actual survivor. When at least one survive, print just those sections, then ask **"Approve which of these?"** (`AskUserQuestion` if 2+ items):

```
## Session learnings

### Flow-level → gated-delivery repo
- <lesson> — proposed as: <issue title / one-line PR change>
  Why: <one sentence>
  evals test: <failing-before / passing-after, one line>

### Domain reference → plugin/references/
- <reference or new subject> — <exact rule to add, one or two lines>
  Trap: <what ships green and does nothing without it>

### Client-level → <client>/CLAUDE.md
- Add under "<section>": > <exact line>

### Repo-level → <repo>/CLAUDE.md
- Add under "<heading>": > <exact line>

### Personal → ~/CLAUDE.md
- <exact line>

### Habit-hooks check → <package/repo>
- category / what it flags / detection

### Dropped (only items you actually considered)
- <bullet> — <gate it failed: no evidence / incidental, no mechanism / no evals test / already documented>
```

**Hard rule: propose, don't write.** Draft every edit, issue, PR, check in conversation first. Persist only what user explicitly approve — one item rejected ≠ all rejected.

## Step 5 — Apply approved items

- **Flow-level** → in the gated-delivery repo, create a local branch carrying the drafted change and show its diff (default). Once the repo has a remote: `gh issue create` with drafted title/body, or open draft PR if change small and concrete. **Never edit installed plugin copy in place** — versioned; changes reach users through repo and re-install. Report branch name or issue/PR URL.
- **Domain reference** → same route as flow-level, against `plugin/references/`: edit the matching reference, or add a row to `reference-graph.md` and the file beside it. The guard fails CI on a row without a file or a file without a row.
- **Client-level / Repo-level / Personal** → `Edit` target CLAUDE.md on exact section. Show one-line diff.
- **Lint rule** → name eslint rule + config it belong in; route as PR to repo `eslint.config.mjs` (or each repo config if flow-wide). No hand-rolled bespoke checker — prefer standard eslint/tseslint rule or plugin.

After each action, confirm in one line: `<target> — <created/updated/filed>`.

## Anti-patterns

- **Keeping the plausible-but-marginal.** Failure mode not 10 obvious-junk items — it that one tidy-sounding lesson with no structural cause behind it. Cannot name its evidence and mechanism that make it bite next person → fail keep-bar regardless how reasonable it read. This the trap to watch.
- **A flow-level item with no evals test.** Cannot state failing-before / passing-after scenario → not flow-worthy — downgrade, route to a domain reference when the lesson is a technology constraint, or drop. No shipping to team plugin on vibes.
- **Editing the installed plugin.** Flow lessons go to repo, not local skill file — local edit drift and die on next install. Routing to repo = whole point.
- **Writing before approval.** Wrong capture pollute every future run.
- **Forcing a capture when nothing surfaced.** "No learnings worth keeping this session" = _expected_ result, not failure to be useful.
