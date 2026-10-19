---
name: issue-writing
description: Author, refine or review an issue-tracker ticket (Jira, GitHub Issues, Linear) as the work kind it is — Story, Task, Bug or Spike — against its own template, then publish it safely to the client's tracker. Use when writing, splitting or refining a ticket, when one reads like an implementation checklist, when checking a Story against the Definition of Ready, and for any write to a ticket, however small, even mid-implementation.
---
# Issue writing

| Kind | Template | Workflow |
|------|----------|----------|
| **Story** | `templates/story.md` | `workflows/story.md` — seven steps, three blocking stops |
| **Task** | `templates/task.md` | *Task* below |
| **Bug** | `templates/bug.md` | *Bug* below |
| **Spike** | `templates/spike.md` | *Spike* below |

Read the kind's template first. It carries the shape and the per-section guidance; the sections
below hold only what a template cannot say about itself.

## Pick the work kind first

A mis-routed ticket still comes out well-formed, so nothing downstream catches it — a Story skeleton
over a Bug invents a persona nobody has.

**Ask what the ticket produces.** One question separates all four:

| Kind | Produces |
|------|----------|
| **Story** | a capability that did not exist before |
| **Task** | a changed system, with the same capabilities |
| **Bug** | behaviour that was already promised, restored |
| **Spike** | an answer that changes a decision |

Most tickets settle there. The precedence below sources an answer where the ticket's own wording is
the only evidence, and the tie-breakers decide the contested ones — an observability change gives an
operator a view they did not have, which reads as a new capability until a tie-breaker separates
acting from receiving.

Precedence, highest first:

1. **Explicit instruction.** "Write this as a Spike" settles it.
2. **Semantic markers in the content.** A `Spike:` summary prefix, a `spike` label, a research
   question with a timebox. Expected-versus-actual behaviour and reproduction steps. A result with
   no user in it.
3. **Tracker issue type.**
4. **One clarification question**, where the signals above conflict or leave it genuinely open.

Never silently make a tracker-typed Story a semantic Story when its summary, labels and content describe a
Spike. Never make a Task a Spike because it holds an open technical question — a Task with an
open question carries a `[QUESTION]`; a Spike's whole output *is* the answer.

**Tie-breakers, for a contested answer.**

*Story or Task — does the named person act, or only benefit?* A role that acts in a criterion
belongs to a Story. A role that receives what the system does belongs in a Task's Description. This
holds even when the persona is accurate: a deployment dropping an in-flight apply genuinely hurts a
named Store Operator, and the ticket is still a Task, because every criterion has the system doing
something and that person on the receiving end. Deleting a role and losing nothing is the easy case;
this one catches the role that is real and still not a Story's.

*Story or Task — can the work produce what the kind's checklist asks for?* A Definition of Done
demanding unit, component, integration and end-to-end tests against a set of markdown runbooks is
the routing showing its error. Ask what the work can yield, not whether the checklist reads
awkwardly — on an intake board it arrives with the template and nobody chose it, so its presence
proves nothing either way. Where someone has already hand-deleted parts of it to make the ticket
fit, that deletion is the answer: a person removed obligations rather than meet them.

*Bug or Task — was the behaviour ever promised?* A Bug departs from intended behaviour, so something
must have intended it — a contract, a prior release, a product decision, an invariant. Work reading
Bug-shaped, with an expected, an actual and a reliable reproduction, is a Task where nothing ever
specified the expectation. A deployment that never had a drain step violates no contract; it never
had one.

*Spike or Task carrying a question — does the answer decide whose work it is?* A question about
known work whose answer changes its outcome is a `[QUESTION]` on a Task; one about how to build it
is the implementer's call. A question whose answer determines which repository or which team is
involved is a Spike, because until it is answered there is no Task to hang the question on.

