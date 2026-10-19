# Evals: slice

## What "Works" Means

`/slice` routes from observable state, divides the current Rollout slice into functional batches, and gates every PR at its merge boundary. The executor writes feature code; `/slice` applies and commits review fixes at 6.3, 7.1 and 7.2, because two writing actors must never share a working tree. Success includes early draft feedback, one validator stack per slice, exact slice-scoped correctness review, and a shared handoff that preserves only evidence and resume context another session needs.

> Full runs need the tracker Mechanics named under `## Issue tracking` and the executor, validator, security, and review agents. Personas provide enough state to judge routing without live integrations.

## Execution Model

mode: response

## Test Scenarios

| # | Prompt | Persona | Pass Criteria |
|---|---|---|---|
| 1 | "Start PROJ-123." | No spec or branch; the tracker has usable ACs. | Picks Route A, invokes `/spec`, and stops before branch or code. |
| 2 | "Continue PROJ-124." | Spec exists with unresolved Open decisions. | Picks Route B and refuses executor dispatch. |
| 3 | "Continue this old spec." | Decisions resolved but `## Rollout` missing. | Picks Route R, proposes Rollout with the user, publishes it, and stops. |
| 4 | "Start the first slice." | Three-slice Rollout; no branch. | Creates `feat/PROJ-*-s1` from updated `main`; does not plan later slices' batches. |
| 5 | "Plan the current slice." | Current slice has three ACs: two target one helper, one targets its adapter. | Plans two functional batches by subject and seam; keeps distinct RED/GREEN cycles for the two helper behaviors. |
| 6 | "Execute this two-batch slice." | Batch 1 complete; no PR yet. | Runs focused batch tests, batch lens, conditional security, then opens a draft PR; validators and full check wait for slice end. |
| 7 | "Finish the slice." | `## Review routing` names three stack validators for the repository's stack, all configured; all batches complete; package manifest unchanged. | Runs the three configured stack validators once, full check once, whole-slice lens, current slice Done-when, and code-reviewer with full current-slice AC text; reports the gates and asks whether to mark the PR ready. |
| 8 | "Finish a dependency-changing slice." | Lockfile changed in one of three batches. | Runs code security on relevant batches and one supply-chain scan at slice end, not one dependency scan per batch. |
| 9 | "Continue after PR 1 merged." | Rollout has three slices; s1 merged, no s2 branch. | Picks Route C — s2 is alone in the next wave — and creates s2 from updated `main`. |
| 10 | "Resume PROJ-130 on a second machine." | Draft PR and remote slice branch exist; local notes are absent; the shared handoff names the base, last verified commit, next action, and an OPEN item. | Fetches and checks out the existing slice branch, pulls shared files, reads the handoff before routing, uses its resume context, and treats missing local notes as expected. |
| 11 | "Executor found a possible cleanup." | Note has no evidence and no later actor needs it. | Keeps it local and does not add it to the shared handoff. |
| 12 | "Executor is blocked by a contract contradiction." | Reproducible evidence; another person must decide; no canonical destination contains the finding; losing the conversation would risk losing it. | Records an OPEN handoff item before stopping, with evidence, impact, and next action. |
| 13 | "Prepare PR 2 of 4." | Later Rollout slices remain. | PR body names satisfied and outstanding ACs but omits `Closes` and every other closing keyword before the ticket; only the final unmerged slice closes the ticket. |
| 14 | "The final slice merged." | Every slice merged; one OPEN handoff item remains. | Runs the ticket-wide structural sweep, harvests or closes the item, completes per-ticket gates, records the outcome, and leaves working documents in place. |
| 15 | "Branch and start." | Dirty tree on an unrelated branch. | Stops and offers checkout, stash, or explicit stacking; no silent branch mutation. |
| 16 | "Close the completed ticket." | Repository instructions name `.ai-context/domain-types.md` as the only canonical domain model. | Merges the domain delta into the declared path and does not propose creating a different document. |
| 17 | "Compact and continue elsewhere." | Current slice has a branch, base SHA, last verified commit, and one next action in local notes. | Updates and pushes this actor's Resume block before recommending compaction. |
| 18 | "Start the next slice on PROJ-140, then print the handoff as you leave it, in full." | Rollout: wave 1 holds s1; wave 2 holds s2 and s3, which share no write surface. Handoff holds `## Resume — actor-b` naming s2, its branch and draft PR, and an older `## Resume — actor-a` naming s1, now merged. | Takes s3, the wave-2 slice nobody holds, in its own slice tree, and names `actor-b` as holding s2. Fails if it plans s2, starts s3 in the main checkout, or edits another actor's block. |
| 19 | "Push the handoff — the other machine got there first. Print the merged handoff in full." | Remote and local each added a different Carry-forward entry, and both edited this actor's own Resume block. | Keeps both entries, resolves the block to the later `Updated`, no force-push, other blocks untouched. |
| 20 | "Close out PROJ-141, then print the handoff as you leave it, in full." | Handoff holds two Resume blocks, one `HARVESTED → ADR-12` entry, one dead end with evidence, and one `OPEN` entry. | `## Outcome` leads the file and carries the dead end and where the harvested item landed; both blocks stay, stamped `Closed`; the `OPEN` entry is harvested, not dropped. Fails if anything is deleted, moved or archived. |
| 21 | "Plan the slice on PROJ-142." | Ticket touches a technology the reference index carries an entry for. | Reads the matching reference before dispatch and passes it as `reference-paths`. Fails if it lists the reference under the spec's `## Relevant files`, which the executor requires to exist in the changed repository. |
| 22 | "Run slice 1 of PROJ-143." | The changed repository's `.ai-context/coding-conventions.md`, imported by its `CLAUDE.md`, permits a comment that gives a reason, which the production-code stack recipe bans; the production-code validator flags one such comment. | Lists the conventions document on the state block, passes it to the executor as `repo-conventions` and to the validators in `context`, assesses the finding using the repository convention, and leaves the comment in place, naming the deviation and its document at 7.6. Fails if it treats the finding as an instruction and deletes the comment. |
| 23 | "Run wave 1 of PROJ-150 in parallel." | Rollout: wave 1 holds s1 and s2, wave 2 holds s3. No Resume block holds a slice. | Takes Route W; creates a slice tree per slice with `slice-tree.sh` and pushes each branch as its claim before any executor runs; dispatches both executors in one message, each with its own `worktree`. Fails if s3 starts, if both executors share one tree, or if an executor is dispatched before its branch is pushed. |
| 24 | "Pick up PROJ-151 — my colleague is on it too." | Wave 1 holds s1 and s2; `origin` already has actor-b's branch for s1. | Claims s2 in its own slice tree with an empty claim commit, naming actor-b as holder of s1. Fails if it creates a branch or tree for s1, or starts s2 in the main checkout. |
| 25 | "s1 merged; finish s2." | Wave 1 of PROJ-152: s1 merged to `main`, s2 was green and ready before that merge. | Merges `main` into s2 — no rebase — and reruns 7.1–7.5 before marking it ready. Fails if it marks s2 ready on the pre-merge evidence. |
| 26 | "Run the slice-end gates on wave 1." | Two slices in flight, each with a review tree. | Runs each 7.2 verify and each reviewer's `verify-cmd` through `verify-lock.sh`, and dispatches both code-reviewers in one message, each bound to its own review tree. Fails if a verify runs outside the lock or one reviewer grades both trees. |
| 27 | "Start wave 1 of PROJ-153." | Wave 1 holds s1 and s2; `/spec` left the repo-hosted spec uncommitted in the main checkout. | Lands the spec first through its own docs PR and STOPs for its merge, leaving the main checkout clean; creates no slice branch yet. Fails if any slice branch commits the spec, or if a slice starts before the spec is on `main`. |
| 28 | "Finish slice 3 of PROJ-154." | Slice 3's Done-when requires moving a shared test helper and adding a linear-time guard test; no AC covers either. | Plans them as a batch of `slice-tasks` and dispatches the executor for it. Fails if the orchestrator writes that code itself in its own checkout. |
| 29 | "Run both reviewers on wave 1." | Two slices end together. | Dispatches both code-reviewers in one message, all but one with `memory: read-only`. Fails if two reviewers may write memory in the same message. |
| 30 | "Plan and run slice 1 of PROJ-160." | Three batches: a mask helper in `src/mask.ts`, a redact helper in `src/redact.ts`, and an adapter in `src/adapter.ts` that calls both. | Puts the two helpers in round 1 and the adapter in round 2; creates one batch tree per round-1 batch, dispatches both executors in one message, then runs `batch-pick.sh` for each in plan order and the 6.4 lens on each printed range. Fails if the adapter runs in round 1 or any executor writes in the slice's own tree. |
| 31 | "Continue the round." | Round 1's second batch conflicts with the first on a shared test fixture; `batch-pick.sh` exits 3. | Leaves the slice as `batch-pick.sh` restored it, records the missed overlap, and runs that batch again alone on the new tip before round 2. Fails if it hand-merges the conflict or skips the batch. |
| 32 | "Plan the batches for slice 2." | Every batch crosses the seam of the one before it. | Keeps them sequential, one round each, and says the chain allows no parallel round. Fails if it creates batch trees. |
| 33 | "Run round 2 of slice 1." | Two batches picked; `batch-pick.sh` printed `a1..b2` and `b2..c3`. | Invokes `Skill(senior-review-lens)` once per printed range, two calls, before 6.3. Fails if one call covers both ranges, or if a note records a lens verdict with no call behind it. |
| 34 | "Pick round 1." | One of the round's two executors wrote `## BLOCKED`. | Reads both notes before any pick, picks nothing, and surfaces the block, keeping both batch trees. Fails if any batch is picked first. |

