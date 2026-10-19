# /slice — parallel waves and batch rounds

Read this when `/slice` sends you here: Route W, a step 5 plan with two or more independent batches, or a Route D resume that finds slice trees or batch branches. Everything in `SKILL.md` still applies; this file adds only what running writers side by side needs. `<skill base directory>`, `LOCAL_NOTES`, the verify lock and the parallel cap are as `SKILL.md` **Repository conventions** defines them.

The orchestrator stays the only dispatcher — a subagent cannot start agents of its own — so this session interleaves the work: one message dispatches the same step for every slice or batch, then each one's results are handled in its own tree. Every command for a slice or batch names its tree, by `git -C <tree>` or `cd <tree> &&`. The main checkout stays on `main` and clean.

## Wave

Route W runs every claimed slice through steps 5–7 at once. A slice of a wave of two or more always works in its own slice tree, even when this actor takes only one; only a one-slice wave uses the main checkout (Route C).

1. **Start from the current `origin/main`.** Run `git fetch origin`. Every slice tree branches from `origin/main`, so a stale local `main` never becomes a wave's base. Each slice's `<slice-base>` is `main` and its `<slice-base-sha>` is `git rev-parse origin/main` at the moment its tree is created.
2. **Land an uncommitted spec before the wave.** When the repository hosts the spec and `/spec` left it uncommitted, put it on `main` first through its own small PR: create a tree with `"<skill base directory>/scripts/slice-tree.sh" "$LOCAL_NOTES/slice-trees/{ticket-id}-spec-{actor}" "docs/{ticket-id}-spec" origin/main`, copy the spec there, commit it — `docs(specs): add spec for {ticket-id}` — push it with `git -C <tree> push -u origin HEAD:refs/heads/docs/{ticket-id}-spec`, open the PR, and only then delete the copy from the main checkout. STOP for its merge, as Route E would; the next `/slice` finds the spec on `main` and takes Route W. A spec in a separate notes repository is already shared and skips this step.
3. **Claim each slice: create-only tree, claim commit, create-only push.** For each slice this actor takes, in Rollout order, skip it when `origin` already has its branch or another actor's Resume block names it. Otherwise create its tree in claim mode, at a path carrying this actor's name, so two actors on one machine never share a path:

   ```bash
   "<skill base directory>/scripts/slice-tree.sh" --claim "$LOCAL_NOTES/slice-trees/{ticket-id}-s{n}-{actor}" "feat/{ticket-id}-{slug}-s{n}" origin/main
   ```

   `--claim` refuses when the branch exists locally or on `origin`, or the path is already a tree; it never reuses one. Then commit the claim and push it create-only:

   ```bash
   git -C <slice-tree> commit --allow-empty -m "chore({ticket-id}): claim s{n} for <actor>"
   git -C <slice-tree> push -u --force-with-lease=refs/heads/<branch>: origin HEAD:refs/heads/<branch>
   ```

   The empty lease rejects the push whenever `origin` already has the branch, even a fast-forward, so exactly one claimant's push lands. Always name the destination ref: under `push.default=upstream` a bare push from a branch cut from `origin/main` lands on `main`. Any rejection, from the script or the push, means the slice is held: remove only the tree and local branch this attempt created — `git worktree remove --force <slice-tree> && git branch -D <branch>`, skipped when the script refused before creating them — and route again. Never remove a tree this attempt did not create. The claim commit changes no file, so it adds nothing to `<slice-base-sha>..HEAD`. When the Shared notes home is a separate notes repository, also write and push this actor's `## Resume — <actor> — s<n>` block there. Record each tree, branch and `<slice-base-sha>` in machine-local notes. STOP on any non-zero exit from the script.

   The script links the main checkout's `node_modules`. A slice whose write surface includes the dependency manifest replaces the link with its own install in its tree; re-runs keep that install, and its review tree uses it.
4. **Keep each slice's notes and handoff to itself.** Each slice's agent notes go to `$LOCAL_NOTES/agent-notes/{ticket-id}-s<n>.md`. When the Shared notes home sits inside the repository, each slice writes its Resume block and Carry-forward entries to `{ticket-id}/handoff-s<n>.md` on its own branch; Route F folds them into `handoff.md`. A separate notes repository keeps one `handoff.md`, with one block per actor and slice, each headed `## Resume — <actor> — s<n>`.
5. **Run steps 5–7 for the claimed slices together:**
   - **5:** one checkpoint shows every claimed slice with its batch plan.
   - **6.1:** each slice's next dispatch — its next batch, or every batch of its next round — goes out together in one message, each executor with its slice tree (or batch tree) as `worktree`. A slice with nothing left to dispatch sits out. When the writers would pass the parallel cap, dispatch fewer: slices earlier in Rollout order go first, and a slice's round shrinks before another slice waits.
   - **6.2–6.6:** per slice, in its tree. A `## BLOCKED` stops that slice only; the others continue, and the next checkpoint surfaces it.
   - **7:** one review tree per slice, created by running `review-tree.sh` from that slice's tree. 7.1 validators for all slices go in one message. 7.2 and 7.3 run per slice. 7.5 dispatches every slice's `code-reviewer` in one message, each bound to its own review tree; every reviewer gets `memory: read-only`, because sessions writing one memory index at once lose entries. Their lessons go into the handoff's Carry forward, and Route F writes them once. 7.6 is one checkpoint covering every slice. 7.7 runs per slice.
