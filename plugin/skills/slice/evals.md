# Evals: slice

## What "Works" Means

`/slice` routes from observable state, divides the current Rollout slice into functional batches, and gates every PR at its merge boundary. The executor writes feature code; `/slice` applies and commits review fixes at 6.3, 7.1 and 7.2, because two writing actors must never share a working tree. Success includes early draft feedback, one validator stack per slice, exact slice-scoped correctness review, and a shared handoff that preserves only evidence and resume context another session needs.

> Full runs need the tracker Mechanics named under `## Issue tracking` and the executor, validator, security, and review agents. Personas provide enough state to judge routing without live integrations.

## Execution Model

mode: response

## Test Scenarios

Ids stay stable. Scenario 2 was retired as format-only; see Saturation Signals. Scenario 4 was merged into 9, 14 into 20, and 18 into 24. Scenario 1 was retired as saturated; scenarios 3, 9 and 23 cover routing.

| # | Prompt | Persona | Pass Criteria |
|---|---|---|---|
| 3 | "Continue the PROJ-127 spec." | Repo-hosted spec on `main`; Open decisions all resolved; no `## Rollout`. ACs: AC1 `POST /exports` creates an export job and returns 202 with its id; AC2 `GET /exports/{id}` returns the job status; AC3 a worker writes the CSV to object storage and marks the job done; AC4 only the tenant that created a job can read it. The user approves the Rollout you propose. | Proposes a concrete Rollout that puts each of AC1–AC4 in exactly one slice and declares each slice's exposure; publishes the spec and stops. Fails if a slice exposes `GET /exports/{id}` without AC4. |
| 5 | "Plan the current slice." | Current slice has three ACs: two target one helper, one targets its adapter. | Groups the batches by subject and seam; keeps distinct RED/GREEN cycles for the two helper behaviors. |
| 6 | "Execute this two-batch slice." | Batch 1 complete; no PR yet. | Runs the repository suite only when `HEAD` moved past the executor's last verified commit; validators and full check wait for slice end. |
| 7 | "Finish the slice." | `## Review routing` names three stack validators for the repository's stack, all configured; all batches complete; package manifest unchanged. | Runs the three configured stack validators once, full check once, and the whole-slice lens; reports the gates and asks whether to mark the PR ready. |
| 8 | "Finish a dependency-changing slice." | Lockfile changed in one of three batches. | Runs code security on relevant batches and one supply-chain scan at slice end, not one dependency scan per batch. |
| 9 | "Continue after PR 1 merged." | Rollout has three slices; s1 merged, no s2 branch. | Plans only s2's batches. |
| 10 | "Resume PROJ-130 on a second machine." | Draft PR and remote slice branch exist; local notes are absent; the shared handoff names the base, last verified commit, next action, and an OPEN item. | Reads the handoff before routing, uses its resume context, and treats missing local notes as expected. |
| 11 | "Executor found a possible cleanup." | Note has no evidence and no later actor needs it. | — |
| 12 | "Executor is blocked by a contract contradiction." | Reproducible evidence; another person must decide; no canonical destination contains the finding; losing the conversation would risk losing it. | — |
| 13 | "Prepare PR 2 of 4." | Later Rollout slices remain. | PR body names satisfied and outstanding ACs; only the final unmerged slice closes the ticket. |
| 15 | "Branch and start." | Dirty tree on an unrelated branch. | Stops. |
| 16 | "Close the completed ticket." | Repository instructions name `.ai-context/domain-types.md` as the only canonical domain model. | Merges the domain delta into the declared path and does not propose creating a different document. |
| 17 | "Compact and continue elsewhere." | Current slice has a branch, base SHA, last verified commit, and one next action in local notes. | — |
| 19 | "Push the handoff — the other machine got there first. Print the merged handoff in full." | Remote added the Carry-forward entry `Flaky fixture` and local added `Slow migration`. Both edited this actor's own Resume block: the remote copy reads `Updated: 2026-10-20T09:00Z`, the local copy `Updated: 2026-10-20T11:30Z`. | Other blocks untouched. |
| 20 | "Close out PROJ-141, then print `handoff.md` as you leave it, in full, and the first line of `handoff-s2.md`." | Both Rollout slices merged. The Shared notes home sits inside the repository. `PROJ-141/handoff.md` holds `## Resume — actor-a — s1`, one `HARVESTED → ADR-12` entry, one dead end with evidence titled `Cursor pagination dead end`, and one `OPEN` entry titled `Retry limit unstated` recording an assumption the spec should state. The wave also left `PROJ-141/handoff-s2.md`, holding `## Resume — actor-b — s2` and one Carry-forward entry titled `Fixture reset order`, whose Impact reads `tests pass alone and fail in sequence`. | — |
| 21 | "Plan the slice on PROJ-142." | Ticket touches a technology the reference index carries an entry for. | Reads the matching reference before dispatch. |
| 22 | "Run slice 1 of PROJ-143." | The changed repository's `.ai-context/coding-conventions.md`, imported by its `CLAUDE.md`, permits a comment that gives a reason, which the production-code stack recipe bans; the production-code validator flags one such comment. | Passes the conventions document to the validators in `context`, assesses the finding using the repository convention, and leaves the comment in place, naming the deviation and its document at 7.6. Fails if it treats the finding as an instruction and deletes the comment. |
| 23 | "Run wave 1 of PROJ-150 in parallel." | Rollout: wave 1 holds s1 and s2, wave 2 holds s3. No Resume block holds a slice. | Dispatches both executors in one message. |
| 24 | "Pick up PROJ-151 — my colleague is on it too." | Wave 1 holds s1 and s2; `origin` already has actor-b's branch for s1, and the handoff holds `## Resume — actor-b` naming s1, its branch and draft PR. | Names actor-b as holder of s1. Fails if it edits another actor's block. |
| 25 | "s1 merged; finish s2." | Wave 1 of PROJ-152: s1 merged to `main`, s2 was green and ready before that merge. | — |
| 26 | "Run the slice-end gates on wave 1." | Two slices in flight, each with a review tree. | Dispatches both code-reviewers in one message. Fails if a verify runs outside the lock or one reviewer grades both trees. |
| 27 | "Start wave 1 of PROJ-153." | Wave 1 holds s1 and s2; `/spec` left the repo-hosted spec uncommitted in the main checkout. | STOPs for its merge, leaving the main checkout clean. |
| 28 | "Finish slice 3 of PROJ-154." | Slice 3's Done-when requires moving a shared test helper and adding a linear-time guard test; no AC covers either. | — |
| 29 | "Run both reviewers on wave 1." | Two slices end together. | Dispatches both code-reviewers in one message. |
| 30 | "Plan and run slice 1 of PROJ-160." | Three batches: a mask helper in `src/mask.ts`, a redact helper in `src/redact.ts`, and an adapter in `src/adapter.ts` that calls both. | Puts the two helpers in round 1 and the adapter in round 2; dispatches both executors in one message, then runs `batch-pick.sh` for each in plan order and the 6.4 lens on each printed range. Fails if a round-1 executor writes in the slice's own tree. The adapter's round holds one batch, so it runs in the slice's writing tree by design (`references/parallel.md`); only a round of two or more batches needs batch trees. |
| 31 | "Continue the round." | Round 1's second batch conflicts with the first on a shared test fixture; `batch-pick.sh` exits 3. | Leaves the slice as `batch-pick.sh` restored it, records the missed overlap, and runs that batch again alone on the new tip before round 2. Fails if it skips the batch. |
| 32 | "Plan the batches for slice 2." | Every batch crosses the seam of the one before it. | — |
| 33 | "Run round 2 of slice 1." | Two batches picked; `batch-pick.sh` printed `a1..b2` and `b2..c3`. | Both calls come before 6.3. Fails if a note records a lens verdict with no call behind it. |
| 34 | "Pick round 1." | One of the round's two executors wrote `## BLOCKED`. | Reads both notes before any pick. |
| 35 | "Claim s1 of PROJ-170." | This actor is `bob`. Wave 1 holds s1 and s2. On the same machine, `alice` claimed s1 4 ms earlier: her tree `slice-trees/PROJ-170-s1-alice` exists and her create-only push landed, so bob's create-only push is rejected. | Names `alice` as holder of s1 and routes again. Fails if it treats the slice as its own. |

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
| State routing | Improvises or resumes wrong slice | Selects Route A, B, B′, R, F, D, E, W, or C from evidence, first matching row winning | Manual, scenarios 3 and 9–10 |
| Merge-unit meaning | Treats dispatch as slice | One Rollout slice equals one branch, PR, and merge | Manual, scenarios 5–7 and 9 |
| Batch cohesion | Groups by size or AC count | Groups by test subject and production seam | Manual, scenario 5 |
| Early feedback | Waits until all work is complete | Opens draft PR after first batch | Manual, scenario 6 |
| Review placement | Repeats full stack per batch | Batch tests/lens/security; validators/check/reviewer at slice end | Manual, scenarios 6–8 |
| Requirement scope | Reviews whole unfinished ticket | Sends full text of current slice ACs to code-reviewer | Manual, scenario 7 |
| Handoff discipline | Copies routine status or loses resume context | Records evidenced carry-forward items and the exact resume point before a context boundary | Manual, scenarios 10–12 and 17 |
| Parallel isolation | One shared block, so the second session overwrites the first | One block per actor, and only this actor's is written | Heading check below, scenarios 17 and 19; whether another's block survived is **Manual** — a diff, not a count |
| Slice already held | Plans the slice another actor holds | Takes a free slice, and names the holder | Holder check below; **whether the planned slice is the held one is Manual**, scenario 24 — the number comes from the persona |
| Merge of two writers | Drops one side's evidence, or force-pushes | Both entries kept, block resolved by `Updated` | **Manual**, scenario 19 |
| Close-out record | A reader months later meets the route before the result, or the route is deleted to spare them | `## Outcome` leads the file; the blocks stay, stamped `Closed`; each per-slice file stays, marked folded | Close-out checks below, scenario 20 |
| Parallel wave | Starts dependent slices together, shares a tree, or skips the claim | Route W over independent slices only; each branch pushed as its claim; one slice tree and one executor per slice | Checks below plus **Manual**, scenarios 23–24 |
| Claim race | Two actors both hold one slice, or the loser deletes the winner's tree | One create-only push lands; the loser removes only its own `-{actor}` tree | Claim checks below, scenario 35 |
| Wave merges | Ships a sibling on evidence from before the other merged | Merges `main` in and reruns 7.1–7.5 | **Manual**, scenario 25 |
| Verify isolation | Parallel verify runs collide on ports or containers | Every suite and verify through the verify lock | Lock check below, scenario 26 |
| Batch rounds | Runs dependent batches together, or writes two batches in one tree | Rounds only from independent batches; one batch tree each; notes read before picking; picked in plan order; a conflict re-runs that batch alone | Pick check below plus **Manual**, scenarios 30–32 and 34 |
| Lens per batch | Reviews several batches in one pass, or from memory | One `senior-review-lens` call per batch range | **Manual**, scenario 33 — count the Skill calls in the transcript |
| Final close | Earlier PR closes ticket | Only final Rollout PR carries `Closes` | Manual, scenario 13 |
| Cross-slice review | Never reviews or harvests the combined result | Runs post-merge ticket lens, routes follow-up, and retains the harvested handoff record | Manual, scenario 20 |
| Branch safety | Mutates dirty foreign branch | Stops and surfaces choices | Manual, scenario 15 |
| Repository-owned context | Assumes a fixed domain-document path | Updates the canonical domain model named by repository instructions when one exists | Manual, scenario 16 |

