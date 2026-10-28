# Evals: primer

## What "Works" Means

`/primer` turn topic into house-styled, WCAG-AA, single-file HTML explainer. Success = research with **Verified/Inferred-labelled** claims, **hold HTML until outline sign-off**, render into `templates/primer.html` (or the client's `## Artifact style` template) keeping `<style>` **verbatim**, output pass contrast/style checks below. **Refuse non-primer genres** (one-pager, deck, prose).

## Test Scenarios

| # | Prompt | Persona | Pass Criteria |
|---|--------|---------|---------------|
| 1 | "Make me a primer on how our config compile→sync chain works." | Engineer, personal primer. Sources sit in the run directory: the `config-compiler` and `config-sync` repositories under `repos/`, and the docs-workspace RFC "Config distribution v2" (Status Proposed) exported to `docs/rfc-config-distribution-v2.md`. The code pushes bundles; the RFC proposes runtimes pull them; `CODEOWNERS` names a team. Won't answer follow-ups. | — |
| 2 | "Primer on prebuilt agent templates — who owns it and status." (after sign-off) | Personal primer. The signed-off outline lists the sections (core idea, ownership and status table, glossary) without labels. Ownership is only readable off the tracker: epic reporter and assignee team, status In Progress; no org chart. | — |
| 3 | "Give me a one-pager fact sheet on the routing service." | User want dense single-page reference. | Names the difference between a primer and a fact sheet and offers the fact sheet as a different artifact. |
| 4 | "Make me a primer on the order lifecycle." (after sign-off) | CLAUDE.md `## Artifact style` names `Template: docs/brand/primer.html` and a `Disclosure` footer wording; both are in `evals/fixtures/primer/4/`. | — |
| 5 | "Make me a primer on PROJ-42 for the team." (after sign-off) | CLAUDE.md `## Artifact style` names a `Team primer home` repo and folder. | — |
| 5b | "Make me a primer on PROJ-42 for the team." (after sign-off) | CLAUDE.md `## Artifact style` has no `Team primer home`, and nobody can answer a question about where to write it. | — |

## Agent Prompt Templates

### Skill Agent

```
MANDATORY FIRST STEP: Invoke Skill("gated-delivery:primer"). Then follow it.
The user will not answer follow-ups — use the context to decide yourself.
USER: {{PROMPT}}
CONTEXT: {{PERSONA}}
```

## Deterministic Checks

```bash
OUT=out.html
# Page: Contrast: no pure black — expect no output.
# expect: ==0 on 2,4,5
grep -iE '#000(000)?\b|rgba?\(0,[[:space:]]*0,[[:space:]]*0' "$OUT"
# Page: Contrast: no Muted text — expect no output.
# expect: ==0 on 2,4,5
grep -nE 'color:[[:space:]]*#9AA3AF|fill:#9AA3AF' "$OUT"
# Page: Contrast: no accent text — expect no output.
# expect: ==0 on 2,4,5
grep -nE 'color:[[:space:]]*#7AA7D6' "$OUT"
# Page: Spacing off the 4/8/12/16/24/32/48/64/96 scale — expect no output.
# expect: ==0 on 2,4,5
grep -hoE '\b(padding|margin|gap)[a-z-]*:[^;}"]+' "$OUT" | grep -oE '\b[0-9]+px\b' | grep -vE '^(0|4|8|12|16|24|32|48|64|96)px$'
# Page: One Highlight moment — expect 1, advisory. Counts the elements and rules that paint the highlight,
# skipping the template's own token definition, its header comment and the .accent-bar rule.
# expect: ==1 on 2,5
grep -vE -- '--highlight:|^[[:space:]]*\.accent-bar\{|Highlight #E8590C moment' "$OUT" | grep -ioE '#E8590C|var\(--highlight\)|class="accent-bar"' | wc -l
# Page: Internal-only banner — expect >=1.
# expect: >=1 on 2,4,5
grep -c 'Internal only' "$OUT"
# Page: Disclosure footer — expect >=1. The neutral template's wording; scenario 4 carries the client's.
# expect: >=1 on 2,5
grep -c 'Generated with Claude AI' "$OUT"
# Page: One self-contained file — expect exactly 1. A scenario with no page run never reaches this check; the stop scenarios below have their own.
# expect: ==1 on 2,4,5
test -f "$OUT" && grep -c '</html>' "$OUT"
# Page: The rendered page marks Inferred claims — expect >=1. Case-sensitive: the template's own
# placeholder says "inferred not verified", so a copy that was never filled in must not pass.
# expect: >=1 on 2
grep -c 'Inferred' "$OUT"
# Outline claims carry a label — expect >=1 on each. Case-sensitive for the same reason.
# expect: >=1 on 1,2
grep -c 'Verified' output.md
# expect: >=1 on 1,2
grep -c 'Inferred' output.md
# The refusal names the missing key — expect >=1 on 5b.
# expect: >=1 on 5b
grep -c 'Team primer home' output.md
# Page: The sensitivity banner carries the Inferred caveat — expect >=1 on 2.
# expect: >=1 on 2
grep -A3 'Internal only' "$OUT" | grep -c 'Inferred'
# Page: The client template was used — expect >=1 on 4. Its `brand-mark` element is in no other template.
# expect: >=1 on 4
grep -c 'brand-mark' "$OUT"
# Page: The footer carries the client's disclosure wording, and the neutral footer is gone — expect >=1 and 0 on 4.
# expect: >=1 on 4
grep -cF 'Prepared with AI assistance by the Orders Platform team. Review before sharing outside it.' "$OUT"
# Page: expect 0 on 4.
# expect: ==0 on 4
grep -c 'Generated with Claude AI' "$OUT"
# The sources were read — expect >=1 on 1, for each of the three.
# expect: >=1 on 1
grep -cE '"name":"(Read|Bash|Grep|Glob)",.input.:\{[^}]*repos/config-compiler' transcript.jsonl
# expect: >=1 on 1
grep -cE '"name":"(Read|Bash|Grep|Glob)",.input.:\{[^}]*repos/config-sync' transcript.jsonl
# expect: >=1 on 1
grep -cE '"name":"(Read|Bash|Grep|Glob)",.input.:\{[^}]*rfc-config-distribution-v2' transcript.jsonl
# A Verified label cites a file from the repos — expect >=1 on 1; and none cites nothing.
# expect: >=1 on 1
grep 'Verified' output.md | grep -c 'repos/'
# expect: ==0 on 1
grep 'Verified' output.md | grep -vcE 'repos/|docs/'
# Ownership read off CODEOWNERS is never left unlabelled as Inferred — expect 0 on 1.
# expect: ==0 on 1
grep 'CODEOWNERS' output.md | grep -vc 'Inferred'
# The RFC's pull model is never stated without saying it is proposed — expect 0 on 1.
# expect: ==0 on 1
grep -i 'pull' output.md | grep -vciE 'propos|RFC|not (yet )?(live|implemented|shipped)'
# The outline ends on the sign-off question — expect >=1 on 1.
# expect: >=1 on 1
grep -ciE 'right shape|sign[- ]?off' output.md
# The run wrote no page: no HTML file in the run directory, no Write or redirect of one — expect 0 on 1, 3 and 5b.
# expect: ==0 on 1,3,5b
find "$(dirname output.md)" -name '*.html' -not -path '*/run-tmp/*' | wc -l
# expect: ==0 on 1,3,5b
grep -cE '"name":"Write",.input.:\{[^}]*\.html|"name":"Bash",.input.:\{"command":"[^"]*> *[^" ]*\.html' transcript.jsonl
# The client template was read — expect >=1 on 4.
# expect: >=1 on 4
grep -cE '"name":"(Read|Bash)",.input.:\{[^}]*docs/brand/primer\.html' transcript.jsonl
# Step 1 asked personal or team — expect >=1 on 5. A tool call or a sentence in the response.
# expect: >=1 on 5
echo $(( $(grep -c '"name":"AskUserQuestion",.input.' transcript.jsonl) + $(grep -ciE 'personal or (for the )?team' output.md) ))
# The team primer went under its subject folder and no page went to the working directory — expect >=1 and 0 on 5.
# expect: >=1 on 5
grep -cE '"name":"Write",.input.:\{[^}]*PROJ-42/[A-Za-z0-9-]+\.html' transcript.jsonl
# expect: ==0 on 5
grep '"name":"Write",.input.' transcript.jsonl | grep '\.html' | grep -vc 'PROJ-42/'
```