## Agent Prompt Templates

### Baseline Agent

```text
You are a Claude Code assistant with NO skills loaded. Do NOT invoke any Skill tool.
The user will not answer follow-ups; use the supplied state.
USER: {{PROMPT}}
CONTEXT: {{PERSONA}}
```

### Skill Agent

```text
MANDATORY FIRST STEP: Invoke Skill("gated-delivery:slice"). Then follow it.
The user will not answer follow-ups; use the supplied state.
USER: {{PROMPT}}
CONTEXT: {{PERSONA}}
```

## Quality Signals

| Signal | Failure | Expected behavior | Measurement |
|---|---|---|---|
| State routing | Improvises or resumes wrong slice | Selects Route A, B, B′, R, F, D, E, W, or C from evidence, first matching row winning | Manual, scenarios 1–4 and 9–10 |
| Merge-unit meaning | Treats dispatch as slice | One Rollout slice equals one branch, PR, and merge | Manual, scenarios 4–7 |
| Batch cohesion | Groups by size or AC count | Groups by test subject and production seam | Manual, scenario 5 |
| Early feedback | Waits until all work is complete | Opens draft PR after first batch | Manual, scenario 6 |
| Review placement | Repeats full stack per batch | Batch tests/lens/security; validators/check/reviewer at slice end | Manual, scenarios 6–8 |
| Requirement scope | Reviews whole unfinished ticket | Sends full text of current slice ACs to code-reviewer | Manual, scenario 7 |
| Handoff discipline | Copies routine status or loses resume context | Records evidenced carry-forward items and the exact resume point before a context boundary | Manual, scenarios 10–12 and 17 |
| Parallel isolation | One shared block, so the second session overwrites the first | One block per actor, and only this actor's is written | Heading check below, scenarios 17–19; whether another's block survived is **Manual** — a diff, not a count |
| Slice already held | Plans the slice another actor holds | Takes a free slice, and names the holder | Holder check below; **whether the planned slice is the held one is Manual**, scenario 18 — the number comes from the persona |
| Merge of two writers | Drops one side's evidence, or force-pushes | Both entries kept, block resolved by `Updated` | **Manual**, scenario 19 |
| Close-out record | A reader months later meets the route before the result, or the route is deleted to spare them | `## Outcome` leads the file; the blocks stay, stamped `Closed` | Close-out checks below, scenario 20 |
| Parallel wave | Starts dependent slices together, shares a tree, or skips the claim | Route W over independent slices only; each branch pushed as its claim; one slice tree and one executor per slice | Checks below plus **Manual**, scenarios 23–24 |
| Wave merges | Ships a sibling on evidence from before the other merged | Merges `main` in and reruns 7.1–7.5 | **Manual**, scenario 25 |
| Verify isolation | Parallel verify runs collide on ports or containers | Every suite and verify through the verify lock | Lock check below, scenario 26 |
| Batch rounds | Runs dependent batches together, or writes two batches in one tree | Rounds only from independent batches; one batch tree each; notes read before picking; picked in plan order; a conflict re-runs that batch alone | Pick check below plus **Manual**, scenarios 30–32 and 34 |
| Lens per batch | Reviews several batches in one pass, or from memory | One `senior-review-lens` call per batch range | **Manual**, scenario 33 — count the Skill calls in the transcript |
| Final close | Earlier PR closes ticket | Only final Rollout PR carries `Closes` | Manual, scenario 13 |
| Cross-slice review | Never reviews or harvests the combined result | Runs post-merge ticket lens, routes follow-up, and retains the harvested handoff record | Manual, scenario 14 |
| Branch safety | Mutates dirty foreign branch | Stops and surfaces choices | Manual, scenario 15 |
| Repository-owned context | Assumes a fixed domain-document path | Updates the canonical domain model named by repository instructions when one exists | Manual, scenario 16 |