Issue type alone cannot settle it on a board without a Spike type. The **Issue types** key of the
`## Issue tracking` section in the nearest CLAUDE.md names the board's types; where it has no Spike
type, existing Spikes usually sit on Task and on Story, with a `Spike:` prefix and a `spike` label
each used on some and not others.

**Board-specific kinds beyond these four are out of scope** — a Design Task, for one, has its own Goal, Stage, Scope, Constraints, Open Questions and
Design URL shape. Say it is unsupported and stop, rather than routing it through Task and flattening
that shape.

## Modes

| Mode | What to provide | Where the flow starts |
|------|----------------|-----------------------|
| **Draft** | Brief: verbal description, BA notes, PRD fragment, epic, meeting notes | Route to a kind, then its workflow from the top |
| **Refine** | Tracker ticket key (`PROJ-123`, `#123`), optionally plus extra context | Read type, summary, labels, description and custom fields **before** routing. The fetched ticket stands in for the draft, and its claims are assumptions until checked, whoever wrote them |
| **Review** | Ticket key or drafted ticket | *Review mode*, below — proposals only, no edits |
| **Spike closeout** | A Spike whose research has finished | Refine mode on a Spike, filling the Closeout sections |

Ticket key plus brief combines Draft and Refine: read the existing ticket, augment with the
material, continue. None of these provided? Ask before proceeding.

Refine preserves useful content while moving it into the right shape. A Bug written as a Story keeps
its facts; what changes is where they sit.

## The template serves the work

Work not sit in template cleanly? Then template wrong, or what you put in it wrong. Never reshape
delivery to satisfy rule — no re-cutting story boundary, no reviving deprecated ticket, no inventing
AC because rule demanded one. Rule that fires = evidence about draft, not instruction to manufacture
whatever silence it. Say what rule caught, say why work shaped that way, let human decide which one
gives.

## Ask, don't assume

Tickets = collaboration with user. Draft from what you know, but never assume without confirming.
Ask for info rather than waste time and money on half-truths.

Info gaps where you ask:

- **You don't know how the system behaves** - before scanning unfamiliar services, ask user for repository references. When searching these, prefer remote versions, or if local you MUST be on main with latest pulled.
- **A file you found is not in a repo** — loose file, fixture, export, anything outside tracked repo or design registers. Ask user what it is and whether to trust before using. Never cite one you not asked about.
- **You don't know the product intent** - for broad understanding, ask user for product spec docs or epics. Can also offer research relevant Notion docs. At lower levels, ask user questions.
- **Nobody has decided on a particular rule yet** — ask whether the answer changes the ticket's agreed outcome: a Story's or Task's criteria, a Bug's expected result, the decision a Spike informs. If it does, it is an open question: discuss with user how to resolve it. If it only changes how the work gets done, it is the implementer's call — a Technical Note at most, never a `[QUESTION]`.
- **The template and these rules don't cover the situation** — say so plainly and ask. Never invent rule, never present one as though it came from here. Gap quietly filled = rule nobody agreed to.

Don't overload user. Batch and track questions rather than asking all at once.

## What every kind owes

These hold whatever the kind. Everything else — the seven steps, INVEST, the acceptance-criteria
table, the Definition of Ready and the Definition of Done — belongs to Story and travels with it.

- Verify an assumption before an assertion rests on it, and cite what settled it.
- Keep facts, decisions, questions and dependencies apart, and tag the last two so they block.
- Resolve every open question before the ticket reaches a Ready status. An open question is a
  grooming state: it either decides — the answer lands in the agreed outcome, or an ADR records it —
  or splits into its own ticket this one depends on.
- Give every reference a resolvable URL and a line saying why it matters; build ticket links from the
  `## Issue tracking` Ticket URL template when one is set. A reader who has to open the link to
  understand the ticket is reading an incomplete ticket.
- Scan for secrets, personal data, customer identifiers and internal detail before anything reaches
  the tracker.
- Show the complete proposed text and get approval before any write.
- Re-fetch after every mutation and confirm it landed as intended.

