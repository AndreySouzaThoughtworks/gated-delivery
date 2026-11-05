---
name: audit-flow
description: Periodic health audit of the gated-delivery flow itself (skills, agents, hooks), not of user code: runs the consistency guard, then a judgment pass for overlap, conflict, gaps and bloat, and proposes trims. Use before a gated-delivery release, when the flow feels bloated, after adding skills or rules, or on "audit the flow", "is the flow still coherent", "trim the flow". Propose, never silently write.
---
# audit-flow — keep the flow coherent and trim

Audits **the flow itself**, not your code. Over time flow accretes — skills, hooks, doc sections — start overlap, contradict, rot. This periodic top-down check that accreted set still hangs together. Complements `learn-flow` (lessons per session) and `senior-review-lens` (product code).

Default to **trim**: win come from removing redundancy and resolving conflicts, not adding more.

## Step 1 — Deterministic guard (the mechanical floor)

The checker lives in the gated-delivery repository, not the installed plugin. When `scripts/audit/consistency.ts` exists in the audited repository, run it, report findings, **quote its summary line verbatim** (`gated-delivery audit: N skills, N agents, N hooks`) as proof it ran; a result with no quoted output is indistinguishable from a guess. Same gate CI runs:

```bash
node scripts/audit/consistency.ts
```

When the file does not exist, say that the mechanical guard was not run and why, go to Step 2, and report the Mechanical section as "guard not available in this checkout", never "clean".

**Errors** are mechanical. Fix them, or, if the flow lives in a different checkout, file them. Don't proceed to Step 2 with the guard red.

**Warnings** (orphan hook files, eval-lint findings) do **not** turn the guard red and are **not** mechanical: each needs a human to confirm a real collision, because some are intentional. Treat them as input to Step 2, not drift to fix on sight.

## Step 2 — Judgment pass (what a script can't see)

Read current skills, agents, hooks, and `senior-review-lens` lenses, then look for these:

- **Overlap / double coverage.** Two things enforcing same rule. Check skill steps against each other (e.g. same reviewer running at two checkpoints) and against `senior-review-lens` lenses; check verify/format/guard hooks don't fight skill step.
- **Conflict.** Two rules pulling opposite ways, or hook fighting skill step.
- **Coverage gaps.** Class of mistake nothing catch — name as candidate new rule (don't build here; that a proposal).
- **Doc bloat.** Note/section now redundant with table or another doc (we trim these aggressively). Dangling cross-links, stale "we will…" language, duplicated explanations.
- **Dead weight.** Skill/hook/check nobody would miss if it were removed.

## Step 3 — Usage (be honest about what you can and can't know)

**No skill-invocation telemetry** — don't claim usage numbers you can't measure. Use only real signals: git churn on flow repo, eslint-rule churn in consuming repos, and **what the team reports**. Where rule *looks* unused or over-broad, flag as question for team — never retire rule on inferred usage alone.

## Step 4 — Report and propose

Emit:

```
## Flow audit — <date>

### Mechanical (consistency guard)
- <drift found> → <fix> (or: clean)

### Overlap / conflict / gaps
- <finding> — <which pieces> — proposed resolution (trim X / merge X+Y / add Z)

### Trim candidates
- <doc/section/rule> — why it is no longer needed

### Usage questions for the team
- <rule that looks unused/over-broad> — ask, don't assume

### Dropped (considered, keeping)
- <thing> — why it stays

### Route
- PR (or issue) against the gated-delivery repo: <title> — <which proposals it carries>
```

The Route line names the gated-delivery repo even when this checkout is not that repo. A local commit, a branch kept here, or "apply once approved" is not a route: it reaches no other install. Flow-level changes go there as a PR or an issue, the `learn-flow` path.

**Propose, never silently write.** Mechanical drift fixes can apply directly (not judgment). Every trim/merge/retire of rule or doc is proposal: get sign-off, then PR. Never retire or trim a rule in the same session you flag it, even when told to apply it — apply only mechanical drift fixes.

