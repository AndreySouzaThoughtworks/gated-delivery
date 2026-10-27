# gated-delivery — skills, agents & hooks

**The** inventory of what the `gated-delivery` plugin ships and how the pieces call each other — other docs link here, not restate. `scripts/audit/consistency.mjs` fails CI if a skill or agent is missing below. Skills are invoked by `/skill-name` or `Skill(name)`; agents by `Agent(subagent_type: name)`; hooks fire automatically on lifecycle events. Client specifics — tracker, notes homes, stack recipes, reviewers — come from the client's CLAUDE.md as described in [client-context.md](../plugin/references/client-context.md).

## Workflow skills

| Skill | Purpose | Invoke when |
|-------|---------|-------------|
| `/slice` | Orchestrate a ticket through independently merging Rollout slices, running each wave of independent slices in parallel worktrees (Route W). Each slice gets one branch and PR; functional batches dispatch `slice-executor`; merge-boundary gates run before every PR becomes ready; a shared handoff in the client's shared notes home preserves resume context and records harvested outcomes. | Start or resume ticket implementation. Pass an ID such as `PROJ-123`. |
| `/spec` | Turn a ticket into one signed-off spec using the plugin change template. Adds architecture, domain, and threat lenses plus an ordered Rollout of safe PR-sized slices grouped into parallel waves, and an optional dependency graph when topology adds information. | Before `/slice`, normally through Route A; may run standalone. |
| `/prod-support` | Directed diagnosis of a production incident ticket — intake from the tracker's fields, ranked hypotheses, cheapest probe, fix, local findings corpus. | Production issue or customer-reported regression. |
| `/repo-forensics` | Inspect-first pass before a change exists: verified versus inferred, where surfaces disagree, blast radius and the smallest safe next step, never code. | `/slice` step 0 (quick posture), `/spec` step 3 (full pass), or before touching existing code. |
| `/senior-review-lens` | Structural self-audit over code or design decisions. Runs on multi-batch diffs, complete slices, and the merged ticket; Lens H examines open design decisions. | During `/slice`, `/spec`, or standalone structural review. |
| `/learn-flow` | Reflect at a session break; turn each mistake into a proposed deterministic check (extend an existing guard, else a new check in CI and the watcher) with a failing example that proves it rejects the bad case. Only a judgment lesson stays prose, routed by scope: this repo as an issue or PR, the client's CLAUDE.md, the repo `CLAUDE.md`, or the global `CLAUDE.md`. Propose, don't write. | End of a `/slice` / `/spec` session, or when the user says "what did we learn". |
| `/audit-flow` | Audit the flow itself: deterministic consistency guard (`scripts/audit/consistency.mjs`) plus a judgment pass for overlap / conflict / gaps / bloat across skills, hooks, lenses. Bias toward trimming; propose fixes as PRs. | Before a release, when the flow feels bloated, or "audit the flow". |
| `/primer` | Research a topic and render a styled, WCAG-AA HTML "primer" — a skim-able top-to-bottom explainer (numbered sections, key box, SVG diagrams, tables, glossary). Labels claims Verified/Inferred; signs off the outline before rendering into `templates/primer.html`. Stands apart from the dev-flow loop — a knowledge/doc tool. | "Make me a primer / mental-model doc / explainer on X" when a shareable artifact is wanted. |
| `/deskcheck` | Render completed work as a self-contained HTML walkthrough of value, criteria, a runnable demonstration and settled decisions, then record the feedback in the same file. | "Deskcheck PROJ-123" or preparing a demo of finished work. |
| `/issue-writing` | Draft, refine, review and safely publish a tracker issue as a Story, Task, Bug or Spike against its own template in `templates/`. | Authoring or grooming any ticket; `/spec` 10 and `/slice` 7.6 and 9 route tracker writes through it. |
| `/prose-writing` | Construction, relevance and placement pass over prose that outlives the conversation — commit messages, PR text, code comments, markdown, spec sections, skill and agent instructions, ticket text. The rules live in `writing.md` beside the skill; the skill holds the pass that applies them. | Before writing or editing durable prose, and before staging a docs change. |
| `/story-drift` | Check a groomed Story or Task against its linked tickets, epic, specs, decision records and PRs, and report only what makes its text wrong now. | Before `/spec` on a ticket groomed a while ago. |

## Commands

| Command | Purpose |
|---------|---------|
| `/gated-delivery:commit` | One commit following the client's `## Commit convention`, else plain Conventional Commits; explicit per-path staging. Covered by `tests/commit-convention.test.sh`. |
| `/gated-delivery:commit-push-pr` | Commit, sync with the remote tip, checkpoint, push to an explicit refspec, open the PR. |