Do not carry the Story Definition of Ready or Definition of Done onto another kind. AC coverage
across every test layer, a coverage target, observability, deployment, stakeholder acceptance and
sprint demonstration are Story obligations, not universal ones.

## Task

A Task delivers a changed system — configuration, maintenance, migration, documentation, an
upgrade — where a Story delivers a capability someone can use. It says what is being done and why it
matters now, and what observable evidence says it is finished. Worked example:
`examples/upgrade-task.md`.

**A criterion carries whichever evidence states the result most directly** — a command and its
expected result, a generated or reviewed artifact, a measured state, or a condition and the
observable outcome it produces. The Given/When/Then table belongs to Story, where several criteria
share one precondition and the table shows the coverage across it. On a Task each criterion stands
alone, and splitting one sentence across three cells adds ceremony without adding a check.

**Never manufacture what the work does not have.** No invented persona, no value statement, no
failure branch, no edge case, no test-layer checklist. A Task that needs a persona to make sense is
a Story that was filed as a Task.

**An implementation checklist means the result was never stated.** Rewrite it around the result and the
evidence for it. Keep a step only where the step *is* the result — "the key is rotated in both
regions" is an outcome; "open the console" is not.

**A conformance value is configuration read back, not behaviour.** State the number as the
configured value, so a reader can check it against its source. Labelling it that way forces the
question that matters — where does this number come from? — and a target with no source anywhere in
the repository is a decision nobody has taken.

**A Task installing a guard needs a criterion where the guard catches something.** Criteria that the
guard exists, is configured and is documented can every one of them pass while it never fires. One
of them has to observe it firing on a real instance.

**A deliberate deviation from a standard goes in the Description, with the person who accepted it.**
Left in a reference annotation, a reader cannot tell a deviation from an oversight.

**Technical Notes stay optional.** A constraint whose violation would leave the Task incomplete
belongs in the Description or the Completion Criteria, where something tests it.

## Bug

A Bug records a defect: impact, what should happen, what does happen, how to see it, and where.
Worked example: `examples/duplicate-promotion-bug.md`.

**Expected and Actual must be genuinely different.** If they read as the same sentence with
different adjectives, one of them has not been written yet.

**Expected Result names what established the expectation** — the contract, the prior release, the
product decision, the invariant. Where nothing established it, the ticket is not a Bug; see *Pick
the work kind first*.

**Impact is observed, not projected.** Say who or what is affected, how often, and how badly.
Where the impact is possible rather than seen, say which it is.

**A suspected cause is a hypothesis and says so.** It never sits in Actual Result, which holds the
observed symptom: the status, the state transition, the thing the user saw.

**Where it will not reproduce deterministically, say so** and give the strongest evidence instead —
the trace, the log window, the frequency, the conditions that correlate. A Bug nobody can reproduce
is still a Bug. A Bug carrying steps that do not reproduce it gets closed as not-reproducible by
whoever follows them.

**Priority starts at Low, and the user sets it.** Draft every Bug at Low. Recommend a priority from
the Impact summary — who is affected, how often, how badly, and whether a workaround exists — give
the reason in a line, and ask the user to confirm or change it before publishing. A Bug refined from
the tracker keeps its current priority as the baseline; recommend a change only where the impact supports
one.

**No Story furniture.** No acceptance-criteria table, no Scope section, no Definition of Ready or
Done. Publishing has its own field mapping — see *Publishing to the tracker*.

## Spike

A Spike reduces uncertainty. It does not promise production behaviour. Worked example:
`examples/throughput-spike.md`, closeout included.

**One primary question or falsifiable hypothesis**, and the decision waiting on the answer. Where no
decision changes whatever the answer is, the research does not need a Spike.

**The question can be answered with "do nothing".** "Which mechanism detects X?" has already decided
that X needs detecting and that a mechanism will do it. Ask for the outcome the decision needs, and
let "accept the risk" and "not yet" be answers.

