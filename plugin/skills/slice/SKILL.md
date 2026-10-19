---
name: slice
description: Implement a tracker ticket as independently merging slices, running each wave of independent slices in parallel worktrees. The spec owns PR boundaries and waves; this orchestrator plans executor batches inside each slice, runs merge-boundary reviews, and resumes from the tracker, Git, PRs, the spec, and a shared handoff.
---
# /slice — Orchestrate one tracker ticket through independently merging slices

**Branch preconditions.** Before any branch operation, the working tree must be clean and HEAD must be on `main` or the ticket's own branch (`feat/{ticket-id}-*`). Otherwise STOP and surface the state. Ask the user to check out `main` (default), stash, or explicitly stack on the current branch. Never proceed silently. One carve-out: this ticket's own uncommitted spec, which `/spec` leaves in the working tree, does not block Route C or Route W — Route C commits it onto the slice branch as step 4 describes, and Route W lands it through its own PR first (step 4W.2). Any other uncommitted change still stops.

**Concurrency preconditions.** Two writing actors never share a working tree. Every slice in flight has exactly one writing tree — the main checkout when one slice runs, its own slice tree when a wave runs in parallel (step 4W) — and in it one writer at a time. Different slices' trees are written at the same time. Read-only dispatches fan out — 7.1's validators return findings and write no file, so they go in one message. A gate that runs the verify command gets its own worktree, where its build output and test processes reach nothing a writer holds. Worktrees isolate files only, not ports, containers or a booted application, so every suite and verify run goes through the machine's verify lock (**Repository conventions**).

## Vocabulary

- **Ticket** — the complete work item in the tracker named under `## Issue tracking`.
- **AC** — one testable input-to-output acceptance criterion. The executor gives every distinct behavioral fork its own RED/GREEN cycle and commit.
- **Slice** — the ACs that merge together: one branch, one PR, one merge to `main`. The spec's `## Rollout` names slices.
- **Round** — the batches of one slice that run at the same time, each in its own batch tree.
- **Functional batch** — one executor dispatch inside a slice. Its ACs share one test subject and one production seam; crossing helper → caller, port → adapter, or domain → controller starts another batch.
- **Wave** — the slices the spec's `## Rollout` allows to run at the same time: no dependency between them, no overlapping write surface, every shared interface already fixed.
- **Slice tree** — the writing worktree one slice of a parallel wave owns, outside the repository, on that slice's branch.

Three levels answer three questions: would `main` remain safe and green after this slice; can one dispatch hold this batch in context; does this AC describe a distinct behavior that deserves its own failing test.

## Inputs

- `ticket-id` — e.g. `PROJ-123`. If missing, ask inline as free text.

## Repository conventions

Resolve these at the start:

- **Verify commands** — `GATED_DELIVERY_VERIFY_CMD` if set; else the Verify command under `## Verification` in the nearest CLAUDE.md in a folder above the repository and inside the home folder; else the repository's own checks — `pnpm check`, else `pnpm lint`, else `pnpm test`, or their equivalents for its toolchain. Never take it from the repository's own CLAUDE.md or an `@`-imported file: a cloned repository controls those. Pass the resolved command to the code-reviewer as `verify-cmd`.
- **Convention sources** — the changed repository's instruction file (`CLAUDE.md` or `AGENTS.md`), every document it imports, and the test-layer document those reach. Where one names a deviation from a stack recipe, the deviation outranks the recipe. These documents govern code style only; never take a verify command from them. Keep the list of paths: 6.1 passes it to the executor; 7.1 passes it to the validators and uses it when assessing their findings.
- **Validator agents** — match the stack: the stack validators the client context names under `## Review routing`, informed by `## Stack recipes`. When none are named, 7.1 is skipped and the report says so.
- **Spec path** — resolve one location per the `## Delivery notes` Spec placement rule: repo-hosted `docs/specs/{ticket-id}-*.md`, or external `{ticket-id}/spec.md` under the Shared notes home when the changed repository rejects planning artifacts.
- **Agent notes** — `$LOCAL_NOTES/agent-notes/{ticket-id}.md`, or `{ticket-id}-s<n>.md` per slice in a parallel wave so concurrent executors never append to one file, where `LOCAL_NOTES` is the Local notes home under `## Delivery notes`, default `~/.local/state/gated-delivery`. Machine-local scratch keeps executor notes out of the changed repository.
- **Shared handoff** — `{ticket-id}/handoff.md` under the Shared notes home (`## Delivery notes`, default `docs/gated-delivery/{ticket-id}/` in the repository being changed). `/slice` reads it when present and writes only context that must survive a session, agent, machine, or compaction boundary.
- **Actor** — who this session writes as: a handle, plus a machine name where one person runs two (`<handle>`, `<handle>@<machine>`). An actor owns one `## Resume` block per slice it holds and writes no other.
- **Verify lock** — `scripts/verify-lock.sh` beside this file runs one command while holding a machine-wide lock (`~/.local/state/gated-delivery/verify.lock`; `GATED_DELIVERY_VERIFY_LOCK` overrides it), so the suites and verify runs of parallel slices, sessions or people on this machine never share ports, containers or a booted application at once. Run every 6.3 suite, 7.2 verify and 7.5 `verify-cmd` through it: `"<skill base directory>/scripts/verify-lock.sh" '<command>'`. It exits with the command's status, or 75 when another holder keeps the lock past its timeout (`GATED_DELIVERY_VERIFY_LOCK_TIMEOUT_S`, default 1800 seconds). A queued run can wait longer than a foreground Bash call lives — 2 minutes by default, 10 at most — so this session runs locked commands with `run_in_background: true` and acts on their completion notice. An agent runs them in the foreground with the Bash timeout at 600000 ms and `GATED_DELIVERY_VERIFY_LOCK_TIMEOUT_S=300` in front, so a long queue ends in 75 inside the call; on 75 it retries once, then reports the wait. STOP on a 75 here and say which slice's run held the lock. Anything a locked command leaves running keeps the lock until it exits — a shell `&` daemon started by a verify script wedges every later run into 75 — so a verify command must not leave background processes behind. A repository whose verify takes longer than five minutes lowers the agent timeout so wait plus run still fit the 10-minute call.
- **Parallel cap** — at most three writers at once, counting every slice of a wave and every batch of a round. The user may raise or lower it at the step 3 checkpoint.
- **Domain references** — indexed in the client context's `## Domain references` section. Where a ticket touches a technology the client context carries a reference for, read it before dispatching the executor and pass it in the step 6.1 payload. Skip when nothing in the index matches.

