# Evals: prose-writing

## What "Works" Means

`prose-writing` is a **construction, relevance and placement pass** (encoded_preference): given
prose that outlives the conversation, it cuts the tics `writing.md` names, removes conversation
residue and restatement, marks inference, and reports the pre-filter apart from the read.

Success means the pass holds four invariants that a helpful-by-default assistant breaks:

1. **Cuts what only sounds good.** Announcing frames, negative space and restated neighbours leave
   the artifact; tidying the wording around them does not count.
2. **Leaves correct prose alone.** Clean text, a contrast that carries information, and a dated
   record survive the pass unchanged.
3. **Stays complete.** Cutting padding never produces note-form fragments.
4. **Marks inference.** A claim the persona cannot back is verified or marked inferred in the
   artifact.

> No integration dependency: each persona carries the draft and the surrounding facts, so the pass
> is judged from the response alone.

## Execution Model

mode: response

## Test Scenarios

| # | Prompt | Persona | Pass Criteria |
|---|--------|---------|---------------|
| 1 | "Write up the commit body from my draft." | Draft: "Worth noting this follows the retry change — we went back and forth on per-call versus per-batch limits and landed on per-batch. Doesn't touch the cache layer." The change caps retries per batch at three. | Revised body states the cap and why it is per batch. The announcing frame, the debate recap and the negative-space sentence are gone. |
| 2 | "Review the comment I added in this test." | `// rejects an empty name` sits on the line directly above `it("rejects an empty name", ...)`. | Recommends **deleting** the comment, because the title below already states it. Fails if it rewords the comment. |
| 3 | "Tighten this README paragraph." | "The importer retries a failed batch three times, then writes it to `dead-letter/` with the error attached. Run `pnpm replay` to resubmit everything there." | Reports no findings and returns the paragraph unchanged. Fails if it invents a finding to show work. |
| 4 | "Clean up this migration note." | "Token validation moves into the gateway rather than each service, so a revoked token is refused before it reaches any handler." Each service validated tokens until this release. | Keeps the contrast, because the reader is migrating from per-service validation. Fails if it drops "each service". |
| 5 | "Make this doc section concise." | Draft is already note form: "Cache warm on boot. Fallback DB if miss. TTL 60s, config." | Restores complete sentences with subjects, verbs and articles. Fails if it clips the draft further. |
| 6 | "Polish the PR body." | Body says "This fixes the timeout seen in production." The author reproduced and fixed it locally; nobody has checked production. | Limits the claim to the local reproduction or marks the production fix as inferred. Fails if the unverified claim stays as fact. |
| 7 | "Fix the tone of the 0.3.0 changelog entry." | Entry from a released version: "Moved config parsing to startup rather than first request." | Leaves the dated record as written and says why. Fails if it edits the entry. |
| 8 | "Run the pass on my staged diff." | Staged diff touches `README.md`, `src/importer.ts` (two new comments) and `docs/replay.md`. Two pre-filter hits, one real finding in the read. | Report keeps the pre-filter count apart from the read count and names every file read. Fails if a grep count is reported as the whole pass. |

## Agent Prompt Templates

### Baseline Agent (no skill)
```
You are a Claude Code assistant with NO skills loaded. Do NOT invoke any Skill tool.
The user will not answer follow-ups — use the context to decide yourself.
End your answer with a line containing only `--- REVISED ---`, then the final text of the artifact.
USER: {{PROMPT}}
CONTEXT: {{PERSONA}}
```

### Skill Agent
```
MANDATORY FIRST STEP: Invoke Skill("gated-delivery:prose-writing"). Then follow it.
The user will not answer follow-ups — use the context to decide yourself.
End your answer with a line containing only `--- REVISED ---`, then the final text of the artifact.
USER: {{PROMPT}}
CONTEXT: {{PERSONA}}
```

## A/B: Skill vs No-Skill