## Agents

| Agent | Purpose | Invoked from |
|-------|---------|--------------|
| `slice-executor` | Mechanical TDD batch worker — consumes one spec, a batch's ACs, and a machine-local notes path; produces one failing test, minimal implementation, and a commit per AC. | `/slice` step 6.1 only. |
| `code-reviewer` | Fresh-context adversarial correctness gate using the current slice diff and full AC text. | `/slice` step 7.5 before every slice PR becomes ready. |

## Hooks (`hooks/hooks.json`)

| Event | Hook | Behaviour |
|-------|------|-----------|
| PreToolUse (Bash) | `guard-bash.mjs` | Denies a narrow catastrophic set (`rm -rf` on `/`/`~`/`$HOME`, force-push to main/master, fork bomb). |
| PostToolUse (Edit\|Write) | `format-on-edit.mjs` | `prettier --write` on the edited file; no-op without prettier. |
| Stop | `verify-on-stop.mjs` | When uncommitted changes exist, runs `GATED_DELIVERY_VERIFY_CMD` (default `pnpm lint`) and blocks turn-end until it passes. No-ops when the repo has no such script, and when the change is out of scope — no lint-able file types, or nothing under the roots the repo's own lint script names. Plugin-safe (`decision:"block"`); after `GATED_DELIVERY_VERIFY_MAX_BLOCKS` blocks it releases for the rest of the session. |

## Domain references (`plugin/references/`)

Knowledge rather than workflow. Indexed separately because a skill reads the index, never a reference by name. Client-owned references are named in the client's `## Domain references` instead.

| Index | Covers |
|-------|--------|
| [`reference-graph.md`](../plugin/references/reference-graph.md) | Every domain reference this plugin ships, with the work that should trigger reading it. Both directions guarded by `scripts/audit/consistency.mjs`. |
| [`client-context.md`](../plugin/references/client-context.md) | The client-context contract: every CLAUDE.md section and key a skill reads, with its default. Not a domain reference; skills that read client keys point at it by path, and `reference-graph.md` indexes it so the guard keeps it reachable. |

## Referenced but NOT bundled here

Named per client in its CLAUDE.md (`## Stack recipes`, `## Review routing`, `## Domain references`):

| Dependency | Used by |
|------------|---------|
| Stack recipes (production code, tests, framework patterns) | `/spec`, `/slice`, `slice-executor` |
| Stack validator and security reviewer agents | `/slice` 6.5 and 7.1 |
| Domain reference docs | `/spec`, `/slice` |

## Skill graph

```
/slice
  ├── step 0  Skill(repo-forensics) quick posture
  ├── /spec                                               (Route A)
  ├── scripts/slice-tree.sh, one tree per wave slice      (Route W, references/parallel.md)
  ├── Agent(slice-executor)                               (6.1, per functional batch; a round's batches in parallel batch trees)
  ├── scripts/batch-pick.sh                               (6, a parallel round's batches back onto the slice)
  ├── repository test command, under verify-lock.sh       (6.3, per batch)
  ├── Skill(senior-review-lens)                           (6.4, multi-batch slices)
  ├── security reviewer from Review routing, code scope   (6.5, conditional per batch)
  ├── draft PR                                            (6.6, after first batch)
  ├── stack validators from Review routing                (7.1, once per slice)
  ├── security reviewer, supply-chain scope               (7.1, manifest changes)
  ├── full repository verification, under verify-lock.sh  (7.2, once per slice)
  ├── Skill(senior-review-lens)                           (7.3, complete slice)
  ├── Agent(code-reviewer)                                (7.5, current slice ACs)
  ├── slice review + shared handoff → ready PR → merge → next wave (7.6–8)
  ├── Skill(issue-writing)                                (7.6 refactor-note ticket, 9 flag-removal tickets and harvest)
  └── Skill(senior-review-lens)                           (9, merged ticket)

/spec
  ├── Skill(repo-forensics) full pass                     (3)
  ├── architecture flow-sketch                            (3, when triggered)
  ├── domain-model lens                                   (3d)
  ├── security/threat STRIDE                              (3e)
  ├── ordered Rollout, waves + optional PR graph          (5)
  ├── Skill(senior-review-lens) Lens H                    (6, open decisions)
  └── Skill(issue-writing)                                (10, link comment scan and reconcile)

hooks (always-on, underneath every loop):
  PreToolUse(Bash) guard · PostToolUse(Edit|Write) format · Stop verify-gate
```