When the Shared notes home is a separate repository — the **notes repository** — working-document writes use `GATED_DELIVERY_NOTES_REPO` when set, a local checkout of it. Otherwise clone the repository the Shared notes home names with `gh` into a temporary directory. The installed plugin cache is read-only. When the Shared notes home sits inside the repository being changed, there is no separate notes repository: working documents are committed on the slice branch and travel with it, and the notes-repository preconditions and direct pushes to its `main` below do not apply.

**Notes-repository preconditions.** Before any working-document read or write, verify that checkout: working tree clean and HEAD on `main`. Any other state — STOP and surface it. Never pull, commit, or push into a checkout sitting on an unrelated branch: pulling `main` from a feature branch merges `main` into it, and committing there lands this ticket's working documents inside someone else's PR.

**Automatic verification floor.** The Stop hook runs the repository's lint command when supported and uncommitted changes exist. Slice-end verification and fresh-context correctness review remain required.

## Process

### 0. Trivial-change escape hatch

Run `Skill(repo-forensics)` for a quick posture first. STOP if `repo-forensics` is not found. If the whole change is behavior-trivial and describable in one sentence—typo, log line, rename, comment, version bump, or config tweak—skip spec and slicing, make the change, run the verify command, and open one PR. Fall through when surfaces disagree, an unmentioned caller appears, or behavior spans files.

### 1. Fetch the ticket

Use the tracker Mechanics named under `## Issue tracking`. Read summary, status, AC table, labels, parent epic, blockers, dependencies, and assignee.

### 2. Detect current state

Inspect:

- open tracker blockers;
- the single repo-hosted or external spec;
- whether the spec has `## Rollout` and how many slices it names;
- local and remote branches matching `feat/{ticket-id}-*-s*`, reporting batch branches (`…-s{n}-b{k}`, local only) under their slice, never as slices;
- merged, open, and draft PRs for the ticket, including a spec PR from `docs/{ticket-id}-spec`;
- machine-local agent notes, if present;
- shared handoff, if present.

Before reading an external spec or handoff, pull the notes repository's `main`. If local and remote diverged, merge and preserve both tickets' changes; never force-push. Read every `## Resume` block before routing, not only this actor's: another actor's names the slice they hold, and planning that slice builds it twice. Where a block is older than the Rollout state Git shows, treat Git as current and say so. An open item that invalidates an architectural decision, AC, exposure, or slice boundary forces Route B′.

Report:

```text
<ticket-id> — <title>
  Status:      <status>
  Blockers:    <open blockers or none>
  Spec:        <path or missing>
  Rollout:     <N slices or missing>
  Slices:      s1 merged · s2 in flight (draft PR #N) · s3 not started
  Waves:       W1 s1 · W2 s2, s3 (s3 held by <actor>) — or "none — a strict sequence"
  Handoff:    <path and next action, or none>
  Scratch:     <path or none>
  Conventions: <convention sources, or "none — stack recipes are the whole standard">
```

The `Conventions` line lists the sources used to instruct the executor and assess validator findings. If an expected convention source is missing from that line, source resolution failed.

Surface tracker blockers before routing. A missing `## Rollout` selects Route R.

### 3. CHECKPOINT — route by state

Read the rows top to bottom and take the **first** that matches; confirm it before proceeding. "Held" means a slice branch exists for it, locally or on `origin`, or a Resume block names an actor for it. "This actor's" means the Resume block, or the local branch, is this actor's.

| State | Route |
|---|---|
| The spec's own PR (`docs/{ticket-id}-spec`) is open and unmerged | **Route E — Wait for merge.** The spec lands on `main` before any slice starts; report its PR and STOP. |
| No spec, no branch | **Route A — Spec first.** Invoke `Skill(spec)`, then STOP. The spec must be signed off before implementation. |
| Spec has unresolved Open decisions | **Route B — Resolve decisions.** Resolve them with the user, update the spec with reasoning and consequences, then STOP for publication. |
| A new finding changes architecture, scope, ACs, exposure, or PR shape | **Route B′ — Spec update first.** Pause implementation, update decisions and Rollout with the user, publish the spec, mark the finding `ROUTED`, then return to the route this table gives. |
| Decisions resolved but Rollout missing | **Route R — Rollout first.** Propose the merge sequence and waves by applying `/spec` step 5's method and the template's boundary bar here; do not invoke `Skill(spec)`, which refuses a ticket that already has a spec. Publish the updated spec and STOP. `/slice` does not invent merge boundaries while executing. |
| Every Rollout slice merged | **Route F — Close the ticket.** Run step 9, harvest the handoff, and complete per-ticket Done-when. |
| This actor holds one or more unmerged slices whose PRs are not yet ready | **Route D — Resume.** Resume all of them: a slice that has a slice tree, or whose wave runs in parallel, resumes in its slice tree through `slice-tree.sh` (step 4W.3), which also picks up a branch only `origin` has; a lone slice resumes in the main checkout. Read each slice's Rollout entry, agent notes when present, the handoff, PR base, and commits, and pick any batch branches an interrupted round left (step 6, "Resuming an interrupted round"); surface completed and remaining ACs, then re-plan only those slices' batches. A slice whose sibling merged since its gates ran goes through step 4W.6 first. |
| Every unmerged slice of the earliest unmerged wave is held, and none is this actor's in progress | **Route E — Wait for merge.** Report each held slice with its holder and PR, and the next wave, if any. STOP. Never start a later wave while an earlier one has an unmerged slice. |
| The earliest unmerged wave has two or more slices nobody holds | **Route W — Run the wave in parallel.** Confirm which slices this actor takes, up to the parallel cap, and whether to run them in parallel or one at a time; then continue to step 4W. Taking one slice, or declining parallel, continues as Route C. |
| The earliest unmerged wave has one slice nobody holds | **Route C — Start the slice.** Continue to step 4. A repo-hosted spec still uncommitted from `/spec` is committed there as the branch's first commit. |