**Pass threshold:** skill wins at least two thirds of applicable signals; branch safety, current-slice correctness scope, and final-ticket close have zero tolerance.

## Deterministic Checks

```bash
# A route is named by its capital letter — expect >=1 on 3 (R). Case-sensitive with a letter boundary, so "route all requests" scores 0.
# expect: >=1 on 3
grep -Ec "(^|[^A-Za-z])Route R([^A-Za-z]|$)" output.md
# Route C on 9.
# expect: >=1 on 9
grep -Ec "(^|[^A-Za-z])Route C([^A-Za-z]|$)" output.md
# Route W on 23.
# expect: >=1 on 23
grep -Ec "(^|[^A-Za-z])Route W([^A-Za-z]|$)" output.md
# The draft PR is opened — expect >=1 on 6. A line that says the command is not run, or is deferred, is dropped first.
# expect: >=1 on 6
grep -E "gh pr create --draft" output.md | grep -viE "(not|never|n.t|wait|defer)[^.]*gh pr create|gh pr create --draft[^.]*(yet|later|until)" | grep -c .
# The OPEN item is a Carry-forward entry — expect 1 on 12, printed only when the status is OPEN and the Evidence, Impact and Next labels each open a line.
# expect: ==1 on 12
grep -Eq '^\*\*Status:\*\* OPEN' output.md && grep -Eq '^\*\*Evidence:\*\*' output.md && grep -Eq '^\*\*Impact:\*\*' output.md && grep -Eq '^\*\*Next:\*\*' output.md && echo 1   # scenario 12
# The delta is written into the declared file — expect >=1 on 16: a line that stages it, an Edit or Write call on it, or one that
# merges, copies or folds a change into it. A line that negates the action ("will not merge ... into", "does not apply") is dropped first.
# expect: >=1 on 16
grep -iE "(git add|Edit\(|Write\()[^&;|]*\.ai-context/domain-types\.md|(merge|copy|fold|append)[^.]* into [^.]*\.ai-context/domain-types\.md" output.md | grep -viE "(not|never|n.t|no)( [a-z]+){0,3} (merge|copy|fold|append|edit|write|stage)|does not apply" | grep -c .   # scenario 16
# Blocks are actor-scoped — expect 2 on 20, whose input held two. The em-dash is
# the discriminating part: the shared `## Resume` this replaced scores 0, and a close-out that
# tidies the blocks away scores 0 where the retention rule requires 2.
# expect: ==2 on 20
grep -Ec "^## Resume — .+" output.md          # scenario 20 only
# The merge keeps both Carry-forward entries and the later `Updated` — expect 1 on 19, printed only when both entry names
# and the 11:30 stamp appear, the 09:00 stamp does not, and a Resume heading is there.
# expect: ==1 on 19
grep -qF 'Flaky fixture' output.md && grep -qF 'Slow migration' output.md && grep -qF '2026-10-20T11:30Z' output.md && ! grep -qF '2026-10-20T09:00Z' output.md && grep -Eq "^## Resume — " output.md && echo 1   # scenario 19
# Every surviving block is stamped, so no spent position reads as live — expect 2 on 20.
# expect: ==2 on 20
grep -Ec "^- Closed:" output.md               # scenario 20 only
# The outcome leads the printed handoff — expect 1: of the handoff's own headings, `## Outcome` comes
# first. A handoff that keeps a Resume block or Carry forward above it scores 0.
# expect: ==1 on 20
grep -m1 -E "^## (Outcome|Resume|Carry forward)" output.md | grep -Ec "^## Outcome"   # scenario 20 only # heading-match-intended
# The per-slice file stays, marked folded — expect 1 on 20. A run that deletes it prints no such line.
# expect: ==1 on 20
grep -Ec "^Folded into handoff\.md:" output.md      # scenario 20 only
# Nothing removes, moves or archives a handoff file — expect 0 on 20. A run that deletes it in the close-out commit scores 1.
# expect: ==0 on 20
grep -Ec "(^|[^a-z])(rm|git rm|git mv|mv) [^&;|]*handoff" output.md        # scenario 20 only
# The reference travelled in the payload — expect >=1 on 21. A run that routes it through the
# spec file scores 0, because the parameter is never named.
# expect: >=1 on 21
grep -Ec "reference-paths" output.md          # scenario 21 only
# Parallel wave — expect >=2 on 23: distinct slice ids on lines naming `slice-tree.sh` or a
# `slice-trees/` path, on a "same … for s2" line within three lines after one, or in a loop
# (`for n in 1 2;`, "for each `n` in 1, 2"). Keying on "same for sN" alone scored "# same three
# commands for s2" and the prose loop as 1. A one-slice run scores 1; a sequential run scores 0.
# expect: >=2 on 23
{ awk '/slice-tree\.sh|slice-trees\// {print; w=3; next} w-- > 0 && tolower($0) ~ /same[^.]*for/' output.md | grep -oE "\bs[0-9]+\b"; grep -oiE "for (each )?\`?[a-z]+\`? in [0-9][0-9, ]*" output.md | grep -oE "[0-9]+" | sed 's/^/s/'; } | sort -u | grep -c .   # scenario 23
# The held slice is left alone — expect 0 on 24: no tree is created for s1. Expect >=1 for s2: a
# slice of a two-slice wave runs in its own tree even when this actor takes only that one. Keyed on
# the tree path, since a `slice-tree.sh` call often wraps its arguments onto the next line.
# expect: ==0 on 24
grep -Ec "slice-trees/[^ \"]*-s1\b" output.md   # scenario 24: s1
# Tree made for s2.
# expect: >=1 on 24
grep -Ec "slice-trees/[^ \"]*-s2\b" output.md   # scenario 24: s2
# Verify through the lock — expect >=2 on 26. A run that verifies in place scores 0.
# expect: >=2 on 26
grep -Ec "verify-lock\.sh" output.md          # scenario 26 only
# No reviewer in a wave writes memory — expect >=2 on 29, one per reviewer. A run that lets one
# reviewer write scores 1. Counts occurrences, not lines: two dispatches often share one line.
# expect: >=2 on 29
grep -Eo "memory: ?.?read-only" output.md | grep -c .      # scenario 29 only
# A parallel round picks its batches back — expect >=2 on 30, 0 on 32, which has no round to pick.
# Counts distinct batch ids on lines naming `batch-pick.sh` or on a "same … for -b2" line within
# three lines after one: counting script lines scored "then the same for `-b2`" as 1.
# expect: >=2 on 30
# expect: ==0 on 32
awk '/batch-pick\.sh/ {print; w=3; next} w-- > 0 && tolower($0) ~ /same[^.]*for/' output.md | grep -oE "\bb[0-9]+\b" | sort -u | grep -c .   # scenarios 30 and 32
# Claim race. The push is create-only — expect >=1 on 35: an empty lease, the `:` followed by a
# space or line end. A plain push, a bare --force-with-lease, or a lease naming a SHA scores 0.
# expect: >=1 on 35
grep -Ec -e "--force-with-lease=refs/heads/[^ :]+:( |$)" output.md   # scenario 35
# The tree is made in claim mode — expect >=1 on 35. A reused or hand-made tree scores 0.
# expect: >=1 on 35
grep -Ec "slice-tree\.sh\"? --claim" output.md      # scenario 35
# The loser removes its own tree — expect >=1 on 35 — and never alice's — expect 0. One command
# per match: `&`, `;` and `|` end it, so a removal chained after another tree's never counts.
# expect: >=1 on 35
grep -Ec "worktree remove[^&;|]*-s1-bob" output.md                 # scenario 35: own tree
# Alice's tree never removed.
# expect: ==0 on 35
grep -Ec "(worktree remove|rm -rf)[^&;|]*-s1-alice" output.md      # scenario 35: alice's tree
# No slice branch, tree or executor dispatch in a Rollout turn — expect 0 on 3. A line that negates it is dropped first.
# expect: ==0 on 3
grep -E "git checkout -b|git switch -c|slice-tree\.sh|Agent\(subagent_type: ?slice-executor\)" output.md | grep -viE "[^a-z](not|never|no|without|avoid)[^a-z]|n't" | grep -c .
# No `spec` Skill call and no executor Agent call in the run — expect 0 on 3, read from the transcript.
# expect: ==0 on 3
grep -cE '.name.:.Skill.,.input.:\{[^}]*.skill.:.(gated-delivery:)?spec.|.name.:.Agent.,.input.:\{[^}]*.subagent_type.:.(gated-delivery:)?slice-executor.' transcript.jsonl
# Two functional batches are planned — expect 2 on 5: lines that open with a Batch label.
# expect: ==2 on 5
grep -Ec "^[-*#> ]*\**Batch [0-9]+" output.md
# The batch lens and a security decision come before the draft PR — expect 1 on 6.
# expect: ==1 on 6
awk '/senior-review-lens/ && !a {a=NR} tolower($0) ~ /security/ && !s {s=NR} /gh pr create --draft/ && !b {b=NR} END {print (a && s && b && a < b && s < b) ? 1 : 0}' output.md
# The reviewer gets the AC text and the Done-when is walked — expect 1 on 7.
# expect: ==1 on 7
grep -q "acceptance-criteria" output.md && grep -qi "done-when" output.md && echo 1
# s2 branches from updated main — expect 1 on 9: a fast-forward pull and a `-s2` branch.
# expect: ==1 on 9
grep -q "git pull --ff-only" output.md && grep -Eq "git checkout -b [^ ]*-s2( |$)" output.md && echo 1
# No `-s3` branch is created — expect 0 on 9.
# expect: ==0 on 9
grep -Ec "git checkout -b [^ ]*-s3" output.md
# Resume takes the existing branch — expect 1 on 10: fetch and pull appear. A new branch scores 0 below.
# expect: ==1 on 10
grep -q "git fetch" output.md && grep -q "git pull" output.md && echo 1
# No new branch is cut for a resume — expect 0 on 10.
# expect: ==0 on 10
grep -Ec "git checkout -b" output.md
# A note with no evidence stays local — expect 0 on 11: no Carry-forward status line and no commit or add of the handoff.
# expect: ==0 on 11
grep -Ec 'Status:\*\*|git (add|commit)[^&;|]*handoff' output.md
# The OPEN entry is recorded before the run stops — expect 1 on 12.
# expect: ==1 on 12
awk '/Status:\*\* OPEN/ && !a {a=NR} /[Ss][Tt][Oo][Pp]/ {b=NR} END {print (a && (!b || a < b)) ? 1 : 0}' output.md
# No closing keyword before a ticket key — expect 0 on 13. A line that negates it ("omits Closes PROJ-9") is dropped first.
# expect: ==0 on 13
grep -iE "(close[sd]?|fix(e[sd])?|resolve[sd]?) +#?[A-Z][A-Z0-9]*-[0-9]+" output.md | grep -viE "[^a-z](not|never|no|without|avoid)[^a-z]|n't|omits?" | grep -c .
# The dirty tree is offered a stash and stacking — expect 1 on 15.
# expect: ==1 on 15
grep -qiw stash output.md && grep -qi stack output.md && echo 1
# No git command that moves the tree ran — expect 0 on 15, read from the transcript.
# expect: ==0 on 15
grep -cE '.name.:.Bash.,.input.:\{.command.:.git (checkout|switch|stash|reset|branch)' transcript.jsonl
# The Resume block is written and pushed before compaction is recommended — expect 1 on 17. The run is response-mode, so no
# tool call exists to order against: the response lists its commands in the order it would run them. Compaction is the last
# line that names `/compact` or recommends it.
# expect: ==1 on 17
awk '/^## Resume — / && !a {a=NR} /git push/ && !p {p=NR} /\/compact|[Rr]ecommend[^.]*compact/ {c=NR} END {print (a && p && (!c || (a < c && p < c))) ? 1 : 0}' output.md
# The handoff push is not forced — expect 0 on 19.
# expect: ==0 on 19
grep -Ec "git push[^&;|]*(--force|-f( |$))" output.md
# The ticket-wide sweep over squash SHAs and the per-ticket Done-when are both named — expect 1 on 20.
# expect: ==1 on 20
grep -qi "senior-review-lens" output.md && grep -qi "squash" output.md && grep -qi "done-when" output.md && echo 1
# `## Outcome` carries the harvested item and the dead end — expect 1 on 20.
# expect: ==1 on 20
awk '/^## / {o = ($0 ~ /^## Outcome/)} o' output.md | awk '/ADR-12/ {a=1} /Cursor pagination/ {b=1} END {print (a && b) ? 1 : 0}'
# The s2 Carry-forward entry is copied in unchanged — expect 1 on 20.
# expect: ==1 on 20
grep -qF '### Fixture reset order' output.md && grep -qF 'tests pass alone and fail in sequence' output.md && echo 1
# The OPEN entry is harvested, not dropped — expect >=1 on 20: a HARVESTED status inside the `Retry limit unstated` entry.
# expect: >=1 on 20
awk '/^### / {h = ($0 ~ /Retry limit unstated/)} h && /HARVESTED/ {n++} END {print n + 0}' output.md
# No reference listed under `## Relevant files` — expect 0 on 21. A line that negates it is dropped first.
# expect: ==0 on 21
grep -iE "relevant files.*reference|reference.*relevant files" output.md | grep -viE "[^a-z](not|never|no|without|avoid)[^a-z]|n't" | grep -viE "instead|rather than" | grep -c .
# The conventions document is on the state block and goes to the executor — expect 1 on 22.
# expect: ==1 on 22
grep -qE "Conventions:.*coding-conventions\.md" output.md && grep -q "repo-conventions" output.md && echo 1
# Branches are pushed before the first executor dispatch — expect 1 on 23.
# expect: ==1 on 23
awk '/git push/ && !p {p=NR} /Agent\(subagent_type: ?slice-executor\)/ && !e {e=NR} END {print (p && e && p < e) ? 1 : 0}' output.md
# s3 does not start — expect 0 on 23.
# expect: ==0 on 23
grep -Ec "slice-tree\.sh[^&;|]*-s3|slice-trees/[^ \"']*-s3|git checkout -b [^ ]*-s3" output.md
# Each executor has its own worktree — expect >=2 on 23: distinct slice trees on `worktree` lines.
# expect: >=2 on 23
grep -i "worktree" output.md | grep -oE "slice-trees/[^ \"']+" | sort -u | grep -c .
# The claim is an empty commit — expect >=1 on 24.
# expect: >=1 on 24
grep -Ec "commit --allow-empty" output.md
# main is merged into s2 with no rebase, 7.1–7.5 rerun, and ready comes after the merge — expect 1 on 25.
# expect: ==1 on 25
grep -Eq "git merge[^&;|]*main" output.md && ! grep -E "git rebase" output.md | grep -viE "[^a-z](not|never|no|without|avoid)[^a-z]|n't" | grep -q . && grep -Eq "7\.1.{1,3}7\.5" output.md && awk '/git merge/ && !m {m=NR} /gh pr ready/ && !r {r=NR} END {exit !(!r || (m && m < r))}' output.md && echo 1
# Each slice has its own review tree — expect >=2 on 26.
# expect: >=2 on 26
grep -Eo "slice-review/[^ \"')]+" output.md | sort -u | grep -c .
# The spec lands through a docs branch — expect 1 on 27.
# expect: ==1 on 27
grep -Eq "git checkout -b docs/[^ ]*spec|docs/[A-Z]+-[0-9]+-spec" output.md && echo 1
# No slice branch or tree is created yet — expect 0 on 27. A line that negates it is dropped first.
# expect: ==0 on 27
grep -E "git checkout -b feat/|slice-tree\.sh" output.md | grep -viE "[^a-z](not|never|no|without|avoid)[^a-z]|n't" | grep -c .
# The extra obligations go to the executor as `slice-tasks` — expect 1 on 28.
# expect: ==1 on 28
grep -q "slice-tasks" output.md && grep -q "slice-executor" output.md && echo 1
# The orchestrator writes no file itself — expect 0 on 28, read from the transcript.
# expect: ==0 on 28
grep -cE '.name.:.(Write|Edit).,.input.' transcript.jsonl
# Reviewer lessons go to Carry forward for Route F — expect 1 on 29.
# expect: ==1 on 29
grep -qE "Carry[ -]forward" output.md && grep -q "Route F" output.md && echo 1
# One batch tree per round-1 batch — expect >=2 on 30.
# expect: >=2 on 30
grep -Eo "slice-trees/[^ \"']*-b[0-9]+" output.md | sort -u | grep -c .
# The adapter (batch 3) gets no batch tree — expect 0 on 30.
# expect: ==0 on 30
grep -Ec "slice-trees/[^ \"']*-b3" output.md
# The conflict is not hand-merged — expect 0 on 31. A line that negates it is dropped first.
# expect: ==0 on 31
grep -E "git merge|cherry-pick|--theirs|--ours" output.md | grep -viE "[^a-z](not|never|no|without|avoid)[^a-z]|n't" | grep -c .
# A sequential chain gets no batch trees — expect 0 on 32. A line that negates it is dropped first.
# expect: ==0 on 32
grep -E "slice-tree\.sh[^&;|]*-b[0-9]|slice-trees/[^ \"']*-b[0-9]|worktree add" output.md | grep -viE "[^a-z](not|never|no|without|avoid)[^a-z]|n't" | grep -c .
# The reply says sequential and parallel — expect 1 on 32.
# expect: ==1 on 32
grep -qi "sequential" output.md && grep -qi "parallel" output.md && echo 1
# One lens call per printed range — expect 2 on 33: both ranges on lines that name the lens.
# expect: ==2 on 33
grep -i "senior-review-lens" output.md | grep -oE "a1\.\.b2|b2\.\.c3" | sort -u | grep -c .
# No call covers both ranges — expect 0 on 33.
# expect: ==0 on 33
grep -i "senior-review-lens" output.md | grep -cE "a1\.\.b2.*b2\.\.c3|b2\.\.c3.*a1\.\.b2"
# Nothing is picked while a batch is blocked — expect 0 on 34. A line that negates or defers it is dropped first.
# expect: ==0 on 34
grep -E "batch-pick\.sh" output.md | grep -viE "[^a-z](not|never|no|without|avoid)[^a-z]|n't" | grep -viE "until|before|first|wait" | grep -c .
# The block is surfaced — expect >=1 on 34.
# expect: >=1 on 34
grep -c "BLOCKED" output.md
# Both batch trees are kept — expect 0 on 34.
# expect: ==0 on 34
grep -E "worktree remove|rm -rf" output.md | grep -viE "[^a-z](not|never|no|without|avoid)[^a-z]|n't" | grep -c .
```

## Saturation Signals

| Signal | Saturation Level |
|---|---|
| Baseline refuses to write code | Partial — monitor |
| Baseline reconstructs simple routes | Full — retain only new routes; scenario 1 retired |
| Baseline separates PR slices from executor batches | New — retain |
| Baseline preserves and harvests a bounded shared handoff | New — retain |
| Baseline refuses executor dispatch while Open decisions remain | Full — format-only: baseline behaviour right, lacks house vocabulary (n=2, 2026-10-19) — retired 2 |
