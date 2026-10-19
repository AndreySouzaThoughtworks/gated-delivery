---
name: story-drift
description: Check whether a groomed Story or Task has drifted before kickoff: read its linked tickets, epic siblings, working docs, decision records, contracts and specs, and report only what makes the ticket's text wrong now, with replacement text. Use before starting a groomed ticket or when asked whether a ticket is still accurate. Walks findings one at a time; read-only until the user approves a write.
---
# /story-drift — check a ticket for drift before kickoff

**Read-only until the user says write.** Every finding is a proposal. The user decides each one, and
nothing reaches the tracker before they approve the final text.

**A clean result is a normal result.** Most groomed tickets have not drifted. Report that and stop.
A finding raised to have something to report costs the team a review of a change nobody needed.

## Inputs

- `ticket-id` — e.g. `PROJ-123`. If missing, ask inline as free text.

## What drift is

A ticket drifts when something decided or delivered after grooming makes its text wrong. The
**sources** are where that shows:

| Source | What it can reveal |
|---|---|
| Linked tickets (blocks, is blocked by, relates to, duplicates, clones) | a dependency finished, abandoned or reshaped; part of this scope delivered elsewhere; a contract changed |
| Parent epic and its other children | scope moved to a sibling; the epic's breakdown changed; a sibling now owns a rule this ticket states |
| Decision records (ADRs) in the changed repositories | an accepted decision states a rule differently from a criterion; an open question here is answered there; a cited ADR is superseded |
| Contracts the ticket, its working docs or a linked spec names as canonical | a field, status, error or rule a criterion states differently since the contract changed |
| Specs of linked and sibling tickets | a resolved decision that changes this ticket's surface |
| Comments, here and on linked tickets | a decision agreed in discussion that never reached the criteria |
| The ticket's folder in the shared notes home (`## Delivery notes` → Shared notes home in the nearest CLAUDE.md; default `docs/gated-delivery/{ticket-id}/` in the changed repository) | anything the flow keeps for this ticket — findings, handoff, relocated design detail — naming the contracts or decisions a criterion rests on |
| Merged PRs linked from any of the above | behaviour on `main` that a criterion still describes as to-be-built, or describes differently |

An **unclear criterion** is a finding too, but only when it blocks kickoff: it depends on a rule
nobody has decided, it cannot be tested as written, it contradicts another criterion, or it uses a
term no source defines. Judge it against the kind's template in `gated-delivery:issue-writing`
(`templates/story.md`, `templates/task.md`).

## What is not a finding

- **Wording, style and template shape** that leave what gets built unchanged. That is
  `gated-delivery:issue-writing` Review mode; say so in one line if the ticket reads badly overall.
- **Implementation detail.** How it gets built is the implementer's call and the spec's content.
- **A claim with no source.** An inference stays out unless it would change a criterion, and then it
  goes to the user as a question, never as a proposed edit.
- **What the ticket already knows.** An open `[QUESTION]` with no new answer anywhere is still open,
  and saying so adds nothing.
- **A Proposed ADR or an open PR stated as decided.** Either can surface a question; neither settles
  one.

**The bar.** Left as it is, would the team build the wrong thing, test against the wrong rule, or
stall mid-sprint on something already known? No — drop it.

## Process

### 1. Read the ticket

Read the issue through the tracker mechanics the nearest CLAUDE.md names (`## Issue tracking` →
Mechanics), reading every populated field per the tracker adapter
`issue-writing/trackers/<tracker>.md`. Read every comment in full,
and the change history to its last page. Where the mechanics have no dedicated read for comments
and the change history, read them through their last-resort read, and check the comment count against what came back,
since a decision made in a comment is a source. A history request that returns only its newest page
reports it as complete, so on a ticket with sprint, rank or status churn the criteria edits fall
off it silently. Where the full history is out of reach, name the baseline as partial in the report
and compare every source against the current text, not only the ones dated after an edit.

- **Kind.** Decide it by `gated-delivery:issue-writing`'s *Pick the work kind first*, all of it —
  precedence, tie-breakers and the clarification question; the issue type alone lets a Spike filed
  as a Task through. Story or Task continues; a Bug, Spike or Design Task is out of scope: say so
  and stop.
- **Baseline.** From the history, the date each criterion was last edited. A source dated after its
  criterion's edit is the likeliest drift, so read those first. An older source is still compared
  against the current text: a later edit to one criterion says nothing about whether the others
  absorbed what came before it.
- **Inventory.** Status, criteria labels (`AC1`, `C1`, …), scope, open `[QUESTION]` and
  `[DEPENDENCY]` items, Technical Notes, parent, issue links, remote links, comments, and whatever
  the ticket's folder in the shared notes home holds.
