# Evals: senior-review-lens

## What "Works" Means

`senior-review-lens` = **structural self-audit** (encoded_preference): given diff (Lenses A–G)
or ADR/design doc (Lens H), run relevant lenses, auto-apply mechanical fixes, surface
judgment calls — end in `READY-TO-COMMIT | REVISE-FIRST` verdict. Success = catch
**structural / cohesion** design issues correctness-only reviewer miss (where helper belong,
table-vs-inline, test-pyramid placement, dead type variants, compiler-enforced over
hand-discipline, framing depth) **without** drift into correctness review (that `code-reviewer`
job) or invent findings on clean code.

> Scenario 4 is the clean-diff guard. Scenarios 6 (Lens D, test realism) and 8 (Lens E, test
> descriptions) are the lens findings a no-skill baseline missed on behaviour, not just on vocabulary.
> The earlier lens-catch scenarios were retired because a no-skill baseline finds the same issues (see
> Saturation Signals). Lenses A, B, C, F, G and H have no eval scenario.

> No integration dependency: scenarios embed diff/doc in persona, so audit judged from
> response. Lens exercised named in persona, not prompt.

## Execution Model

mode: response

## Test Scenarios

| # | Prompt | Persona | Pass Criteria |
|---|--------|---------|---------------|
| 4 | "Ready?" | Diff = clean, well-placed bug fix with focused unit test at right layer; nothing structural off. The diff compiles as shown: the new spec file imports the helper it tests. | — |
| 6 | "Is this ready to push?" | Diff adds a target locale to the translate request. The DTO regex accepts a two-letter language with an optional region, in any case, joined by `-` or `_`; `toEngineLanguage` keeps the first two letters, lowercased; the new DTO spec accepts seven variants. The full diff is the fixture. | Says the DTO spec's accepted region variants differ only in a region `toEngineLanguage` discards, so they test the validator, not the service. Does not call those accepted cases good coverage. |
| 8 | "Good to merge?" | Diff adds a Nest exception filter that answers `EngineError` as a problem details body, and a unit spec for it. Two spec titles cite an RFC number and an internal error-code constant, and one spec comment cites an RFC section. The full diff is the fixture. | Proposes rewording each flagged title as the behaviour a reader can see, such as "answers an engine timeout with a 504 problem details body". |

## Agent Prompt Templates

### Baseline Agent (no skill)
```
You are a Claude Code assistant with NO skills loaded. Do NOT invoke any Skill tool.
The user will not answer follow-ups — use the context to decide yourself.
USER: {{PROMPT}}
CONTEXT: {{PERSONA}}
```

### Skill Agent
```
MANDATORY FIRST STEP: Invoke Skill("gated-delivery:senior-review-lens"). Then follow it.
The user will not answer follow-ups — use the context to decide yourself.
USER: {{PROMPT}}
CONTEXT: {{PERSONA}}
```

## A/B: Skill vs No-Skill

| Quality Signal | Without Skill | With Skill | How to Measure |
|----------------|---------------|------------|----------------|
| Explicit verdict | Ends with vague "looks fine" | Emits `READY-TO-COMMIT` or `REVISE-FIRST` | `grep -cE -e '^READY-TO-COMMIT$' -e '^REVISE-FIRST$' output` — anchored to token alone on own line, so template placeholder does not count. Two `-e` patterns not one alternation: `\|` escaped for markdown table reaches regex as literal pipe, matches nothing. |
| Stays in lane (no false finds) | May invent structure/style nits on clean code | Returns READY-TO-COMMIT on clean diff (scenario 4) | Finding-row, applied/surfaced-bullet and no-edit checks below |
| Test realism (scenario 6) | Adds a downstream test but calls the DTO's accepted-variants table good coverage | Names the region variants the mapper discards, trims them, asserts them downstream | Region, mapper, trim and downstream-variant checks below; the judge reads the praise and reason clauses |
| Test titles (scenario 8) | Leaves RFC and error-code titles, or renames them to other constants | Rewrites each title as visible behaviour | Four-citation check below; the judge reads the rewording clause |

**Pass threshold:** scenarios 4, 6 and 8 pass on every run. Each must not regress.

## Deterministic Checks

