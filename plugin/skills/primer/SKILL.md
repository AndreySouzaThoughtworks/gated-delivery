---
name: primer
description: Research a topic into a "primer": a single-file, WCAG-AA HTML explainer built from the docs, the tracker and the repos, every claim labelled Verified or Inferred, outline signed off first. Use when asked for a primer, a "mental model" doc, an explainer, an onboarding or briefing doc, or "help me understand X" as a shareable artifact. Not for fact sheets, decks or prose docs.
---
# /primer — Research a topic into a house-styled HTML explainer

**Primer = explainer you can also skim** — top-to-bottom teaching doc: numbered sections, key idea, diagrams, tables, glossary. NOT one-page fact sheet (dense, reference-only), NOT slide deck. User want those? Say so, stop.

**Hold artifact until outline signed off.** Research + section outline live in conversation. HTML file written to disk ONCE — after user signs off outline at step 4. No render 25KB then redo.

**Evidence discipline.** Label every factual claim by the Verified/Inferred rubric in `prose-writing/writing.md`. Mark inferred org roles, statuses and roadmap items explicitly in the doc, with a caveat in the banner.

**Frame from what you know, not what nearby.** Verified/Inferred rubric covers factual claims; NOT reader's *relationship* to material — that they own, wrote, work in, or responsible for repo/service/team. Never assert that relationship unless they told you. "Checked out in working directory" ≠ "theirs"; "team named in the tracker" ≠ "reader's team." Such relationship — or any context changing how section framed (reader's role, their goal, in-scope vs out-of-scope sources) — unclear and would change doc? **Ask before rendering**, don't guess. Cheap `AskUserQuestion` beats confident-wrong framing.

## Client style

Read these `## Artifact style` keys from the nearest CLAUDE.md; `docs/client-context.md` in this plugin holds their meaning and defaults: Template, Brand skill, Disclosure, Team primer home.

With a client template, its own header comment states its token rules; follow those instead of the neutral rules in step 5, and still keep a sensitivity banner and the disclosure footer.

## Inputs

- `topic` — what primer explains (e.g. "prebuilt agent templates", "the config compile→sync chain"). Missing or vague? **Ask inline as free text** — no `AskUserQuestion` for open input.
- `output-path` (optional) — where to write. An explicit path wins over **Output location**.

## Output location

Ask in step 1, with `AskUserQuestion`, whether the primer is **personal** or **for the team**. The answer sets where it is written and whether it is published.

- **Personal** — write `./{slug}-primer.html` in the current working directory. Nothing is committed.
- **Team** — write `{subject}/{slug}.html` under the `Team primer home` folder from `## Artifact style`, then publish it the way that key says after step 6.

`{subject}` is the ticket key the primer explains, written as the tracker writes it, or a 2–4 word lowercase hyphenated topic when no key applies. `{slug}` is 2–4 words, lowercase, hyphens, naming this primer's angle (`oauth2-capability`). Primers on one subject share its folder and link to each other by bare filename.

Resolve the checkout for a team primer the way `deskcheck` resolves the notes repository (its *Output location*, step 3):

1. The current repository, when it is the one `Team primer home` names.
2. Otherwise the local checkout at `GATED_DELIVERY_NOTES_REPO`, when that is the same repository.
3. Otherwise clone that repository with `gh` into a temporary directory.
4. When `Team primer home` is absent or the repository is unreachable, ask for a path before writing.

Pull before writing, and confirm the working tree is clean and on `main`.

## Process

### 1. Scope the question

Topic underspecified (ambiguous audience, unclear boundary)? Ask 1–2 clarifiers before researching. Primer on "templates" with no scope wastes research pass. Confirm: subject, audience (who reads this), what explicitly out of scope.

Ask whether the primer is personal or for the team (see **Output location**).

Also settle two things that silently distort research if guessed:

- **Reader's relationship to subject** — building it, testing it, reviewing someone else's, ramping up? Changes which framings true (see "Frame from what you know" above). Ask when not obvious and would change section framing.
- **Source surface** — which repos / docs spaces / tracker projects authoritative and in-scope, which to ignore. "Present on this machine" ≠ "in scope." Unsure whether repo or space belongs? Ask, don't sweep it in — swept-in irrelevant source is where dangling, mis-owned material comes from.

### 2. Research with citations

Fan out across sources that fit topic; no over-fetch. Typical sources:

- **Current repo's own docs, first** when topic names service you standing in: start from its
  instruction file (`CLAUDE.md`, `AGENTS.md`) and follow what it names — commonly a context index
  (`docs/CONTEXT.md`), a canonical entity model (`docs/internals/domain.md`), and specs
  (`docs/specs/*`). Do not assume those paths where the repo names others. Rest of
  this flow maintains those deliberately, so curated and in-scope by construction — opposite
  of broad sweep, which is where mis-owned and dangling material comes from. Start here,
  widen only for what they can't answer.