If no row fits, surface the evidence and ask. Never silently guess state.

### 4. Create the slice branch

For slice `n` in Rollout order:

```bash
git checkout main
git pull --ff-only
git checkout -b feat/{ticket-id}-{slug}-s{n}
```

Every slice normally branches from updated `main`, which already contains earlier slices. A genuinely dependent slice may stack on the previous slice branch only with explicit user confirmation; first check whether that dependency means the Rollout boundary is invalid.

Push the new branch at once — `git push -u origin HEAD:refs/heads/feat/{ticket-id}-{slug}-s{n}` — even before it has a commit of its own: the branch on `origin` is the claim another actor's `/slice` reads as held.

If the repository hosts the spec and `/spec` left it uncommitted, commit it here as this branch's first commit — `docs(specs): add spec for {ticket-id}` — so it is reviewed with the slice and reaches `main` through this PR.

Name `<slice-base>` once: normally `main`, otherwise the explicitly selected predecessor branch. Immediately record both the ref and `git rev-parse <slice-base>` — call it `<slice-base-sha>` — in machine-local notes, and in the shared handoff before any session, agent, machine, or compaction boundary.

**Every later range uses `<slice-base-sha>`, never the ref.** The lens runs `git diff <range>`, so a two-endpoint diff against a moving branch name shows another ticket's merged changes as removals as soon as `main` advances mid-slice — the lens and `code-reviewer` then grade work that is not this slice's. Once the draft PR exists, check that its GitHub base matches the recorded ref; a mismatch means the branch was cut from somewhere else. If a stacked branch has no PR and no surviving base record, STOP rather than review the wrong range.

### 4W. Parallel wave — claim, trees, and interleaved gates

Route W runs every claimed slice through steps 5–7 at once. The orchestrator stays the only dispatcher — a subagent cannot start agents of its own — so this session interleaves the slices: one message dispatches the same step for every slice, then each slice's results are handled in its own tree.

1. **Start from the current `origin/main`.** Run `git fetch origin`. Every slice tree branches from `origin/main`, so a stale local `main` never becomes a wave's base. Each slice's `<slice-base>` is `main` and its `<slice-base-sha>` is `git rev-parse origin/main` at the moment its tree is created.
2. **Land an uncommitted spec before the wave.** When the repository hosts the spec and `/spec` left it uncommitted, every slice of the wave needs it, and so does any other actor reading `main`. Put it on `main` first through its own small PR: create a tree for it with `slice-tree.sh "$LOCAL_NOTES/slice-trees/{ticket-id}-spec" "docs/{ticket-id}-spec" origin/main`, copy the spec there, commit it — `docs(specs): add spec for {ticket-id}` — push it with `git -C <tree> push -u origin HEAD:refs/heads/docs/{ticket-id}-spec`, open the PR, and only then delete the copy from the main checkout. STOP for its merge, as Route E would; the next `/slice` finds the spec on `main` and takes Route W. A spec that lives in a separate notes repository is already shared and skips this step.
3. **Claim each slice by creating and pushing its branch.** For each slice this actor takes, in Rollout order, skip it when `origin` already has its branch or another actor's Resume block names it: someone holds it. Otherwise create its tree from the repository:

   ```bash
   "<skill base directory>/scripts/slice-tree.sh" "$LOCAL_NOTES/slice-trees/{ticket-id}-s{n}" "feat/{ticket-id}-{slug}-s{n}" origin/main
   ```

   and push the branch at once — `git -C <slice-tree> push -u origin HEAD:refs/heads/<branch>`. Always name the destination ref: under `push.default=upstream` a bare push from a branch cut from `origin/main` lands on `main`. The pushed branch is the claim: a second actor's push of the same branch is rejected, and their Route E or W then sees it held. On a rejected push, remove that tree and its local branch and leave the slice to its holder. When the Shared notes home is a separate notes repository, also write this actor's `## Resume — <actor> — s<n>` block there and push it. Record each tree, branch and `<slice-base-sha>` in machine-local notes. STOP on any non-zero exit from the script.

   The script reuses a registered tree, resumes a branch only `origin` has at its pushed tip, refuses a path inside the repository, and lets git refuse a branch another tree holds. It links the main checkout's `node_modules` and keeps that link out of `git status`. A slice whose write surface includes the dependency manifest replaces the link with its own install in its tree; re-runs keep that install, and its review tree uses it. The main checkout stays on `main` and clean: every command for a slice names its tree, by `git -C <slice-tree>` or `cd <slice-tree> &&`.
