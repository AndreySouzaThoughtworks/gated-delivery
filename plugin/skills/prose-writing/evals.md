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
   artifact. No scenario measures this: the baseline does it unprompted (see Saturation Signals).

> No integration dependency: each persona carries the draft and the surrounding facts, so the pass
> is judged from the response alone.

## Execution Model

mode: response

## Test Scenarios

| # | Prompt | Persona | Pass Criteria |
|---|--------|---------|---------------|
| 1 | "Write up the commit body from my draft." | Draft: "Worth noting this follows the retry change — we went back and forth on per-call versus per-batch limits and landed on per-batch. Doesn't touch the cache layer." The change caps retries per batch at three, so one failing row cannot use up the retries of the rows beside it. | — |
| 3 | "Tighten this README paragraph." | "The importer retries a failed batch three times, then writes it to `dead-letter/` with the error attached. Run `pnpm replay` to resubmit everything there." | — |
| 4 | "Clean up this migration note." | "Token validation moves into the gateway rather than each service, so a revoked token is refused before it reaches any handler." Each service validated tokens until this release. | — |
| 5 | "Make this doc section concise." | Draft is already note form: "Cache warm on boot. Fallback DB if miss. TTL 60s, config." | — |
| 7 | "Fix the tone of the 0.3.0 changelog entry." | Entry from a released version: "Moved config parsing to startup rather than first request." | — |

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
| Clean prose untouched | Rewrites to show effort | Unchanged, no findings (scenario 3) | The original paragraph survives verbatim in the revised text — expect **1** |
| Informative contrast kept | Strips every "rather than" | Keeps the migration contrast (scenario 4) | `each service` survives in the revised text — expect **1** |
| No over-correction | Clips further | Complete sentences (scenario 5) | Article count in the revised text — expect **≥3**; a proxy, so confirm by reading |
| Dated record left alone | Edits the entry | Leaves it and says why (scenario 7) | `startup rather than first request` survives — expect **1** |

**Pass threshold:** the skill wins at least 4 of the 5 scenarios, and scenarios 3, 4 and 7 must not
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
# the manual read. Alone this passes an empty artifact, so the next check requires the content.
# expect: ==0 on 1
awk '/^--- REVISED ---$/{r=1;next} r' output.md | grep -ciE -e "worth noting" -e "went back and forth" -e "doesn.t touch" -e "not just" -e "cache" -e "chose" -e "versus"
# The revised body carries the cap and its reason — expect 1 on scenario 1: "three", "per batch" and a
# reason word all appear after the marker. A missing marker or an empty artifact scores 0.
# expect: ==1 on 1
awk '/^--- REVISED ---$/{r=1;next} r' output.md | awk '{l=tolower($0)} l ~ /three/ {a=1} l ~ /per.batch/ {b=1} l ~ /because|cannot|can.t|otherwise|neighbou?r|beside|other rows/ {c=1} END {print (a && b && c) ? 1 : 0}'
# Scenario 3 — the clean paragraph survives verbatim; expect 1. Keyed on the whole original
# paragraph, so a one-word edit ("the error" to "its error") fails it.
# expect: ==1 on 3
awk '/^--- REVISED ---$/{r=1;next} r' output.md | grep -cF 'The importer retries a failed batch three times, then writes it to `dead-letter/` with the error attached. Run `pnpm replay` to resubmit everything there.'
# Scenario 4 — the migration contrast survives; expect 1.
# expect: ==1 on 4
awk '/^--- REVISED ---$/{r=1;next} r' output.md | grep -ciF "each service"
# Scenario 7 — the dated record survives; expect 1.
# expect: ==1 on 7
awk '/^--- REVISED ---$/{r=1;next} r' output.md | grep -cF "startup rather than first request"
# Complete sentences restored — expect at least 3 on scenario 5: sentences of the revised text that hold a finite verb.
# The draft has none, and stacking articles onto fragments adds none.
# expect: >=3 on 5
awk '/^--- REVISED ---$/{r=1;next} r' output.md | tr '.' '\n' | grep -ciwE "is|are|was|loads?|warms?|falls?|reads?|uses?|comes?|expires?|starts?|serves?|holds?|stays?|set|queries|defaults?"
# The report says there are no findings — expect >=1 on scenario 3. Reads only the text before the marker.
# expect: >=1 on 3
awk '/^--- REVISED ---$/ {exit} {print}' output.md | grep -ciE "no findings|nothing to (change|fix|tighten)|no changes|unchanged|already"
# No finding is listed — expect 0 on scenario 3: no line before the marker opens with a finding, issue or change label.
# expect: ==0 on 3
awk '/^--- REVISED ---$/ {exit} {print}' output.md | grep -ciE "^[-*0-9.) ]*\**(finding|issue|change)s? ?[0-9]*\**[ ]*[:—-]"
# The report says why the record is left alone — expect >=1 on scenario 7. Reads only the text before the marker.
# expect: >=1 on 7
awk '/^--- REVISED ---$/ {exit} {print}' output.md | grep -ciE 'because|since|released|historical|dated record|as written|shipped'
```

## Saturation Signals

| Signal | Saturation Level |
|--------|-----------------|
| Baseline deletes a comment that restates its `it()` title unprompted | Full — scenario 2 retired 2026-10-19: no-skill baseline passed n=2 ("I'd delete the comment. It says exactly what the test name … already says") |
| Baseline limits an unverified production claim to the local reproduction unprompted | Full — scenario 6 retired 2026-10-19: no-skill baseline passed n=2 ("It hasn't been verified in production yet") |
| Baseline leaves clean prose and dated records unchanged | Partial — monitor |
| Baseline separates the pre-filter from the read in its report | Full — scenario 8 retired 2026-10-28 |
| Baseline keeps complete sentences while cutting padding | Partial — monitor |