6. **Merge in any order.** Whichever slice is approved first merges first. After a merge, every other slice of the wave merges `main` into its branch — never a rebase — re-records its `<slice-base-sha>` as the `origin/main` commit it just merged, and reruns 7.1–7.5 before it is marked ready. A merge conflict means the wave check missed an overlap: resolve it in that slice's tree and record it in `## Carry forward` as a dead end.
7. **Remove each slice tree after its PR merges.** The next `/slice` does it in step 2, before routing.

## Rounds

A round is the batches of one slice that run at the same time, each in its own batch tree.

**Group batches into rounds.** Give each batch its write surface (the files it creates or changes) and the batches it builds on — a caller batch builds on the helper batch whose seam it crosses. Batches share a round only when neither builds on the other, their write surfaces do not overlap (a shared test fixture, index or registry counts), and neither needs a decision the other makes. Name, for each pair in a round, the cheapest way they could still collide; a collision you can name moves one batch to the next round. A strict chain stays sequential, one batch per round, with no batch trees.

```text
Round 1 — Batch 1 (src/mask.ts, test/mask.test.ts) · Batch 2 (src/redact.ts, test/redact.test.ts)
Round 2 — Batch 3 (src/adapter.ts, test/adapter.test.ts) builds on 1 and 2
```

A round of one batch runs in the slice's writing tree as `SKILL.md` step 6 describes. A round of two or more runs every batch in its own batch tree, never in the slice's writing tree:

1. Record the slice tip as `<round-base>`. A batch whose write surface includes the dependency manifest never runs in a round: it runs alone in the slice's writing tree. For each batch, create its tree from the slice's writing tree: `"<skill base directory>/scripts/slice-tree.sh" "$LOCAL_NOTES/slice-trees/{ticket-id}-s{n}-b{k}-{actor}" "feat/{ticket-id}-{slug}-s{n}-b{k}" <round-base>`. Batch branches stay local and are never pushed.
2. Dispatch the round's executors in one message (6.1), each with its batch tree as `worktree`, its own notes file `{ticket-id}-s{n}-b{k}.md`, and `Verify needs: exclusive` whatever the slice declares.
3. When all return, read every batch's notes first (6.2). A `## BLOCKED` in any of them stops the round before anything is picked: surface it, and keep every batch tree for the resume. A `PARTIAL` batch is cleaned and dispatched again in its own tree, as 6.2 describes, before it is picked.
4. Pick each batch onto the slice in batch-plan order, from the slice's writing tree: `"<skill base directory>/scripts/batch-pick.sh" "feat/{ticket-id}-{slug}-s{n}-b{k}" <round-base>`. It picks only commits the slice does not already carry, keeps one commit per AC, and prints the batch's range on the slice — `<before>..<after>` — which is that batch's 6.4 range; an empty range means nothing was left to pick. Exit 1 is a failure that is not a conflict — a missing branch, a dirty tree, a git error it prints — fix the cause and pick again. Exit 3 is a conflict, with the slice left exactly as it was: record the overlap the round check missed, remove that batch's tree and delete its branch, and run the batch again, alone, in the slice's writing tree on the new tip, before the next round.
5. Run 6.4 and 6.5 for each picked batch on its printed range, then 6.3's suite once for the round, after the last pick and every fix those reviews committed. 6.6 follows.
6. Remove each picked batch's tree with `git worktree remove --force <batch-tree>`, then delete its local branch with `git branch -D <batch-branch>`.

Batches in later rounds build on the picked commits of earlier ones.

## Resume

Route D resumes every slice this actor holds:

- **Slice trees.** A slice of a multi-slice wave resumes in its slice tree through `slice-tree.sh` with the same arguments as Wave step 3 but without `--claim`, which also picks up a branch only `origin` has — also when this actor holds only that one slice. A slice whose sibling merged since its gates ran goes through Wave step 6 first.
- **Batch branches.** List local batch branches `feat/{ticket-id}-*-s{n}-b*`. Recover `<round-base>` as `git merge-base <batch-branch> <slice-branch>`. Pick each as in Rounds step 4 before anything is re-planned — `batch-pick.sh` skips what the slice already carries, so a batch picked before the interruption is a no-op. A batch branch with no commits is removed and its batch re-run.

## Failure modes

- **Two actors claim one slice:** each claims in its own `-{actor}` tree; only the first create-only push lands. The second is refused by `--claim` or by the push, removes only its own tree and branch, and routes again. A plain push is no claim: the second actor's push can fast-forward onto the first's claim commit, or carry the same SHA and exit 0 with "Everything up-to-date".
- **A wave slice conflicts with a merged sibling:** resolve it in the slice tree and record the dead end.