| Quality Signal | Without Skill | With Skill | How to Measure |
|----------------|---------------|------------|----------------|
| Tics cut from the artifact | Rewords around the frame | Frame, debate and absence gone (scenario 1) | Revised-text tic count below — expect **0** |
| Restatement removed | Rewords the comment | Deletes it (scenario 2) | Manual: does the revised file still carry the comment? |
| Clean prose untouched | Rewrites to show effort | Unchanged, no findings (scenario 3) | The original paragraph survives verbatim in the revised text — expect **1** |
| Informative contrast kept | Strips every "rather than" | Keeps the migration contrast (scenario 4) | `each service` survives in the revised text — expect **1** |
| No over-correction | Clips further | Complete sentences (scenario 5) | Article count in the revised text — expect **≥3**; a proxy, so confirm by reading |
| Inference marked | Keeps the claim as fact | Limits or marks it (scenario 6) | Inference-marker count in the revised text — expect **≥1** |
| Dated record left alone | Edits the entry | Leaves it and says why (scenario 7) | `startup rather than first request` survives — expect **1** |
| Pre-filter reported apart from read | One undifferentiated "reviewed" | `pre-filter: …; read: …` with files named (scenario 8) | Report-shape count below — expect **1** |

**Pass threshold:** the skill wins at least 6 of 8 scenarios, and scenarios 3, 4 and 7 must not
regress. Those three catch over-triggering: a pass that rewrites correct prose is worse than no
pass, because the reader loses text that was right.

**Why the survivors are measured by a phrase.** Scenarios 3 and 7 ask for no edit, and scenario 4
asks that the contrast survive. A rewrite that keeps the meaning in new words would pass a meaning
check and still fail all three. A phrase that only the original wording contains separates the two.

## Deterministic Checks

```bash
# Tics left in the artifact — expect 0 on scenario 1. Artifact checks read only the text after the
# marker, because the report above it may quote the tics it removed. "cache", "chose" and "versus"
# catch the reworded tics: the change never touches a cache, so any mention is the negative space
# ("The cache layer is unchanged."), and "chose"/"versus" is the debate recap. Other rewordings need
# the manual read.
awk '/^--- REVISED ---$/{r=1;next} r' output.md | grep -ciE -e "worth noting" -e "went back and forth" -e "doesn.t touch" -e "not just" -e "earns its place" -e "load-bearing" -e "cache" -e "chose" -e "versus"
# Scenario 3 — the clean paragraph survives verbatim; expect 1. Keyed on the whole original
# paragraph, so a one-word edit ("the error" to "its error") fails it.
awk '/^--- REVISED ---$/{r=1;next} r' output.md | grep -cF 'The importer retries a failed batch three times, then writes it to `dead-letter/` with the error attached. Run `pnpm replay` to resubmit everything there.'
# Scenario 4 — the migration contrast survives; expect 1.
awk '/^--- REVISED ---$/{r=1;next} r' output.md | grep -ciF "each service"
# Scenario 7 — the dated record survives; expect 1.
awk '/^--- REVISED ---$/{r=1;next} r' output.md | grep -cF "startup rather than first request"
# Complete sentences restored — expect at least 3 on scenario 5.
awk '/^--- REVISED ---$/{r=1;next} r' output.md | grep -oiwE -e "the" -e "a" -e "an" | wc -l
# Inference marked — expect at least 1 on scenario 6.
awk '/^--- REVISED ---$/{r=1;next} r' output.md | grep -ciE -e "inferred" -e "not (yet )?(been )?(verified|checked)" -e "locally" -e "local reproduction"
# Pre-filter reported apart from read — expect 1 on scenario 8. Joined into one line first, because the
# report usually puts the two steps on separate lines. Accepts the step's name, "pre-filter", and the
# older "sweep" label, as labels ("Pre-filter: … Read:") or in prose ("the pre-filter found … the read found").
tr '\n' ' ' < output.md | grep -ciE "(sweep|pre-filter):.*read:|(sweep|pre-filter) found.*read found"
```

## Saturation Signals

| Signal | Saturation Level |
|--------|-----------------|
| Baseline deletes a comment that restates its `it()` title unprompted | Partial — monitor |
| Baseline leaves clean prose and dated records unchanged | Partial — monitor |
| Baseline separates the pre-filter from the read in its report | Full — retire/convert |
| Baseline keeps complete sentences while cutting padding | Partial — monitor |
