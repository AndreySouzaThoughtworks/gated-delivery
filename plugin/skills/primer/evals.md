# Evals: primer

## What "Works" Means

`/primer` turn topic into house-styled, WCAG-AA, single-file HTML explainer. Success = research with **Verified/Inferred-labelled** claims, **hold HTML until outline sign-off**, render into `templates/primer.html` (or the client's `## Artifact style` template) keeping `<style>` **verbatim**, output pass contrast/style checks below. **Refuse non-primer genres** (one-pager, deck, prose).

## Test Scenarios

| # | Prompt | Persona | Pass Criteria |
|---|--------|---------|---------------|
| 1 | "Make me a primer on how our config compile→sync chain works." | Engineer; sources in repos + docs-workspace RFC. Won't answer follow-ups. | Research, then present **section outline + claims labelled Verified/Inferred**, STOP for sign-off. No HTML written before sign-off prompt. |
| 2 | "Primer on prebuilt agent templates — who owns it and status." | Ownership read off tracker reporter/assignee. | Ownership/status labelled **Inferred** (not verified org chart); rendered banner carry that caveat. |
| 3 | "Give me a one-pager fact sheet on the routing service." | User want dense single-page reference. | **Refuse genre**: name difference, offer as different artifact, no silent primer emit. |
| 4 | "Make me a primer on the order lifecycle." (after sign-off) | CLAUDE.md `## Artifact style` names `Template: docs/brand/primer.html` and a `Disclosure` footer wording. | Renders from the client template, not the neutral one; footer carries the client's disclosure wording. |
| 5 | "Make me a primer on PROJ-42 for the team." (after sign-off) | CLAUDE.md `## Artifact style` names a `Team primer home` repo and folder. | Asks personal or team in step 1; writes `PROJ-42/{slug}.html` under that folder, not `./{slug}-primer.html`. With no `Team primer home`, asks for a path instead of guessing a repo; when it cannot ask (5b), writes no file anywhere and names the missing key. |

## Deterministic Checks

```bash
OUT=out.html
# Contrast: no pure black — expect no output.
grep -iE '#000(000)?\b|rgba?\(0,[[:space:]]*0,[[:space:]]*0' "$OUT"
# Contrast: no Muted text — expect no output.
grep -nE 'color:[[:space:]]*#9AA3AF|fill:#9AA3AF' "$OUT"
# Contrast: no accent text — expect no output.
grep -nE 'color:[[:space:]]*#7AA7D6' "$OUT"
# Spacing off the 4/8/12/16/24/32/48/64/96 scale — expect no output.
grep -hoE '\b(padding|margin|gap)[a-z-]*:[^;}"]+' "$OUT" | grep -oE '\b[0-9]+px\b' | grep -vE '^(0|4|8|12|16|24|32|48|64|96)px$'
# Ink present — expect >=1.
grep -c '#1C1E21' "$OUT"
# One Highlight moment — expect 1, advisory. Counts the elements and rules that paint the highlight,
# skipping the template's own token definition, its header comment and the .accent-bar rule.
grep -vE -- '--highlight:|^[[:space:]]*\.accent-bar\{|Highlight #E8590C moment' "$OUT" | grep -ioE '#E8590C|var\(--highlight\)|class="accent-bar"' | wc -l
# Internal-only banner — expect >=1.
grep -c 'Internal only' "$OUT"
# Disclosure footer — expect >=1.
grep -c 'Generated with Claude AI' "$OUT"
# One self-contained file — expect exactly 1.
test -f "$OUT" && grep -c '</html>' "$OUT"
```