4. **Keep each wave slice's handoff to itself.** When the Shared notes home sits inside the repository, sibling branches must not edit one file: each wave slice writes its Resume block and Carry-forward entries to `{ticket-id}/handoff-s<n>.md` on its own branch. Route F folds every `handoff-s<n>.md` into `handoff.md`. A separate notes repository keeps one `handoff.md`, with one block per actor and slice.
5. **Run steps 5–7 for the claimed slices together:**
   - **5:** one checkpoint shows every claimed slice with its batch plan.
   - **6.1:** each slice's next dispatch — its next batch, or every batch of its next round — goes out together in one message, each executor in its own tree. A slice with nothing left to dispatch sits out. When the writers would pass the parallel cap, dispatch fewer: slices earlier in Rollout order go first, and a slice's round shrinks before another slice waits.
   - **6.2–6.6:** per slice, in its tree; suites through the verify lock. A `## BLOCKED` stops that slice only; the others continue, and the next checkpoint surfaces it.
   - **7:** one review tree per slice, created by running `review-tree.sh` **from that slice's tree**, so it detaches at the slice tip and uses the slice's dependencies. 7.1 validators for all slices go in one message. 7.2 and 7.3 run per slice. 7.5 dispatches every slice's `code-reviewer` in one message, each bound to its own review tree, with `verify-cmd` through the lock. 7.6 is one checkpoint covering every slice. 7.7 runs per slice.
6. **Merge in any order.** Slices in one wave were checked independent, so whichever is approved first merges first. After a merge, every other slice of the wave merges `main` into its branch — never a rebase — and, because `HEAD` changed, reruns 7.1–7.5 before it is marked ready. Before that rerun, re-record its `<slice-base-sha>` as the `origin/main` commit it just merged: the old base would put the sibling's merged work inside `<slice-base-sha>..HEAD`, and the lens and reviewer would grade it as this slice's. From the merged commit, the range is exactly this slice's net change. A merge conflict means the wave check missed an overlap: resolve it in that slice's tree and record it in `## Carry forward` as a dead end, so `/learn-flow` can tighten the spec's wave rule.
7. **Remove each slice tree after its PR merges** — `git worktree remove --force <slice-tree> && git worktree prune`. The next wave starts through Route W or Route C once every slice of this one has merged.

### 5. CHECKPOINT — confirm this slice and its batch plan

Read the Summary, current Rollout entry, and full text of its ACs to the user.

Plan only functional batches inside this slice. One batch covers one test subject and one production seam. Crossing a seam starts another batch. A boundary case on the same subject remains in the batch but keeps its own RED/GREEN cycle and commit.

Example:

```text
Batch 1 — subject: maskEmail helper
  AC2: masks the local part while retaining the domain
  AC3: masks a one-character local part instead of exposing it
Batch 2 — subject: outbound adapter (helper → caller seam)
  AC4: masks every address written by the adapter
```

The common case is one batch. Every rationale names the subject and any seam crossed. The batch plan stays in conversation; Rollout is the durable merge plan.

**Group batches into rounds.** With two or more batches, give each its write surface (the files it creates or changes) and the batches it builds on — a caller batch builds on the helper batch whose seam it crosses. Batches share a round only when neither builds on the other, their write surfaces do not overlap (a shared test fixture, index or registry counts), and neither needs a decision the other makes. Name, for each pair in a round, the cheapest way they could still collide; a collision you can name moves one batch to the next round. A strict chain stays sequential, which is the common case.

```text
Round 1 — Batch 1 (src/mask.ts, test/mask.test.ts) · Batch 2 (src/redact.ts, test/redact.test.ts)
Round 2 — Batch 3 (src/adapter.ts, test/adapter.test.ts) builds on 1 and 2
```

A slice that no longer meets its documented safety boundary requires Route B′ and a revised Rollout.

### 6. Batch loop — dispatch, test, and inspect

Run 6.1–6.6 for every batch in the current slice. `## BLOCKED` still stops immediately; there is no human checkpoint between healthy batches.

**Run a round of two or more batches in parallel.** Every batch writes in its own **batch tree**, never in the slice's writing tree, so no two writers share a tree:

1. Record the slice tip as `<round-base>`; a resumed session recovers it as `git merge-base <batch-branch> <slice-branch>`. A batch whose write surface includes the dependency manifest never runs in a round: it runs alone in the slice's writing tree, so its install never goes through a shared link. For each batch, create its tree from the slice's writing tree: `"<skill base directory>/scripts/slice-tree.sh" "$LOCAL_NOTES/slice-trees/{ticket-id}-s{n}-b{k}" "feat/{ticket-id}-{slug}-s{n}-b{k}" <round-base>`. Batch branches stay local and are never pushed.
2. Dispatch the round's executors in **one message** (6.1), each with its batch tree as `worktree`, its own notes file `{ticket-id}-s{n}-b{k}.md`, and `Verify needs: exclusive` whatever the slice declares: batches of one slice share fixtures more than separate slices do.
3. When all return, **read every batch's notes first (6.2)**. A `## BLOCKED` in any of them stops the round before anything is picked: surface it, and keep every batch tree for the resume. A `PARTIAL` batch is dispatched again in its own tree to finish before it is picked.
4. Pick each batch onto the slice **in batch-plan order**, from the slice's writing tree: `"<skill base directory>/scripts/batch-pick.sh" "feat/{ticket-id}-{slug}-s{n}-b{k}" <round-base>`. It picks only commits the slice does not already carry, by patch, keeps one commit per AC, and prints the batch's range on the slice — `<before>..<after>` — which is that batch's 6.4 range; an empty range means nothing was left to pick. Exit 1 is a failure that is not a conflict — a missing branch, a dirty tree, a git error it prints — fix the cause and pick again. Exit 3 is a conflict, with the slice left exactly as it was: record the overlap the round check missed, remove that batch's tree and delete its branch, and run the batch again, alone, in the slice's writing tree on the new tip, before the next round.
5. Run 6.4 and 6.5 for each picked batch on its printed range, then 6.3's suite once for the round, after the last pick and every fix those reviews committed, through the verify lock. 6.6 follows.
6. Remove each picked batch's tree with `git worktree remove --force <batch-tree>`, then delete its local branch with `git branch -D <batch-branch>`: its commits now live on the slice.

