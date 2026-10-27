---
name: learn-flow
description: Reflect at a session break and turn each mistake into a proposed deterministic check (extend an existing guard, lint rule or test, else add one wired into CI and the watcher), with a failing example proving it rejects the bad case. Only a mistake no machine can detect becomes a prose rule, routed by scope: gated-delivery change proposal, client, repo or global CLAUDE.md. Use on /learn-flow, "what did we learn", "lessons learned", "let's capture this", or after a /slice or /spec session with friction. Propose, never silently write.
---
# learn-flow — turn session mistakes into checks

Prose rules drift; a check fails. Every mistake an agent makes should end as a deterministic check that rules out the whole category — the repo is the shared context, so harden the repo, not the agent. This skill = **capture** half of loop: reflect on session, keep only what survives the bar, encode each survivor as a check. Plugin installed read-only and shared, so flow-level change cannot be local edit — go to **gated-delivery repo**, reach every install.

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

After a `/slice` session, scan two places for the ticket(s) worked. **The Local notes home** — `## Delivery notes` in the client's CLAUDE.md, default `~/.local/state/gated-delivery/` — holds the executor's raw entries: assumptions, surprises, deviations, `## REFACTOR-NOTE`s. **`handoff.md` in the Shared notes home** — same section, default `docs/gated-delivery/{ticket-id}/` — holds what `/slice` step 7.6 promoted out of those notes: evidenced carry-forward items and the decisions taken at each slice-end checkpoint. Both are ready-made evidence you otherwise miss; the notes are richer, the handoff is what survived.

If nothing overturn null in 30 seconds, say so and stop. Typing `/learn-flow` does **not** obligate capture — "nothing this time" = common, correct outcome.

## Step 2 — Apply the keep-bar (drop is the default)

Each candidate **presumed dropped**. Survive only if clear **both** gates — name evidence and mechanism inline, so reader can check work:

- **Evidence.** Point to concrete moment it happened — exact correction, agent-notes or `handoff.md` line, error/stack, command that failed. No pointer → vibe → drop.
- **Mechanism.** Name _why this bite again_ — structural cause in tool/repo/flow, not accident of this session. Test: _"would next person on same path hit same wall, because of how things are built?"_ If depend on this session specifics (transient flake, one-time bad merge) → drop. Prior sighting (matching agent-notes entry, memory file, "second time I hit this") = _strongest_ corroboration — bonus, not requirement.

## Step 3 — Encode as a check (the primary artifact)

For each survivor, name the **category** first: the whole class of mistake, not this instance. Then pick the first rung that fits:

1. **Extend an existing check.** A rule, guard, lint config or test the repo already runs. Cheapest; no new surface.
2. **New check wired into the repo's CI and watcher.** Lint rule, test, script or guard, run where failures reach the agent (watcher, pre-commit, CI) so it self-corrects from the error. Prefer a standard rule or plugin over a bespoke checker.
3. **Prose, only when no machine can decide it** (judgment, taste, intent). Say why it cannot be a check; routed by scope in Step 4.

**Failing example is the third gate.** A check proposal must include input the check rejects, and the command showing it fail. A check that cannot fail proves nothing. Cannot produce the failing example → not a check yet; drop it or fall to rung 3.

Rules about the rules: a change that loosens a check (disable, ignore, lowered threshold) needs its own check or reviewer, so the loosening fails too.

**Flow-level prose clears a gate of its own.** To route a prose or skill edit to gated-delivery repo you must **state the `evals.md` scenario it would add**: failing-before / passing-after, in shape of that skill existing scenarios. A flow-level _check_ (audit guard, hook test) needs only its failing example. A lesson about a _technology_ (field the platform discards, setting with no effect) belongs in a domain reference, which needs neither.

## Step 4 — Route what stays prose (by scope)

Only rung 3 lessons land here. Pick by _who benefits_:

- **Flow-level → gated-delivery repo.** Skill/agent/hook/recipe behaviour, or convention for **everyone** using flow. Route as **change proposal to the gated-delivery repo, as a PR or issue**.
- **Domain reference → `plugin/references/`.** Constraint of a *technology* a competent engineer would not guess. Same route as flow-level. Admission test in `references/reference-graph.md`.
- **Client-level → client's CLAUDE.md overlay.** True across one client's repos, not others. Edit the section `../../references/client-context.md` (relative to this file) names. Never into core plugin.
- **Repo-level → `<repo>/CLAUDE.md`.** Specific to _this_ codebase.
- **Personal → `~/CLAUDE.md`.** How _you_ like work.
- **Drop.** Failed gate, already documented, or too narrow. Showing what you dropped, and which gate it failed, build trust in filter.

Lesson fit two → pick most durable / widest-reaching (flow > reference > client > repo > personal > drop).

## Step 5 — Propose

**If nothing survived Step 2, print this line:**

```
No learnings cleared the bar this session.
```

Then, for each candidate you considered, one line naming the gate it failed with one of these labels verbatim: `Dropped: <candidate> — <no evidence | incidental, no mechanism | no failing example | no evals test | already documented>`. A reason in your own words may follow the label. No other output.

No empty headings. Render section only for something that survived. Print just those sections, then ask **"Approve which of these?"** (`AskUserQuestion` if 2+ items):

```
## Session learnings

### Check → <repo>
- Mistake: <this instance>
  Category: <whole class it belongs to>
  Check: <extend <file/rule> | new <file/command>>
  Runs in: <watcher / pre-commit / CI job>
  Fails on: <failing example and the command that shows it rejected>

### Prose (no check possible) → <destination>
- <exact line, or issue title / one-line PR change>
  Why not a check: <what a machine cannot decide>
  evals test: <flow-level only: failing-before / passing-after, one line>

### Dropped (only items you actually considered)
- <bullet> — <gate it failed>
```

**Hard rule: propose, don't write.** Draft every edit, issue, PR, check in conversation first. Persist only what user explicitly approve — one item rejected ≠ all rejected.

## Step 6 — Apply approved items

- **Check** → in the repo being worked on, edit the config or add the check, run its failing example and show it fail, then run the suite green. In another repo or flow-wide: route as PR to it, or to the gated-delivery repo. Never edit installed plugin copy in place.
- **Flow-level / domain reference prose** → `gh issue create` with drafted title/body, or a draft PR if small and concrete, against the gated-delivery repo. Versioned; changes reach users through repo and re-install. Report the URL. A reference row needs its file: the guard fails CI otherwise.
- **Client / Repo / Personal prose** → `Edit` target CLAUDE.md on exact section. Show one-line diff.

After each action, confirm in one line: `<target> — <created/updated/filed>`.

## Anti-patterns

- **Keeping the plausible-but-marginal.** The failure mode is not ten obvious-junk items; it is one tidy-sounding lesson with no structural cause behind it. This is the trap to watch.