- **Knowledge base** — PRDs, specs, decks and meeting notes, through the knowledge-base search the client context names.
- **Tracker** — epics, status and ownership (reporter, assignee), through the tracker search the `## Issue tracking` Mechanics name. Roles read off the tracker are **Inferred**, not a verified org chart; label them so.
- **Repos** — code, schemas, seed data. Prefer sub-agent (`Explore` / `general-purpose`) for broad multi-repo sweeps so file dumps stay out of context; have it return conclusions + `file:line` citations.

Large tool outputs (>~25k tokens) get saved to file by harness — grep/slice that file or hand to sub-agent; no pulling all into context.

Track each claim with its evidence as you go. Need citations for outline checkpoint and footer.

### 3. Draft the section outline in conversation

Primer's spine, adapted to topic:

- **① Core idea** — the single sentence the rest depends on (goes in `.key` box). Lead with mental model, then why true, then reframe ("think of it as X, not Y").
- **Middle sections** — one idea each. Use component that fits: `.two`/`.three` cards for contrasts/phases, `ol.steps` for sequence, SVG `figure` for flow/lifecycle, `table` for comparisons or status. Watch **overload trap** — term means two things? Give it own section.
- **Ownership & status** (if relevant) — table of who owns what + tracker state, with inferred-roles caveat.
- **⑦ Glossary** — terms cold reader needs.

Present outline as: section list (with component each will use) + key claims under each + source for each claim (Verified/Inferred). Keep tight.

### 4. CHECKPOINT — sign off the outline

Show outline. Ask: _"Is this the right shape and are these the right claims to render?"_ Revise until user signs off. **Do not write HTML before this.**

This is gate before *first* render — but scope not set-once. Topic narrows or shifts after sign-off (user refocuses, cuts branch, sharpens audience)? **Re-open outline and prune to new scope before touching file again.** Every section must serve the *current* question, not the one you started with. Section that made sense under original framing but no longer serves narrowed one is dangling — cut it, don't carry forward because already written. State plainly what you dropping and why. When re-scoping, also re-check surviving sections don't assert reader relationships or ownership narrowed framing no longer supports.

### 5. Render into the template

Copy the template (`Template` from `## Artifact style`, else `templates/primer.html`) to output path, fill it. Rules baked into template — **do not regress**. The contrast rules, the spacing scale, and the banner and footer are grep-checked in `evals.md`. The radii, the SVG palette and the `<style>` block itself are checked by nothing, and hold only for as long as you keep `<style>` verbatim:

- Keep `<style>` block **verbatim**. Encodes the house style at WCAG-AA.
- **Text** is Ink `#1C1E21` or Ink 2 `#5A6270`. Never pure black; never Muted (`#9AA3AF`) for text — fails AA.
- **Accent** `#7AA7D6` is **non-text only** — borders, SVG strokes, arrowheads, key-box left rule. Never accent body/link text.
- Exactly **one Highlight** `#E8590C` moment — header accent bar. No second.
- Spacing on **4/8/12/16/24/32/48/64/96** scale. Card/container radius 8px; chips 4px (no full pills).
- Keep the **internal-only banner** and the **disclosure footer** (`Disclosure`).
- SVG diagrams: box titles `#1C1E21`, secondary text `#5A6270`, fills white / Subtle / Accent soft, strokes Accent.

Brand questions beyond what template covers (surface template doesn't have)? Consult the `Brand skill` from `## Artifact style` when one is named — it owns tokens; template is its applied form. None named → stay inside the template's tokens.

### 6. Verify

Run the `## Deterministic Checks` in `evals.md` against the output file, then compare each result with the expectation stated beside it: the contrast group must print nothing at all, the presence group must match its stated count. The runner reports counts, not verdicts — a forbidden match still exits `0`, so nothing fails on your behalf and reading the output is the check. Fix any mismatch before reporting done; the single Highlight moment is advisory. With a client template, check against its token rules instead of the hex values in `evals.md`.

### 7. Report

For a team primer, commit it with a `docs({subject}): …` subject and publish it as `Team primer home` says. Tell user the path, and the commit for a team primer. Suggest opening it (`open {path}`). Note any claim that stayed **Inferred** so they know what to verify before sharing externally.

## Boundaries

- Never distribute a primer externally; it carries an internal-only banner, and external sharing is the user's explicit call.
- Restyle through the client's `Brand skill` or `Template`, never by editing the `<style>` tokens by hand.

## Related skills

- The `Brand skill` named in `## Artifact style` — owns the client's brand tokens; a client template is its WCAG-AA applied form.
- Architecture skills listed under `## Domain references` — frequent *source* for architecture primers (provide findings; `/primer` renders them).
- `templates/primer.html` — canonical neutral skeleton this skill fills when no client template is named.

## Verification

The contrast, style and structure checks live in `evals.md` under `## Deterministic Checks`; step 6 runs them.