```bash
# Invented finding on the clean diff — a lens-table row reporting one or more findings, such as
# "| A. Cohesion | 1 finding |". Rows reporting CLEAN or N/A do not count, and neither does prose that
# mentions a lens ("Lens A and B: nothing structural"). Expect 0 on 4.
# expect: ==0 on 4
grep -icE '^\| *\**[a-h]\. [^|]+\| *\**[1-9][0-9]* findings?' output.md
# The planted finding sits in the lens the scenario exercises: Lens D (test realism) on 6. A finding
# under another lens, or "Lens D: clean", scores 0.
# expect: >=1 on 6
grep -icE '^\| *\**D\. [^|]+\| *\**[1-9][0-9]* findings?' output.md
# Lens E (test descriptions) on 8, counted the same way.
# expect: >=1 on 8
grep -icE '^\| *\**E\. [^|]+\| *\**[1-9][0-9]* findings?' output.md
# A verdict was emitted — expect 1 on 4, 6 and 8
# expect: ==1 on 4,6,8
grep -cE -e '^READY-TO-COMMIT$' -e '^REVISE-FIRST$' output.md   # verdict token, alone on its line
# The verdict asks for a revision — expect 0 on the clean diff 4, 1 on 6 and 8
# expect: ==0 on 4
# expect: ==1 on 6,8
grep -cE '^REVISE-FIRST$' output.md
# Clean diff has nothing to apply or surface — no bullet under "Auto-applied" or "Surfaced for
# judgment" that is not a none/nothing/n-a line. A style or naming nit lands in one of them. Scenario 4.
# expect: ==0 on 4
awk '/^### (Auto-applied|Surfaced for judgment)/{f=1;next} /^#/{f=0} f && /^[-*] /{print}' output.md | grep -viEc "none|nothing|n/a"
# Clean diff is never edited — no Edit, Write or NotebookEdit call. Scenario 4.
# expect: ==0 on 4
grep -cE '"tool_use","id":"[^"]*","name":"(Edit|Write|NotebookEdit)"' transcript.jsonl
# Scenario 6 names at least two of the region variants that collapse — de-DE, de-AT, de-CH.
# expect: >=2 on 6
grep -oE "de-(DE|AT|CH)" output.md | sort -u | wc -l | tr -d ' '
# Scenario 6 names the mapper that discards the region.
# expect: >=1 on 6
grep -c "toEngineLanguage" output.md
# Scenario 6 proposes dropping or trimming the accepted cases.
# expect: >=1 on 6
grep -icE "\b(trim|drop|remove|cut|reduce|collapse|replace)\b" output.md
# Scenario 6 says the variants each become `de`: a line with a region variant and a bare `de`.
# expect: >=1 on 6
grep -cE "de-(DE|AT|CH)[^.]*[^A-Za-z-]de([^A-Za-z-]|$)" output.md
# Scenario 6's downstream test uses a region variant — a line about toEngineLanguage, the service or
# downstream that carries de-AT, de-CH or de-DE.
# expect: >=1 on 6
grep -iE "toEngineLanguage|service|downstream" output.md | grep -cE "de-(AT|CH|DE)"
# Scenario 8 flags all four citations: RFC 7807, RFC 9110, ENGINE_TIMEOUT and ERR_UPSTREAM_4XX.
# expect: >=4 on 8
grep -oE "RFC 7807|RFC 9110|ENGINE_TIMEOUT|ERR_UPSTREAM_4XX" output.md | sort -u | wc -l | tr -d ' '
```

## Saturation Signals

| Signal | Saturation Level |
|--------|-----------------|
| Baseline raises one structural/cohesion issue unprompted | Full — format-only: baseline finds the same issue, lacks lens vocabulary (n=2, 2026-10-19). Retired scenarios 1 (Lens A, helper in controller), 2 (Lens B, enum branch chain), 3 (Lens C/D, rule tested only in e2e) |
| Baseline reframes an X-vs-Y ADR around the collapsing constraint unprompted | Full — format-only: baseline finds the same issue, lacks lens vocabulary (n=2, 2026-10-19). Retired scenario 5; Lens H has no eval scenario |
| Baseline reproduces A–H lens taxonomy + verdict format without skill | Full — retire/convert |
| Baseline correctly declines to flag clean diff (scenario 4) unprompted | Partial — monitor |
| Baseline trims validator-permissivity fixtures the downstream mapper discards (scenario 6) | None — discriminating: baselines add a downstream test but keep or praise the accepted-variants table, 4 of 4 (2026-10-19) |
| Baseline rewrites RFC or error-constant test titles as behaviour (scenario 8) | None — discriminating: baselines keep the titles or rename them to other constants, 2 of 2 (2026-10-19) |
| Baseline drops a union member no adapter emits | Full — candidate 7 dropped: both baselines dropped `rate_limited` unprompted (n=2, 2026-10-19) |
| Baseline asks whether a cache is needed at all, from the ADR's own numbers | Full — candidate 9 dropped: both baselines added a no-cache option (n=2, 2026-10-19); Lens H stays without a scenario |
