# Story template

*Guidance in italics. Delete as you fill each section. Delete any section with nothing to say.*

***The story is written from the user's point of view.*** *User Story, Background's closing line, Scope and acceptance criteria all say what person using product can now do. Technical Notes only section addressing pair who will build it — and even there, states what change requires, not how to build it.*

***One claim per bullet.*** *Acceptance criteria are one claim per row, most readable part of story. Every other bullet holds same bar. Second sentence fine where same claim — `Publishing. What is written lands on the draft.` names thing then consequence — but bullet carrying two facts is two bullets, and bullet carrying claim plus evidence should state claim, drop evidence. Past about thirty words, look for second claim. `[QUESTION]` or `[DEPENDENCY]` stating its resolution is one claim, exempt; so are Definition of Ready and Done checkbox rows, which are fixed boilerplate.*

## User Story

As a **\<role\>**
I want \<capability\>
So that \<benefit\>


*Role = person using product — almost always user. Check for more general user value before reaching for "as an engineer" — that fallback for when user benefit hard to phrase, not shape story should start in.*

## Background

*Three moves, in order: the near past — ticket this continues from; current state, briefly; then what this will do once shipped. One claim each, and do not state change twice.*

*That last line is one sentence for what system does, in words reader would use. Not role-want-benefit restated, not summary of acceptance criteria — a line walking through each criterion in turn is that summary, so name the one capability they add up to. `Given a listing and one of its component ids, the marketplace returns that component's stored content.` If takes two sentences, story probably two stories.*

Example: In STORY-123 we added price-rule definitions to bundles. Applying a bundle has not used them — owner still creates each rule by hand. Applying a bundle to a storefront now creates the price rules its components reference, reusing one already there rather than duplicating it.

## Scope

**In:**

* *Aspects of one capability. Every bullet traces to ACs that **exercise** it — not AC that
  describes it. Bullet you cannot trace to any AC is one of three things: untested work, second
  story hiding inside this one, or not scope at all — then it technical note or
  dependency.*
* *Change to another team's interface belongs here — this story needs it — with shape proposed in
  Technical Notes and agreement tracked as [DEPENDENCY]. Rarely earns own AC: AC asserting their
  contract commits to shape they have not agreed. ACs cover behaviour that depends on it.*
* *What user can now do, not work that delivers it. "Package can carry hook, publisher says where in
  conversation it runs" is scope; "add HOOK to component type enum" is build step behind it, and
  belongs in Technical Notes or an AC. Step 3 leaves you holding schemas you just read, so reword
  after triage. Constraint lifted out must still be asserted somewhere, or it was deleted, not
  rewritten.*

**Out:**

* *Only to kill assumption reader would otherwise make, or to say where dependency stops.
  Delete heading if nothing to name.*

## Open Questions / Dependencies

* *Undecided behaviour, flagged [QUESTION]. Implementation choices belong in Technical Notes.*
* *Dependency on another team — API design co-creation, for example — flagged [DEPENDENCY]. Story may propose interface in someone else's service; may not settle it.*
* *Empty before story Ready. Both tags block: undecided rule cannot be written as AC, unagreed dependency holds story out of sprint. Dependency clears by being agreed — where it remains fact of delivery sequence, moves to Background or References.*
* *Section is grooming-only: every entry leaves before Ready.*
* *A question leaves by deciding — rule becomes an AC, architectural call recorded in an ADR — or by splitting into own ticket this story depends on.*
* *A dependency leaves by being agreed, as above. Question open at handover is story not ready.*

## Acceptance Criteria

*Given / When / Then, branch-first: Given names case being covered, not incidental example that happens to exercise it. One AC per branch, plus edges that genuinely differ. Exemplary and well covered, not always exhaustive — this not test list, it agreement about behaviour, and must capture everything at that level.*

*No AC may contain TBD, TO CONFIRM, or undecided rule. If rule open, AC cannot be written, story not Ready.*

*One AC per rule, not per input that exercises it. Each field a validator refuses, each place a reference can sit, one field changed then two then three — same rule, one AC. Name the set in Given, or point at the contract rule list in Technical Notes. Enumerating them is the spec's test matrix, not the story's job.*

*Separate AC only where the code branches: none versus some, create versus reuse where outcomes differ, a case an implementation plausibly gets wrong. **Tie-breaker: could an implementation pass the other AC's demo and fail this one?** No = merge. Yes = keep, and the merged AC's demo must include that case.*

*Past roughly fifteen ACs, look for merges first, then a split. Forty ACs is a test plan or two stories, not an agreement about behaviour.*

*Placeholder standing for several values keeps table readable — allowed only where every value behaves identically. Name full set in Given — "any scalar type (string, number, integer, boolean)" — never in note above table. Where values differ in behaviour, separate ACs.*

*Group ACs by logical behaviour, for readability. Succeeds and fails usual split.*