**Resuming an interrupted round.** Route D lists local batch branches `feat/{ticket-id}-*-s{n}-b*`. Each is picked as in step 4 before anything is re-planned — `batch-pick.sh` skips what the slice already carries, so a batch picked before the interruption is a no-op, never a duplicate. A batch branch with no commits is removed and its batch re-run.

A round of one batch runs in the slice's writing tree as below. Batches in later rounds build on the picked commits of earlier ones. Writers across a wave's slices and a slice's batches together stay within the parallel cap.

#### 6.1. Dispatch `slice-executor`

Call `Agent(subagent_type: slice-executor)` with:

- `spec-path` — absolute path to the single spec;
- `ticket-id`;
- `slice-acs` — AC identifiers for this batch;
- `slice-tasks` — obligations of this slice that no AC covers but its Done-when or Edges require (moving a helper, adding a guard test), each as one line; omitted when there are none. The orchestrator never writes production or test code itself: a task with no AC still goes to the executor, as its own batch.
- `notes-path` — the machine-local agent-notes path;
- `repo-conventions` — the convention sources resolved at start;
- `reference-paths` — absolute paths to the domain references the index matched, omitted when none matched;
- `worktree` — the tree this executor writes in: its batch tree in a parallel round, else its slice tree in a parallel wave; omitted only when it writes in the main checkout;
- `verify-lock` — the absolute path of `scripts/verify-lock.sh`, and the slice's `Verify needs` from its Rollout entry. The executor runs locked commands with `GATED_DELIVERY_VERIFY_LOCK_TIMEOUT_S=300` in front and the Bash timeout at 600000 ms.

Run it in the foreground — every executor of one dispatch, across a wave's slices and a round's batches, goes in one message and all return before 6.2. STOP if the executor is not found. Cross-repo ACs do not appear in Rollout or batch planning.

#### 6.2. Read agent notes

Read new entries from `notes-path`:

- `## BLOCKED` — surface and stop. Before stopping, record it in the handoff when another person or session must act and it has evidence but no canonical home.
- `## REFACTOR-NOTE` — hold for the slice-end checkpoint: address within this slice, route to a tracker ticket, or explicitly close.
- Other entries — surface material assumptions or deviations; leave routine scratch local. Collect every repository deviation the executor relied on: 7.1 passes the list to the validators.

#### 6.3. Run the repository test suite

Run `pnpm test` or the repository equivalent through the verify lock. Fix and commit failures. The full verification command runs once at slice end; focused tests already ran for every AC.

#### 6.4. Run `senior-review-lens` on the batch

Unless the slice contains one batch, invoke `Skill(senior-review-lens)` with this batch's exact commit range: `<previous-batch-tip>..HEAD`, or `<slice-base-sha>..HEAD` for the first batch, or the range `batch-pick.sh` printed in a round. **One `Skill` call per batch range**: a lens loaded for an earlier batch, or reviewed from memory, does not count, and no note may record a lens verdict for a range the skill was not invoked on. STOP if `senior-review-lens` is not found.

Apply clear fixes in follow-up commits. Carry judgment calls to step 7.6. Report what each lens examined alongside its letter. Structural feedback stays per batch because cohesion and test-shape choices have no recipe for the executor to consult, and the lens is one in-context invocation rather than three sub-agents.

#### 6.5. Run conditional code security review

When the batch changes an inbound controller or DTO, authorization, input handling, secrets, or an external outbound call, invoke the security reviewer named under `## Review routing` — default the built-in `/security-review` — in report-only, code-scan-only mode over this batch's files. Scope the dispatch to a code scan explicitly: a reviewer left to pick its own scope may run a wider dependency scan ahead of the code scan. Report-only matters for the same reason `informative` does below — a reviewer's own flow may wait for approval, but a subagent has no user to ask, so fixes belong to the orchestrator. Include later ACs in the same slice so intentionally incomplete internal wiring is not mistaken for the final surface.

Skip with one sentence for purely internal logic.

#### 6.6. Open or update the draft PR

After the first batch commits, open a draft PR against `<slice-base>`:

```bash
gh pr create --draft --base <slice-base> --title "{type}({ticket-id}): {slice title}" --body "..."
```

The initial body links the ticket and the spec and quotes this slice's Rollout entry. Push every later batch to the same PR. Do not request reviewers before the slice-end gates pass.

Before starting the next batch or round, record this batch's tip — `git rev-parse HEAD` — in machine-local notes and in this actor's `## Resume` block. It is the `<previous-batch-tip>` the next batch's 6.4 range needs, and nothing else can recover it once the conversation is compacted.

### 7. Slice end — validate, review, and mark ready

Run these once over the complete slice. Every gate attaches to a merge point.

**Create this slice's review tree first.** A gate that runs the verify command works in its own checkout — call it `<review-tree>` — so its build output and test processes touch nothing the orchestrator holds, and its evidence names an exact commit. `scripts/review-tree.sh` sits beside this file, which is **not** under the repository being changed. Substitute the absolute path the harness names when it loads this skill — `Base directory for this skill: <dir>` — and run it from the slice's writing tree — the main checkout for a lone slice, its slice tree in a parallel wave — because it detaches at that tree's `HEAD` and links that tree's dependencies:

