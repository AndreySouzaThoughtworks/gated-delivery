# Story workflow

The Story branch of `/issue-writing`. Routing, the shared policy and tracker publishing stay in
`../SKILL.md`; this holds what only a Story does.

Fill the story template at `../templates/story.md`, relative to this file. Read it first — it
carries the shape and the per-section guidance.

Two worked examples of good:

- `../examples/domain-story.md` — domain rules, harder shape. Many ACs, four open questions story honest about.
- `../examples/tracer-story.md` — thin cut through three services. Wide scope, few rules.

## The flow

Seven steps.

**1. Place it in the sequence.** What previous story left behind, what this one adds? Sets boundaries, core background developers in refinement want.

**2. Draft the user story and scope.** One capability, In and Out. Fast, provisional, expected wrong. No ACs yet. Consider story size. Vertical slices preferred, but too-large stories drag on. Work out tension between completeness and ability to deliver value, parallelizable. Sanity-check draft against INVEST — Independent, Negotiable, **Valuable**, Estimable, **Small**, **Testable**. Failing Small = split, one behavioural fork per story; failing Valuable usually means summary named artifact where capability belongs.

> **🛑 Stop — scope and value.** Present draft, name every assumption in it step 3 will test. Ask for what roadmap knows and code cannot. Tell user your size assessment. Say whether anything in this scope also belongs to sibling story — one contract change needed by four stories = one dependency, named once and linked, not four bullets and four ACs.

**3. Go and check.** Every assumption becomes verified fact, decision, or open question — nothing stays assumption. Read code, schema, API spec, cite source.

Where story adds or changes interface, check proposed shape against the client's API standard — the **API standard** entry of `## Domain references` in the nearest CLAUDE.md; where none is named, ask whether one exists. Treat its normative sections (typically headers, error codes, URLs and naming, versioning, pagination, querying lists, idempotency, auth, and identity and tenancy) as binding. "Application programming interface contract agreed" in Definition of Ready means agreed *and* conforming to it. State conforming shape in story, put link in References — reader must not have to open standard to know what to build.

> **🛑 Stop — findings, before they are written anywhere.** Report each finding with evidence, say any which contradict draft. Don't put them in story yet. Discuss with user and refine.

**4. Triage every finding to exactly one home.** AC if decided behaviour. Open question if undecided behaviour — and an open question is a grooming state, not a shipping one: before Ready it either decides (rule becomes an AC, ADR records an architectural call) or splits into its own ticket this story depends on. `[DEPENDENCY]` if needs another team's agreement. Technical note if solution design or API guidance. Repo spec if rename would make it wrong. Scope Out if kills assumption reader would make. Out of ticket entirely if outlives story. Cut if no reader needs it. Nothing goes in two places.

Triage before step 5 compresses anything. Split a bullet first and you split detail that should have left ticket — one long note naming three file paths becomes three short notes naming three file paths, tidier and no better.

Dependency on another team's interface = one finding legitimately in more than one section, because each says different thing: Scope In that story needs it, Technical Notes what shape we propose, `[DEPENDENCY]` that they not agreed yet. What it rarely gets = own AC — ACs cover behaviour that depends on it. AC asserting contract commits story to shape owning team not signed off, which is the one thing story may not do.

> **🛑 Stop — where each finding lands.** Table: finding, proposed home, one line of why. Include what you propose to cut, what you propose to send out of ticket. Misfiling fails quietly: well-cited fact still lands wrong place if it states rule and sits in Technical Notes, because nothing tests it there.

**5. Write the ACs.** Grouped, generic Givens for shared behaviour, no undecided rules. Then Technical Notes, then References.

**6. Review it cold, hostile.** Separate pass, after it already looks finished — run the best-practice rules below, the template's own rules, and the shared policy in `../SKILL.md` against it as if someone else wrote it. Trim as one of lenses: stories die carrying info that distracts from core, so cut changelog detail and negative space. Return proposals, not edits.

**7. Deliver.** Ticket keeps only what someone needs to build it. Where it goes to the tracker, that is *Publishing to the tracker* in `../SKILL.md` — never a write before user signed off on text.

Leave Definition of Ready boxes unticked — ticking them = team's act.

## Story writing best practice
Most best practice codified in template, here covers few extra rules.

**One claim per bullet.** ACs are one claim per row and they read best; every other bullet holds to the same bar. A second sentence is fine when it is the same claim — a thing named, then its consequence. Two facts is two bullets. A claim plus the evidence for it is the claim alone; the evidence goes to the ticket's working notes — this flow keeps them in `{ticket-id}/findings.md` under the **Shared notes home** of `## Delivery notes` (default `docs/gated-delivery/{ticket-id}/`) — or the repo's spec. Past roughly thirty words, look for the second claim; a `[QUESTION]` or `[DEPENDENCY]` stating its resolution is one claim and exempt, as are the Definition of Ready and Done checkbox rows.

**Every section answers in one line where it can.** The user story is one sentence, Background opens with one, a scope bullet is one line, a technical note is one line. A reader should be able to skim the whole ticket and know what is being built.

**One skeleton for every story shape.** Infrastructure, domain behaviour and tracer stories all use it. Devs reading four stories in sprint should not learn two layouts.

**The summary names a capability, not a task.** `Practice calls: serve the AI caller from the new runtime`, not `Implement PracticeCallerService`. Same reflex inside story — recast implementation noun into effect it has. "Add `PracticeCallerService` calling the LLM Gateway" becomes "practice calls produce the AI customer's replies from the new runtime, with no change to how the call feels."

**Link to stories, not document sections.** Other stories part of delivery piece, easy follow through. Reference where core to understanding this. But links to section in specific document can change. If info critical, include it as is. Can link source document at bottom of story.

**Clear and terse language** Avoid prose, editorialising. Readers busy, need get to what matters. They don't care how you came to position.

**Technical Notes are signposts, and the template defines them.** What the template cannot check while you write: a note is never the only place a constraint appears — if violating the bullet would fail review, the bullet belongs in Scope or an AC. A note stating a user-visible rule that no AC asserts is a missing AC.

**No requirement traceability at story level.** Epic link and labels carry it.

**An interface in another team's service is theirs to approve, before anything is built.** Story may propose shape; may not settle it. Dependency to list in questions/dependencies section. Story that builds unagreed contract in someone else's service not ready regardless how good proposal is.