**The draft leaves the judging to the research.** A recommendation belongs in the closeout, however
sure the author is. A brief carried over from earlier work arrives full of conclusions, and its
claims are assumptions until checked, as a fetched ticket's are in Refine. A Spike whose draft
already ranks its options fails its kind's bar with every section filled.

**The timebox carries a duration or an end date.** "Timeboxed" with no value is incomplete — reject
it and ask. Reaching the timebox is a valid exit, an inconclusive result included, and the closeout
says so honestly rather than stretching the evidence to a verdict.

**Deliverables are concrete evidence**: measurements with the conditions they were taken under,
observed samples, compared options, a decision record, documented limitations.

**An artifact is evidence, not delivery.** A prototype, benchmark or configuration is in scope where
it answers the question. Adopting it in production, and fixing what the Spike found, are follow-up
tickets. A Spike never reports production behaviour delivered because an artifact exists.

**Closeout is a refine-mode act**, filled during or at the end of the research. It keeps evidence and
recommendation apart and names the limitations of what was measured.

**A new Spike follows the board's spike convention** — the **Spike convention** key of
`## Issue tracking`; absent one, a Task with a `Spike:` summary prefix and the `spike` label. Say so
when creating one, since boards often carry older Spikes that do not follow it.

## Publishing to the tracker

NEVER create or edit a tracker issue unless asked, and show description for approval first. All tracker access goes through the **Mechanics** named in the `## Issue tracking` section of the nearest CLAUDE.md. Load `trackers/<tracker>.md` beside this file for that tracker's traps; where no adapter exists, say so and keep to the generic rules here.

**Read before writing.** Fetch every populated field, **custom fields** included — the tracker adapter says how. On intake-form boards `description` often null and real narrative lives in custom fields — restricting fetch to standard fields hides them, makes populated ticket look blank.

**Read the status against the open questions.** A ticket in a Ready status tells the next person it can be picked up, and an open `[QUESTION]` or `[DEPENDENCY]` says it cannot. Before a write that leaves one on a Ready ticket, including one the write itself adds, resolve it with the user, or agree with them that the ticket moves back out of Ready.

**A Bug's fields are fields, not prose.** Where the board exposes Environment, Steps to reproduce,
Expected Result and Actual Result as dedicated fields, discover their ids from the full read —
they are per-board, so never hard-code one — write each section into its own field, and leave the
description holding impact, context and references. Do not duplicate a field's full contents into
the description, and do not leave the fields empty with everything in prose, which is what the
Bugs already on the board do. Set the priority the user confirmed, taking its name from the
project's allowed values. Re-fetch afterwards and confirm each one landed.

**Where the technical detail lives.** Story and Task only — a Bug's detail belongs in Context and a
Spike's in Context or Deliverables, and neither has this section. Technical Notes belong in ticket. Template section, and reader who must open second document to learn what already decided has been handed worse ticket. What does not belong = bulk: full type list, file-by-file plan, test matrix. Nor anything that rots on rename, however short — bar an interface shape this ticket proposes or another team has agreed, which stays in the ticket with its link, because that contract is theirs to sign off and not our code to rename — eight bullets naming three file paths, route string and four status codes is not "handful of bullets, fine", it is spec that landed in ticket. When Technical Notes carry either, or board customer-visible, move that detail — not the section — to the ADRs or design docs of the repo being changed; where it has neither, or rejects planning artifacts, to `{ticket-id}/design-notes.md` under the **Shared notes home** of `## Delivery notes` (default `docs/gated-delivery/{ticket-id}/`). Keep decision and its consequence in note, cross-link both ways. Detail relocated, never deleted — ticket that moved detail out carries note pointing at where it went, and References carries link.