```bash
"<skill base directory>/scripts/review-tree.sh" "$LOCAL_NOTES/slice-review/{ticket-id}-s{n}"
```

`LOCAL_NOTES` is per **Repository conventions**. The script prints the tree's path, and exits non-zero with the reason on stderr. STOP on a non-zero exit, and STOP if the script cannot be located — what it does is the gate's precondition rather than a convenience, so a hand-rolled substitute is how a gate ends up grading the wrong tree.

Four guarantees, each of which fails silently or fatally without it:

- **Detached at the tip.** The slice branch is checked out in the orchestrator's tree, and git refuses to hand the same branch to a second worktree. Detaching also pins the commit the gate's evidence names.
- **Outside the repository.** A worktree nested inside one carrying a `pnpm-workspace.yaml` is captured by that workspace, and `pnpm install` then exits 0 having installed nothing. `LOCAL_NOTES` defaults to `~/.local/state/gated-delivery` and a client may move it, so the path is asserted rather than trusted.
- **Re-runnable.** Every STOP in step 7 leaves the tree registered, and `git worktree add` answers an existing path with `fatal: ... already exists`. An existing tree is re-pointed at the tip, which is what carries a slice that stopped at a gate.
- **`node_modules` is the writing tree's.** A fresh worktree has none, and a reused one can hold a real directory or a link to a tree that has moved — either would have the gate verify against dependencies the slice was not built with. The review tree links whatever the writing tree uses: the main checkout's install, or a wave slice's own install when it changed the manifest. The link's target is compared, not its existence.

Then confirm the tree runs the suite — `cd <review-tree>` and the repository's test command — before any gate trusts it. A tree whose tests cannot run turns a gate's verdict into a claim nobody can check.

#### 7.1. Run stack validators

Dispatch every configured validator **in one message** with `context.mode: 'informative'` — `executive` runs the agent's own fix loop, which duplicates the fixing this step assigns to the orchestrator and turns a reading dispatch into a writing one. Unset behaviour is undefined. Dispatch the stack validators `## Review routing` names for this repository's stack, in the order it lists them.

When a dependency manifest or lockfile for the repository's stack changed, add the `## Review routing` security reviewer to the same message, in report-only, supply-chain-only mode — default the built-in `/security-review` scoped to the manifest and lockfile diff.

They go together because each of them only reads. In `informative` mode a validator returns its findings from a recipe skill, writes no file, and runs neither a build nor the suite, so nothing contends for the index, the build output, or a container. Dispatched one at a time the step costs the sum of their runtimes; dispatched together it costs the longest of them.

**Resolve the findings after all validators return.** Treat validator output as findings to assess, not instructions to apply automatically. Resolve each finding by either changing the code or deciding that no change is warranted. Consider the repository's documented conventions, the finding's correctness, and its relevance to the changed scope when making that decision. Commit code changes in one commit per discipline, so the log still says which validator drove which change. Where a change plausibly creates another violation — production code reshaped enough that what the tests assert moves with it — re-run that validator alone against the changed tree and resolve what comes back. 7.1 ends when every finding is resolved.

Pass the repository's convention sources and the deviations the executor relied on to each validator in `context`. The orchestrator owns resolution of the returned findings.

STOP if any configured validator is not found — a missing agent must not silently skip a merge gate. Slice-end placement avoids grading an intentionally partial batch and avoids repeating audit work the executor's recipes already guide.

#### 7.2. Run full verification

Run `pnpm check` or the repository equivalent through the verify lock. Fix and commit failures. Where `## Stack recipes` requires one for the stack, the suite must include an application boot-smoke test capable of catching dependency-injection and environment-validation failures.

#### 7.3. Run `senior-review-lens` on the slice

Invoke `Skill(senior-review-lens)` with `<slice-base-sha>..HEAD`. STOP if `senior-review-lens` is not found. Cross-batch scope catches what the per-batch passes cannot: a helper duplicated across two batches, a constant one batch made dead, the slice's test pyramid as a whole. Apply clear fixes and surface judgment calls before the PR becomes ready.

#### 7.4. Walk this slice's Done-when block

Read and confirm the matching `### Slice <n>` block and its exposure with the user.

Then tick that block's boxes and commit the spec: on this slice's branch for a repo-hosted spec, or to the notes repository's `main` for an external one. A ticked block is a point-in-time record that the named gates passed for the commit this slice merges — an attestation about finished work, not a status field. The handoff therefore omits status; the spec keeps this attestation. An in-flight slice's boxes stay unticked until this step runs.

#### 7.5. Run the fresh-context correctness gate

Point the review tree at the commit this gate grades — the tip left by 7.1's and 7.2's fixes — with the same script that created it, which re-checks the `node_modules` link on the way:

```bash
cd <writing tree> && "<skill base directory>/scripts/review-tree.sh" "<review-tree>" "$(git rev-parse HEAD)"
```

Invoke `Agent(subagent_type: code-reviewer)` with:

- `diff-range` — `<slice-base-sha>..HEAD`;
- `acceptance-criteria` — the full text of this slice's in-repo ACs;
- `memory` — `read-only` for every reviewer but the first when several run in one message: concurrent writes to one memory index lose entries. Carry the read-only reviewers' proposed lessons into 7.6 and give them to the next single reviewer.
- `verify-cmd` — the repository verify command, prefixed `cd <review-tree> &&` and wrapped in the verify lock with the agent timeout: `GATED_DELIVERY_VERIFY_LOCK_TIMEOUT_S=300 "<skill base directory>/scripts/verify-lock.sh" 'cd <review-tree> && <verify command>'`. Tell the reviewer to run it with the Bash timeout at 600000 ms.

