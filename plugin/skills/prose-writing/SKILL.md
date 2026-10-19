---
name: prose-writing
description: Construction, relevance and placement pass over prose that outlives the conversation: commit messages, PR titles and bodies, code comments, markdown docs, spec sections, skill and agent instructions, frontmatter descriptions, error messages, tracker tickets. Use before writing or editing any of those, and before staging a docs change. Catches padding, cadence-driven triplets, restated ownership, inferences written as facts and over-compression.
---

# /prose-writing — the pass durable prose goes through before it lands

**`writing.md`, beside this file, is canonical.** It holds the rules; this file holds the pass that applies them — the pre-filter, the read, the test and fix for each rule, and the per-artifact traps. Where the two disagree, `writing.md` wins and this file is stale.

## When this runs

Before the write, not after. Anything that survives the conversation gets the pass: commit subjects and bodies, PR titles and bodies, code comments, markdown files, spec sections, skill and agent instructions, frontmatter descriptions, user-facing error copy, tracker ticket text.

Scope is artifacts that outlive the conversation, the same as `writing.md`. Chat replies are out of scope — they answer a reader who has the conversation. Durable prose answers one who does not.

**The pass gets skipped on artifact prose** — rules applied to the reply and forgotten at the file. Run it on the draft before it reaches disk.

## Step 1 — the pre-filter

This finds the named phrases and nothing else. It is the cheap first pass, and **a pass that stops here has not happened.** Everything whose only fault is that it sounds good — a triplet, an aphorism, a paragraph introducing the section below it — matches no pattern here and survives every hit being fixed.

```bash
# staged changes
git diff --cached -U0 | grep '^+' | grep -nEi \
  'not just|rather than|instead of|earns its place|load-bearing|worth noting|the point is|the interesting bit|honestly|to be fair|does not|it.s not [a-z]+, it'

# a file about to be committed
grep -nEi 'not just|rather than|instead of|earns its place|load-bearing|worth noting|the point is|does not' <path>
```

Every hit is a candidate for review, and some survive it.

## Step 2 — the read

Read every added line of prose, in diff order. Where the prose is yours, that is the whole read: what you wrote is what has not been checked.

**Someone else's prose needs the file, not the hunk.** Construction survives isolation — a walk-up paragraph reads the same anywhere. Relevance and placement do not: each judges the prose against what already exists, and what already exists is unchanged, so the diff omits it. A comment restating the `it()` title below it, a comment repeating one 150 lines up, a comment duplicating the source symbol it explains, a comment an edit above it left anchored to the wrong line — a hunk shows none of these and the file shows all four.

So when reviewing: read each changed file whole, and open what the prose annotates — the declaration under a code comment, the `it()` under a test comment, the source a test comment explains. Extracting the comments into a list and reading the list finds none of the four.

No category is exempt. Prose you moved, inherited, or only renamed a word inside is in the diff, so it is in the read — "pre-existing" describes where the text came from, not whether it has been checked. Set aside a wholesale rewrite of a register you did not introduce, and say so; a tic identical to one you just fixed elsewhere gets fixed wherever it sits.

Read a repair too. A fix written to cut one tic routinely introduces another, and the repair is the line least likely to be re-read.

Apply the four lenses below to each paragraph as you go. They are what you read for, not stages that follow the read.

## Lens 1 — construction

| Tic | Test | Fix |
| --- | --- | --- |
| Walk-up, announcing frame, affirm-then-justify, editorialising lead-in | Does sentence one carry a fact, or announce, affirm or editorialise first — "Two things remain open", "Good question, and it matters", "To be fair"? | Delete it. Open on the fact. |
| Self-commentary | "this reads better as", "that is a virtue rather than a workaround" | Delete. Prose does not review itself. |
| Negation-contrast | grep `rather than`, `instead of`, `not a .* but` | Keep only where the contrast is the information — a migration note, a corrected assumption. Otherwise state the positive and drop the foil. |
| "not just A, but B"; define-by-absence | grep `not just`; "X is not Y, it's Z" | State B; write "X is Z". |
| Negative space | "does not use X", an enumerated list of absences | Cut the absences. A positive claim stands alone. |
| Banned phrases | the pre-filter | Rewrite the claim in its own words. |
| Triplet or anaphora | Does a sentence repeat a structure for cadence — "four kinds, four templates, four bars"? | Keep the one that carries a fact. Rhythm is not a claim. |
| Aphorism | Does a line sound quotable, and does the sentence beside it say the same thing concretely? | Keep the concrete one. An abstraction next to its own example adds nothing. |
| Section introduces the section below it | Does this paragraph tell the reader what the next heading is about? | Cut it. Move any fact it alone carries under that heading. |
| Restates its neighbour | Does this sentence re-assert the one above it in different words? | Cut the weaker. Closing a rule by naming what it is not usually restates the rule. |
| Telegraphic or fragmentary prose | Are necessary articles, verbs, or connecting words omitted, or is the subject unclear? | Restore the missing words and write brief complete sentences. Imperative instructions may use an implied subject; headings, labels, table cells and conventional commit subjects may remain fragments when unambiguous. |

