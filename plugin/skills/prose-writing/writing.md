# Communication standards

**State the point directly — no narrative, no hype.** Applies to everything that outlives the conversation: docs, commit messages, PR text, code comments, skill instructions and ticket text. Chat replies are out of scope. You aren't here to build relationships; you are here to help users quickly understand and make decisions. So state facts without validating the user's question or telegraphing that an answer is coming. Cut:

- walk-up paragraphs and dramatic framing ("the interesting bit is…")
- the "not just A, but B" construction
- affirm-then-justify openers ("good question, and it matters", "yes, and it's worth X, because Y")
- editorialising lead-ins ("honestly…", "the honest read is…")
- the phrases "earns its place" and "load-bearing"

Protect the reader's cognitive load. Prefer a table, a concise list, or bare fact over a paragraph that leads up to one.

**Expand every label on first use in a document.** An identifier that keys into a document the reader is not holding — `AC4`, `Lens F`, `slice 2`, `Route B′`, a ticket ID — carries its referent the first time it appears: `AC4 (a declaration the agent cannot hold is refused on the committing path)`, then `AC4` for the rest of that document. The clause costs a line; resolving the label costs a file open.

**Write for a pair who joined at the last message.** You have read files, run agents and seen diffs they have not. Say what the code does and why it matters here, in words they can follow without opening anything. A reference rides along so they can check afterwards: "the adapter reads a 403 on the versions list as the agent being out of reach, so the answer cannot claim it exists elsewhere (`agent-variables.adapter.ts:41`)".

**Concise is not clipped.** Apply the relevant sentence-construction principles of ASD-STE100 Simplified Technical English: use complete sentences with clear subjects and verbs, retain necessary articles and connecting words, prefer active voice, and keep one main idea per sentence. Imperative instructions may use an implied subject. Do not apply ASD-STE100's controlled vocabulary. Headings, labels, table cells and conventional commit subjects may use fragments when their form is unambiguous. Cutting filler means removing padding, not producing telegraphic prose; overshooting into terseness costs the reader a round trip the same way padding does.

**Don't describe negative space.** Naming what something doesn't contain tells the reader nothing — "does not use X" in a commit body is meaningless to anyone reading the log later without the conversation. A positive claim fails the same way once you enumerate the absences: "dependency-free" stands on its own; "dependency-free — no lodash, no date-fns" is a list of what isn't there.

**Never hide assumptions.** Every factual claim is one of three kinds:

- **Verified** — you read the file, ran the command or saw the source. Cite it.
- **Inferred** — a pattern suggests it. Mark it as inferred in the artifact, since the conversation that held the assumption is gone.
- **Checkable but unchecked** — a tool could settle it. Verify it before writing it.

Never state an assumption as fact, and be clear about knowledge gaps. When working autonomously, surface assumptions to the user through relevant documentation or reports as early as possible.

**Living docs and dated records have opposite rules.** Living docs — documentation, agent instructions, skills — must hold what is true now; dated records — changelogs, archived specs — hold what was true when written. Rules belong in living docs, the incident behind the rules does not; that belongs in changelogs or archived spec outcomes. Tasks in living docs should be **removed**, not annotated, when completed. Repo-wide changes, like find/replace text, should usually exclude dated records to avoid rewriting history.

**Check construction, relevance and placement before writing anything durable.** A commit body, a code comment, a doc paragraph, a spec section, a description, a PR body — anything that outlives the conversation gets all three:

- **Construction:** re-read what you wrote against the tic list above. Artifact prose is where that pass gets skipped.
- **Relevance:** is this information important to the work, or important to the conversation you just had? Sometimes when you clarify a point it can feel like important context, but on reflection is noise to someone who wasn't there. Assess for relevance, and if it isn't, cut it.
- **Placement:** is this already captured somewhere, and does capturing it *here* durably serve the reader? If another artifact owns it, link it — don't copy it, and don't let a wrapper restate what the thing it wraps already records. Just because something is relevant, doesn't always mean it's in the right place. Ensure the information is stored in the right place, and if that place isn't here, cut it.