**Name the review tree in the prompt as the only place it may work.** The agent takes no working-directory input (`code-reviewer.md:11-15`), so an unbound one runs the verify command wherever the session happens to sit: the right diff, evidence from the wrong tree, and nothing in its output says which it was.

The tree removes the resource collision, not the ordering reason. This gate still runs last for its slice, because it grades the tip that becomes the PR and no agent may be moving that tip while it reads. Reviewers for different slices of a wave run together: each grades its own tree.

STOP if `code-reviewer` is not found; this gate runs at every merge, so a silent skip ships an ungraded slice. Resolve every `BLOCK` before proceeding. Treat `UNVERIFIED` as not yet green. The reviewer receives only this slice's requirements because later slices are intentionally absent.

#### 7.6. CHECKPOINT — review the slice and update the handoff

**A slice is not done while review threads are open.** Before this checkpoint and again after every push, list unresolved PR review threads (review bots included) via `gh api graphql … reviewThreads { isResolved }`. Fix each in code and resolve it, or reply with the reason. Never report "ready, waiting on review" with a thread open.

Show the commits in `<slice-base-sha>..HEAD`, agent-note decisions, the repository deviations the executor relied on with the document stating each, validator outcomes, full verification result, structural findings, and correctness verdict. Every AC is shown with its text; every slice is shown with what becomes true on `main`.

Resolve each `## REFACTOR-NOTE`: fix it within this slice, route it to the tracker, or close it with a reason. Raising that ticket is ticket authoring — hand it to `Skill(issue-writing)` rather than writing a description here.

Create or update the Shared handoff, `{ticket-id}/handoff.md` under the Shared notes home, before `/compact`, stopping, or transferring work to another session, agent, machine, or person. `/slice` is its sole writer; executors report through machine-local notes.

Keep this actor's Resume block and the shared Carry-forward list current:

```md
## Resume — <actor>[ — s<n>]

- Updated: <UTC timestamp, from `date -u +%Y-%m-%dT%H:%MZ`>
- Slice: <current Rollout slice>
- Branch: <branch>
- Base: <ref> at <SHA>
- Last batch tip: <SHA, or none yet>
- PR: <URL or not opened>
- Last verified: <commit and command>
- Next: <one concrete action>

## Carry forward

### <short item>

**Status:** OPEN | HARVESTED → <destination> | CLOSED
**Evidence:** <pinned reference, PR, command, trace, or reproduction>
**Impact:** <what goes wrong if ignored>
**Next:** <required action, decision, or canonical destination>
```

Promote a finding from an executor note, validator, lens, security scan, correctness review, or checkpoint into `## Carry forward` only when losing the conversation would lose information that a later batch, slice, person, or session needs. Evidence is required. Four kinds qualify, because nothing else records them yet:

| Keep | Why it has nowhere else |
|---|---|
| A decision taken in conversation, not yet in the spec | pending a Route B′ update; nothing else records it meanwhile |
| A deferral, and whether a tracker ticket was raised for it | The tracker owns it once raised; until then this is the only record |
| An assumption the executor made | otherwise the next reader re-derives it |
| A dead end — tried X, failed because Y | expensive to rediscover, recorded nowhere |

Never write status, AC lists, exposure declarations, line numbers or counts. Those live in the spec's ticked blocks, the spec, the code, and the grep; a copy here disagrees with its source within a day. A measurement goes inline in the finding it supports, with the SHA it ran against — a probe kept as a standalone file reads as a test and outlives the code it measured.

An actor holding several slices of a wave writes one block per slice, suffixed `— s<n>`.

**Write only this actor's blocks**, however stale another's looks — `Updated` carries the staleness, and only its owner knows whether it still holds. Route F step 6, which stamps every block `Closed` after the ticket ships, is the sole exception.

Before writing, pull the notes repository's `main`. Commit and push the handoff directly to that repository's `main`; on divergence merge without force-pushing. Three merge cases, and no others: two actors' blocks both survive whole; one actor's own block for one slice resolves to the later `Updated`; two Carry-forward entries stay two. Anything else stops for the user rather than being hand-merged into a file that lost half of someone's evidence. Harvest entries into the spec, the tracker, PRs, ADRs, or repository documentation as their canonical destinations become clear. Keep the handoff as a historical record; do not delete, move, or archive working documents automatically.

Ask the user whether to address a surfaced judgment call or mark the PR ready. If a fix changes `HEAD` after step 7.1 starts, rerun steps 7.1–7.5 against the final `HEAD` before step 7.7. Do not start a later wave before every slice of this one merges.

#### 7.7. Mark the PR ready

Complete the draft body with:

- the ACs this slice satisfies;
- later Rollout ACs still outstanding;
- outstanding cross-repo ACs and their owners or PRs;
- notable executor findings, linking the shared handoff when it carries relevant evidence;
- `Closes <ticket-id>` only on the final Rollout slice.

Use a conventional-commit PR title — `feat`, `fix`, `docs`, `chore`, `test`, or `refactor` per what the change is. Where the client's `## Commit convention` names a **PR title** check — a required Conventional Commits check that reads the PR title, not the commits — a bare `{ticket-id}: {title}` fails it even when every commit is conventional. When that check retriggers on push rather than on title edit, a wrong title costs a close/reopen to clear, and this workflow creates one title per slice rather than one per ticket.

Push final commits, then run `gh pr ready`.