- **Existing spec.** Look for `docs/specs/{ticket-id}-*.md` in the changed repository and
  `spec.md` in the ticket's folder in the shared notes home. If one exists, kickoff has already
  happened and the spec is where drift gets fixed: say so and ask whether to continue.

If the ticket names no repository, ask the user which repositories it changes before step 3.

### 2. Read the related work

One hop out from the ticket. Go a second hop only where a first-hop item names it as the reason
something changed.

- **Each linked ticket.** Status, resolution, summary, criteria, and comments since the baseline.
- **Parent epic.** Its description, including any suggested breakdown, and its children. Read the
  criteria of the siblings that name a surface this ticket names — a contract, entity, endpoint,
  event or field. Status and summary are enough for the rest.
- **Remote links.** PRs with `gh pr view` — merged ones describe `main`, open ones describe intent.
  Linked knowledge-base pages, when the ticket depends on them.

### 3. Read the decision records, contracts and specs

Find where each repository keeps them before reading: where the repository's instructions point
(e.g. `.ai-context/`), else its README and `docs/` tree. `docs/adr/` and `docs/contracts/` are common homes,
and a contract named as canonical can live in a repository the ticket does not change. Read on the
default branch, fetched remotely or from a freshly pulled local checkout.

- **Decision records.** In each repository the ticket changes, Status, Context and Decision of the
  records touching the ticket's surface. An open PR adding one counts as Proposed.
- **Contracts.** Each contract the ticket, its working docs or a linked spec names as canonical. Read
  the sections touching the ticket's surface, dated by the last commit or merged PR that changed
  each. An open PR changing one counts as Proposed.
- **Specs.** For each linked and sibling key, `spec.md` in `{key}`'s folder in the shared notes
  home and `docs/specs/{key}-*.md` in the changed repository. Read their resolved Decisions.

A repository with no decision records, or a ticket naming no contract, is a line in the report, not
a finding.

### 4. Compare and filter

Hold each criterion, scope bullet, open item and Technical Note against its own comments and what steps 2
and 3 found. Write each candidate as this list, one field per line:

- **Where** — the field and label: `AC3`, `Scope In, bullet 2`, `[QUESTION] 1`.
- **Now** — the current text, verbatim.
- **Why** — `Contradicted`, `Superseded`, `Resolved elsewhere`, `Dependency changed` or `Unclear`,
  with the source (key, path or PR, its date, a quote of two lines at most).
- **Proposed** — the exact replacement text, `remove`, or a new criterion with its text and label.
- **If left** — what goes wrong, in one sentence.

Then filter:

1. Re-read the source behind each candidate. Where it is Proposed, open or inferred, recast the
   candidate as a question for the user, or drop it. Where two sources disagree, show both and ask.
2. Apply the bar above. Drop what fails it.
3. Merge candidates with one cause into one finding. One ADR contradicting three criteria is one
   finding with three edits.

### 5. CHECKPOINT — walk the findings

**Clean.** Open the report with the line `No drift found`, those three words verbatim, so a reader
and a check both find the verdict without parsing a paraphrase. Then list each kind of source read with its count, plus anything that
could not be read and why, and any follow-ups on other sources as step 6 describes them, then stop.

**Findings.** One line first: how many, and of which kind. Then one finding at a time, in this
order — contradicted by a decision, dependency changed, superseded, resolved elsewhere, unclear.
Show the finding's block, then ask with `AskUserQuestion`, one finding per call:

- **Apply as proposed**
- **Apply with my wording** — take the user's text as given
- **Leave as is** — record it and move on; do not argue it again
- **Raise as an open question** — becomes a `[QUESTION]` or `[DEPENDENCY]` on the ticket

A decision that changes a later finding — a renumbered criterion, a removed scope bullet — updates
that finding before it is shown.

### 6. Write, on an explicit go

After the last finding, show:

- each changed field in full as it would read after the edit, criteria renumbering included;
- the tracker comment that goes with it, naming for each change the source that revealed it, and
  carrying the AI disclosure the client's instructions require.

Ask whether to write. On yes, write through `Skill(gated-delivery:issue-writing)` and its publishing
section: guardrail scan, write, re-fetch, then confirm the text landed word for word.
Definition of Ready boxes, assignee, sprint and points stay as they are.

**A finding raised as an open question on a Ready ticket** follows `gated-delivery:issue-writing`'s
Ready-status rule (*Read the status against the open questions*). Where the user agrees the ticket
moves back out of Ready, make that transition as part of the write. Otherwise the status stays as
it is.

Every source other than this ticket stays as it is; working docs belong to the workflow that wrote
them. A change one of them needs goes in the report as a follow-up for the user, with its source and
proposed text, and is not walked.

### 7. Report

What changed, what was left and why, and the follow-ups on other sources.