## Lens 2 — relevance

Test: would a reader who was not in the conversation need this? Debates about where a thing should live, corrections made in flight and discarded reasoning fail it. Cut them.

## Lens 3 — placement

- Another artifact owns it → link or cite it by path and line. A copy disagrees with its source within a day.
- A wrapper restating what it wraps → cut the restatement. A comment over an `it()` whose title already names the rule is this case, and reads as new information until you look at the line below.
- One reason in a source file and again in its test → keep the source's and cut the test's, unless the test copy carries a fact about the test itself: a fixture choice, why one journey covers three cases, why the case cannot sit in the obvious file.
- Right information, wrong altitude → move it. A scoping argument does not belong in a glossary.
- The right reason over the wrong line → re-anchor it. An edit that adds a case between a comment and what it explained leaves the comment sitting over the wrong one.

## Lens 4 — assumptions

Apply the Verified / Inferred / checkable-but-unchecked rubric in `writing.md` to every claim. An inference written as a fact is the one error a reader cannot detect.

## Reporting the pass

Say which files got the read, and keep the two steps apart: _"sweep: 5 hits, 5 fixed; read: 3 files, 4 findings."_ A count from the pre-filter reported as the pass is how "reviewed" comes to mean "grepped".

Where a file was not read, name it. A reader takes "reviewed" to cover everything in the diff.

Name the unit too, where the prose was someone else's: _"read: 6 files whole"_ against _"read: the added comments"_. The second is a list pulled out of a diff, and it cannot have found a restatement or a duplicate.

## Per-artifact traps

| Artifact | Trap |
| --- | --- |
| Commit subject | Conventional Commits type matches what the change is. Where the org checks the **PR title** instead, follow the client's commit convention. |
| Commit body | Its reader has `git log` and nothing else. Anything that needs the conversation to parse is cut. |
| PR body | The ticket and the spec already say what the work is. Link them, then state what this PR does that they do not describe. |
| Code comment | The code states what. A comment states why, or drifts from the line below it. |
| Markdown doc | Living: it holds what is true now. Completed tasks are removed, not ticked and annotated. |
| Frontmatter description | Retrieval triggers, phrased as the user would phrase the request. |
| Error copy | Match the audience — end users get the next action, developers get the precise cause. |

## Living docs and dated records

The rule is in `writing.md`. The test: a living doc fails if it records what _was_ true; a dated record fails if you edit it to match what is true now, and stays out of repo-wide sweeps.

## Worked example

A commit body carrying the conversation instead of the change:

```
Worth noting this is the inverse of the caching change — we debated
whether to gate it per batch or at slice end, and slice end won because
a security finding costs more than a style finding. Doesn't use the
supply-chain recipe. Placement here rather than in the loop reads better.
```

The pass: announcing frame ("Worth noting"), conversation residue (the debate, its resolution), negative space ("Doesn't use"), self-commentary ("reads better"), negation-contrast ("rather than").

```
The dependency scan moves to 7.1 behind a manifest check. It is
dependency-scoped, so it costs the same once per slice as it does once
per batch.
```

## Scope

The pass runs on prose. Code identifiers, test descriptions and commit _types_ answer to their own conventions — `senior-review-lens` covers test naming and structural cohesion, the stack recipes cover identifiers.

A test title stays out of the pass as prose and comes into it as a neighbour: a comment above an `it()` is judged against the title below, so the title is read even where it is not edited.