*Behaviour holding across whole group still an AC, not prose above table — give it generic Given, let it take number, so it gets tested like everything else. Number ACs in one sequence across all groups, since referred to by number.*

*Across all groups, cover at least one failure, one edge case, one observable signal.*

*Story adding caller path, or changing who may reach existing one, gets permissions group: who may call it, what happens when caller may not, and — where resource tenant-scoped — what caller reaching for another tenant's sees. Extending what existing path does, without changing who may call it, needs none. Authorisation is behaviour, so ACs rather than technical note. This floor, not threat model; deeper analysis separate exercise.*

### \<capability\> — the \<action\> succeeds

| # | **Given** | **When** | **Then** |
| --- | --- | --- | --- |
| 1 |  |  |  |

### \<capability\> — the \<action\> fails

| # | **Given** | **When** | **Then** |
| --- | --- | --- | --- |
| 2 |  |  |  |

## 🎨 Designs

*Link them, or remove if no user-facing surface.*

## Technical Notes

* *Signposts for the pair, one claim each: a surface to build, a service to integrate with, a
  standard that guides the work.*
* *A note passes three tests at once: specific to this story, necessary to build it, and decided.
  Fails any one = cut it, or move it to the spec.*
* *Not implementation — how belongs to pair who will build it. No build steps, no rollout or slice
  order, no traversal or algorithm, no reasoning behind a decision. State the decision; the spec
  carries why, the alternatives, and the detail, and References links it.*
* *Rejected alternative earns a bullet only where the rejection would otherwise be relitigated.
  Decision needing its own record is an ADR, not a note.*
* *Never only place constraint appears — if violating bullet here would fail review, it
  belongs in Scope or in AC instead.*
* *Where outside source imposes bullets, group under heading naming it — "To conform with the
  API Standard:" — with our own notes ungrouped and first, since those the negotiable ones.
  Heading carries provenance in words, so body needs no link; any link goes in References.
  Only what source actually imposes goes under it: decision of ours that source merely
  informed stays ungrouped, and says so. Group of one not a group.*
* *Bullet may carry pointer or specification. May not carry proof — state conclusion and
  leave evidence in facts register, or reader redoes your work to reach what you already
  told them.*
* *Bullet that claims to be design but names schema layout, symbol or file is implementation wearing
  design's clothes. **Tie-breaker: would rename in repo make it wrong?** Then it belongs in repo
  spec — path, symbol name, route string, status code all rot at next refactor and nothing here
  notices, while spec sits beside code and moves with it. Design stated at right altitude survives
  rename: "audience visibility inherited, listing outside caller's scope indistinguishable from one
  that does not exist". Carve-out: interface shape this story proposes, or another team agreed,
  stays with its link — that contract is theirs to sign off, and not our code to rename. The
  shape stays; the reasoning behind each field and bound goes to the spec.*

## References

*Links and decision identifiers, provenance only. Nothing here needed to implement story:
anything worth knowing already said in full above. Never cite identifier in body and
expect reader to come here to decode it.*

*Every entry says why it there — contract to conform to, neighbouring ticket, decision
that settled scope call. Bare link unusable — annotation is only content entry carries. Rarely link to code: paths rot and nothing here notices, so code fact belongs in note that
states it or in facts register that tracks it.*

*Entry carries resolvable URL, not just identifier: `DEMO-40 — declarations this story validates
against` sends reviewer off to search. Ticket key gets browse URL, design doc its page, decision its
register row. Identifier alone only where no URL exists — say so, so reader stops looking. Both
halves required: link without annotation unusable, annotation without link unreachable.*

## Definition of Ready

- [ ] Business value clear
- [ ] Parent epic linked
- [ ] ACs complete, covering expected path, failure, edge case, one observable signal
- [ ] No AC depends on undecided rule
- [ ] Designs linked
- [ ] Application programming interface contract agreed — and where interface lives in another team's service, agreed with owning team before any of it built
- [ ] Dependencies known and stated
- [ ] Open Questions / Dependencies empty — every question answered, every dependency agreed
- [ ] Fits single sprint
- [ ] Testable
- [ ] Refined with team

## Definition of Done

**Acceptance**

- [ ] Every AC passes
- [ ] Accepted by requesting stakeholder
- [ ] No critical defects open

**Tests**

- [ ] Unit tests
- [ ] Component tests, for anything newly written or restructured
- [ ] Interface specification validated, if any interface changed
- [ ] Integration tests
- [ ] End-to-end test, if user-facing flow changed
- [ ] Code coverage at or above eighty percent, one hundred percent targeted

**Code and deployment**

- [ ] Reviewed and merged
- [ ] Non-functional requirements covered
- [ ] Observable signal from ACs works in production, not merely enabled in principle
- [ ] Deployed and verified in production

**Communication**

- [ ] Documentation and operational runbooks updated
- [ ] Dependent teams notified, if interface changed
- [ ] Release notes written
- [ ] Sprint demonstration updated