**A ticket in flight still belongs to the ticket.** Implementation turns up criteria that grooming
missed, and a ticket that cannot gain one is stale by the third slice. That update is legitimate on
two conditions: the user approves the text before it is written, and the write carries a comment
naming what revealed the change. Renumbering an acceptance-criteria table is normal and gets called
out in that comment, because sibling tickets and earlier specs cite those numbers.

**The ticket carries behaviour; the spec carries how it is built.** What an update may change is the
criteria, the scope and the user-facing rule. Contract shapes beyond the one this ticket proposes or
another team agreed, payload examples, rejected alternatives and the reasoning behind a decision stay
in the spec for the whole life of the ticket. A spec edit is therefore not a reason to touch the
ticket.

Where the two already disagree on design, the ticket keeps what the rule above already exempts — the
interface shape this ticket proposes or another team agreed — and the rest relocates to the spec,
leaving a note that points there and a References entry that reaches it. Relocated, never deleted,
and never overwritten with the spec's wording: syncing gives one decision two homes, and the
consistency pass below then has nothing to prefer.

**Guardrail scan before any write.** The tracker may be customer-visible, and org policy forbids PII, secrets, internal hostnames or infra names in it. Redact, or relocate to repo:

```
grep -niE '(password|secret|token|api[_-]?key|bearer|mongodb\+srv|\.internal\.|/Users/|AKIA|-----BEGIN)' <draft-file>
```

Append the **Extra guardrail terms** from `## Issue tracking` to the alternation. Run it over the saved draft, every field included. With no file named it waits on stdin and scans
nothing.

The grep is a floor, not the list. Also caller numbers, emails, conversation IDs, connection strings, hostnames, internal service names. A comment is as visible as a description unless it carries a visibility restriction — a "private note" is not private by intent. A Bug is where this bites hardest: the reproduction that actually reproduces it is the one carrying the real identifier.

That list is two tiers, and only one of them has an exception.

**Secrets and PII** — credentials, tokens, connection strings, caller numbers, emails, conversation ids — never reach the tracker in any field, a restricted comment included. Redact them and put the value where secrets belong.

**Internal detail that is not secret** — a hostname, an internal service name — may reach the tracker only in a verified restricted comment, and only when detail cannot leave the tracker. Never description, summary, labels, custom fields, or unrestricted comment. Repo first. Exception deliberate, not loophole: visibility restriction is only thing standing between that detail and a customer.

**Mutate safely.** Discovery before mutation — get transitions before transitioning, get link types before linking, discover fields before setting. Verify after — re-fetch and confirm change landed *as intended*. Link direction especially: re-fetch the dependent ticket and confirm it reads *is blocked by* the blocker, not reverse — the tracker adapter gives the call shape.

**Consistency pass** when ticket was split, or refined across artifacts. Cross-read ticket ↔ repo spec ↔ design doc and reconcile: same enum and config values, same story split, same field names, no stale wording from decision that changed. Contradictions between documents = how invalid values survive — one authoritative source, others link to it.

**Transparency.** Where org policy requires AI disclosure on artifacts that leave chat, apply it. Draft any customer-facing tracker comment locally and hand it over rather than posting under automation without sign-off.

## Review mode

Route first. Reviewing a ticket against the kind it was filed as buries the mismatch, so establish
the kind before anything else.

A mismatch is the lead, not the verdict. It is the thread worth pulling, and what it reaches is
usually worth more: criteria dressing a content requirement as behaviour, or a dozen of them
carrying work a neighbouring team shipped as two tickets. Report the kind, then keep reading.

Then read it and check against the rules for its kind. Report what it fails, where, and the failure
the rule prevents. Then propose edits — don't apply unless asked.

Review against the kind. A Bug does not fail for having no persona, a Spike for having no
production acceptance criteria, a Task for having no acceptance-criteria table. Reporting one of
those sends the author to fix a ticket that was already right.

Don't score ticket. Number invites arguing about number instead of finding. Where rule is judgement
call rather than mechanical one, say so, and say which.
