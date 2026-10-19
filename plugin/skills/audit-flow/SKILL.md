---
name: audit-flow
description: Periodic health audit of the gated-delivery flow itself (skills, agents, hooks), not of user code: runs the consistency guard, then a judgment pass for overlap, conflict, gaps and bloat, and proposes trims. Use before a gated-delivery release, when the flow feels bloated, after adding skills or rules, or on "audit the flow", "is the flow still coherent", "trim the flow". Propose, never silently write.
---
# audit-flow — keep the flow coherent and trim

Audits **the flow itself**, not your code. Over time flow accretes — skills, hooks, doc sections — start overlap, contradict, rot. This periodic top-down check that accreted set still hangs together. (Complement to `learn-flow` (`skills/learn-flow/`), which capture lessons bottom-up per session, and `senior-review-lens`, which audit product code.)

Default to **trim**: win come from removing redundancy and resolving conflicts, not adding more.

## When to invoke

- Before cutting gated-delivery release.
- After several skills / hooks landed.
- When flow feel bloated, or user say "audit the flow" / "is this still coherent" / "trim it".

## Step 1 — Deterministic guard (the mechanical floor)

Run consistency checker, report findings, **quote its summary line verbatim** (the `gated-delivery audit: N skills, N agents, N hooks` line) as proof it ran. Reported result with no quoted output indistinguishable from guessed one. Same gate CI runs:

```bash
node scripts/audit/consistency.mjs
```

**Errors** — missing skill files, name/dir mismatches, dangling hook and marketplace references, wrong README counts, undocumented skills/agents. **Fix these mechanically** (not judgment calls) — or, if flow live in different checkout, file them. Don't proceed to Step 2 with guard red; coherent review need accurate inventory.

**Warnings** — orphan hook files, skill whose `evals.md` carry no `## Deterministic Checks` fence (so `--lint` measure nothing for it), and two eval-measure traps: pipe inside table-cell code span (truncates rendered command), and measure keyed on word that also one of skill's own headings (can score failing run as pass). These do **not** turn guard red and are **not** mechanical: each need human to confirm real collision, because some intentional. Treat as input to Step 2, not drift to fix on sight.

## Step 2 — Judgment pass (what a script can't see)

Read current skills, agents, hooks, and `senior-review-lens` lenses, then look for these:

- **Overlap / double coverage.** Two things enforcing same rule. Check skill steps against each other (e.g. same reviewer running at two checkpoints) and against `senior-review-lens` lenses; check verify/format/guard hooks don't fight skill step. (The verification gate runs the client's Verify command; there is no bespoke rule set to dedupe.)
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
```

**Propose, never silently write.** Mechanical drift fixes can apply directly (not judgment). Every trim/merge/retire of rule or doc is proposal: get sign-off, then route flow-level changes to the gated-delivery repo as a PR or an issue — same repo→release path `learn-flow` use, so change reach every install.

## Anti-patterns

- **Adding more than you remove.** An audit that only grows the flow failed its job.