Remove the review tree once the PR is ready — `git worktree remove --force <review-tree> && git worktree prune`. Git refuses a plain removal over untracked files, and whether a repository ignores what its verify command writes is not something this skill can assume; the tree holds nothing but that output. `--force` unlinks the `node_modules` symlink rather than following it, so the repository's own dependencies survive. Leaving it costs nothing either: the setup at the head of step 7 reuses a tree it finds, which is what carries a slice that stopped at a gate.

### 8. CHECKPOINT — stop for merge

Report the ready PR and stop. Merge cadence is the user's decision. Re-invocation selects Route D, E, W or C for the next slices, or Route F after the final merge.

### 9. Ticket end — cross-slice review and cleanup

After the final slice merges, and only when the ticket has merged two or more slices, run `Skill(senior-review-lens)` over the union of this ticket's slice PRs — their squash SHAs, in merge order, read from PR metadata. STOP if `senior-review-lens` is not found. A contiguous range from slice 1 to current `main` would include every unrelated ticket merged in between, and the lens diffs endpoints. Nothing else sees across slices: every earlier slice is already in a later slice's base, so no slice's own diff range ever contains more than itself.

Skip the sweep on a single-slice ticket and say so. Its 7.3 pass already covered the same range.

This pass is post-merge. Route any finding into a follow-up PR; correctness was already gated before each merge.

Then complete Route F:

1. Merge Domain model deltas into the canonical domain document named by the repository instructions, when the repository maintains one.
2. Walk `## Done-when` → Per ticket, including removal tickets for surviving flags. Raising one is ticket authoring, the same as a refactor-note ticket at 7.6 — hand it to `Skill(issue-writing)`.
3. Harvest every `OPEN` handoff entry into the spec, an ADR, a tracker ticket, a named PR, or repository documentation, or close it with evidence. An entry bound for the tracker goes through `Skill(issue-writing)`, whose publishing rules keep design detail in the spec and out of the ticket.
4. Record the outcome in the spec and other canonical destinations.
5. **Fold per-slice handoffs.** Where a wave wrote `{ticket-id}/handoff-s<n>.md` files, move each one's Resume block and Carry-forward entries into `handoff.md` unchanged, then delete the per-slice files in the close-out commit — their content lives on in `handoff.md`.
6. **Lead the handoff with its outcome.** Write `## Outcome` as the file's **first** section — what shipped, where each harvested item landed, and the dead ends and assumptions a later reader would otherwise re-derive — then stamp each `## Resume — <actor>` block `Closed: <UTC timestamp, from `date -u +%Y-%m-%dT%H:%MZ`>` so no spent position reads as live. Nothing is deleted, moved or archived: the outcome earns the top of the file, it does not replace what is under it. Stamping others' blocks is 7.6's one exception, because no block is live once the ticket has shipped.
7. Set the spec's frontmatter `status: Shipped`, so a reader can tell a shipped spec from one still in flight.
8. Recommend `/learn-flow` before closing out, while the machine-local notes still exist: they hold the gotchas and dead ends that 7.6's promotion bar deliberately excludes, and that reflection pass is their only remaining consumer.
9. Leave the main checkout on `main`, clean and pulled, and delete every merged branch this ticket created — slice branches, the spec branch and the close-out branch — locally and on `origin` (`git push origin --delete <branch>`), unless the host already deleted it on merge. When close-out goes through a PR, this step runs on the next `/slice` after that PR merges; do not hand it to the user.
10. Leave the machine-local notes in place. They accumulate one file per ticket in `$LOCAL_NOTES/agent-notes/`, outside every repository, and `/learn-flow` treats a matching entry from an earlier ticket as its strongest corroboration that a lesson is structural rather than incidental. Pruning them is the user's call, not a workflow step.

## What `/slice` does NOT do

- Auto-merge PRs.
- Put two writers in one working tree, or run a wave's verify runs outside the verify lock.
- Author or silently revise Rollout during implementation; Routes R and B′ stop for spec publication.
- Use working documents as a second copy of the tracker, GitHub, code, or the spec.
- Create empty working-document scaffolds.
- Change shared tooling or governance as an incidental part of a product ticket.

## Failure modes

- **Spec mismatch appears mid-slice:** stop and take Route B′.
- **Stacked base is uncertain:** stop rather than audit or open a PR against the wrong range.
- **Notes-repository push races:** merge remote `main`; never overwrite another ticket's working documents.
- **Two actors claim one slice:** the second push of the slice branch is rejected; that actor removes its tree and local branch and takes another slice.
- **A wave slice conflicts with a merged sibling:** the wave check missed an overlap; resolve it in the slice tree and record the dead end.

## Related skills and agents

- `/spec` — creates the spec and Rollout used by Routes A and R.
- `Skill(repo-forensics)` — gates the trivial-change escape hatch.
- `Skill(senior-review-lens)` — batch, slice, and ticket structural review.
- `Agent(code-reviewer)` — fresh-context correctness gate for every slice PR.
- `Agent(slice-executor)` — mechanical TDD worker for each functional batch.
- Stack validators — once per slice; the `## Review routing` security reviewer additionally handles batch code scans and dependency-scoped slice scans.
- [`scripts/review-tree.sh`](scripts/review-tree.sh) — creates or re-points the slice's review worktree and makes it runnable; step 7 and 7.5 both call it.
- [`scripts/slice-tree.sh`](scripts/slice-tree.sh) — creates or reuses a parallel slice's or batch's writing worktree; steps 4W and 6 call it.
- [`scripts/batch-pick.sh`](scripts/batch-pick.sh) — picks a parallel batch's commits onto the slice and prints its range, or exits 3 on a conflict with the slice untouched; step 6 uses it.
- [`scripts/verify-lock.sh`](scripts/verify-lock.sh) — runs a suite or verify command under the machine-wide verify lock; 6.3, 7.2 and 7.5 use it.