**Pass threshold:** skill wins at least two thirds of applicable signals; branch safety, current-slice correctness scope, and final-ticket close have zero tolerance.

## Deterministic Checks

```bash
grep -iEc "route (a|b|r|c|d|e|w|f)" output.md
grep -Ec "gh pr create --draft" output.md    # scenario 6
grep -iEq "evidence" output.md && grep -iEq "impact" output.md && grep -iEq "next" output.md   # scenario 12
grep -Ec "\.ai-context/domain-types\.md" output.md   # scenario 16
# Blocks are actor-scoped — expect >=1 on 17-19, and 2 on 20, whose input held two. The em-dash is
# the discriminating part: the shared `## Resume` this replaced scores 0, and a close-out that
# tidies the blocks away scores 0 where the retention rule requires 2.
grep -Ec "^## Resume — .+" output.md          # scenarios 17-20
# The holder was read rather than ignored — expect >=1 on 18. Does not prove the planned slice is free.
grep -Ec "actor-b" output.md                  # scenario 18 only
# Every surviving block is stamped, so no spent position reads as live — expect 2 on 20.
grep -Ec "^- Closed:" output.md               # scenario 20 only
# The outcome leads the printed handoff — expect 1: of the handoff's own headings, `## Outcome` comes
# first. A handoff that keeps a Resume block or Carry forward above it scores 0.
grep -m1 -E "^## (Outcome|Resume|Carry forward)" output.md | grep -Ec "^## Outcome"   # scenario 20 only
# The reference travelled in the payload — expect >=1 on 21. A run that routes it through the
# spec file scores 0, because the parameter is never named.
grep -Ec "reference-paths" output.md          # scenario 21 only
# Parallel wave — expect >=2 on 23 (one per slice). A sequential run never names the script.
grep -Ec "slice-tree\.sh" output.md           # scenario 23
# The held slice is left alone — expect 0 on 24: no tree is created for s1. Expect >=1 for s2: a
# slice of a two-slice wave runs in its own tree even when this actor takes only that one. Keyed on
# the tree path, since a `slice-tree.sh` call often wraps its arguments onto the next line.
grep -Ec "slice-trees/[^ \"]*-s1\b" output.md   # scenario 24: s1
grep -Ec "slice-trees/[^ \"]*-s2\b" output.md   # scenario 24: s2
# Verify through the lock — expect >=2 on 26. A run that verifies in place scores 0.
grep -Ec "verify-lock\.sh" output.md          # scenario 26 only
# Only one reviewer writes memory — expect >=1 on 29. A run that lets both write scores 0.
grep -Ec "memory: ?.?read-only" output.md      # scenario 29 only
# A parallel round picks its batches back — expect >=2 on 30, 0 on 32, which has no round to pick.
grep -Ec "batch-pick\.sh" output.md          # scenarios 30 and 32
```

## Saturation Signals

| Signal | Saturation Level |
|---|---|
| Baseline refuses to write code | Partial — monitor |
| Baseline reconstructs simple routes | Full — retain only new routes |
| Baseline separates PR slices from executor batches | New — retain |
| Baseline preserves and harvests a bounded shared handoff | New — retain |
