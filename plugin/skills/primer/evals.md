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
| 5 | "Make me a primer on PROJ-42 for the team." (after sign-off) | CLAUDE.md `## Artifact style` names a `Team primer home` repo and folder. | Asks personal or team in step 1; writes `PROJ-42/{slug}.html` under that folder, not `./{slug}-primer.html`. With no `Team primer home`, asks for a path instead of guessing a repo. |

## Deterministic Checks

```bash
OUT=out.html
# Contrast discipline — all must be empty
grep -iE '#000(000)?\b|rgba?\(0,[[:space:]]*0,[[:space:]]*0' "$OUT"   # no pure black
grep -nE 'color:\s*#9AA3AF|fill:#9AA3AF' "$OUT"                       # no Muted text
grep -nE 'color:\s*#7AA7D6' "$OUT"                                    # no accent text
grep -hoE '\b(padding|margin|gap)[a-z-]*:[^;}"]+' "$OUT" | grep -oE '\b[0-9]+px\b' | grep -vE '^(0|4|8|12|16|24|32|48|64|96)px$'
# Presence — exact / non-empty
grep -c '#1C1E21' "$OUT"                    # Ink ≥1
grep -ic '#E8590C' "$OUT"                   # one Highlight moment = 1 — advisory, not blocking
grep -c 'Internal only' "$OUT"              # banner ≥1
grep -c 'Generated with Claude AI' "$OUT"   # footer ≥1
# Renders as one self-contained file — the whole point of the artifact.
test -f "$OUT" && grep -c '</html>' "$OUT"  # exactly 1
```
