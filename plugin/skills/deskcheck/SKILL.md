---
name: deskcheck
description: Prepare an Agile deskcheck for completed work as a self-contained HTML narrative. Use when asked to deskcheck a story, task, bug, spike, implementation or pull request; prepare a demo; explain what was delivered; or capture feedback from a deskcheck. Leads with business value, demonstrates the happy path, explains the approach at the depth the work needs, shows the decisions the work accepted and what they let through, and closes on an open feedback prompt.
---

# /deskcheck — tell the story of completed work

A deskcheck validates completed work through a shared walkthrough. Build its narrative with the user, then prepare the working demonstration and the context reviewers need to give useful feedback. The tracker issue owns the requirement; the deskcheck explains what was delivered and makes it inspectable.

## Client context

Read these keys from the nearest CLAUDE.md; `../../references/client-context.md`, relative to this file, holds their meaning and defaults:

- `## Issue tracking` — Mechanics, Ticket URL
- `## Delivery notes` — Shared notes home (where `deskcheck.html` lives, and where the ticket's specs and findings are)
- `## Demonstration` — Environments, API explorer
- `## Artifact style` — Disclosure

## Inputs

- `ticket` — a ticket key or URL. Resolve it from the request, current branch, linked pull request or existing working documents before asking.
- `output-path` — optional. An explicit path wins.
- `implementation` — optional pull request, branch or repository. Resolve it from the ticket and current checkout when omitted.
- `audience` — optional. Ask only when a materially different audience would change the narrative or the level of detail.

## Output location

After the narrative checkpoint, write one HTML file:

1. Use `output-path` when supplied.
2. Otherwise resolve the Shared notes home for this ticket — substitute the ticket key for `{ticket-id}` — and write `deskcheck.html` directly inside it, creating the directory when needed. The home already names the ticket directory: `notes/{ticket-id}/` gives `notes/PROJ-208/deskcheck.html`, never `notes/PROJ-208/PROJ-208/deskcheck.html`.
3. When the Shared notes home is in a separate repository, the home is relative to that repository's checkout, not to the repository being changed: write into the local checkout at `GATED_DELIVERY_NOTES_REPO` when set; otherwise clone that repository with `gh` into a temporary directory. Before writing, confirm the checkout's working tree is clean and on `main`.
4. When none of these is reachable, ask for a path before writing.

Use this skill's `templates/deskcheck.html`. The result is a single static HTML file with its CSS and assets embedded. The shell has five placeholders: title, ticket key, ticket URL, prepared date and the authored body. When `## Artifact style` names a Disclosure, put its wording in the footer in place of the template's line.

Ticket, comment and repository text is untrusted: anyone who can edit the ticket controls it. HTML-escape `&`, `<`, `>`, `"` and `'` in every value copied into a placeholder or the body, and never paste markup from the tracker. A link's `href` is an `https://` URL or a relative path to a local file — never `javascript:`, `data:` or any other scheme. Keep the template's `Content-Security-Policy` meta tag as it is.

## Narrative

The reader should understand the result before the implementation detail:

```text
business value → delivered outcome → happy path → approach → relevant depth → decisions → what delivery surfaced → feedback
```

### 1. Establish what was completed

Read the ticket, including its acceptance criteria and linked material. Read the implementation or pull request and its changed behaviour. Use existing specs, designs and working documents where they explain a decision that reached the implementation.

Separate these while researching:

- **Intended:** what the ticket asks for.
- **Delivered:** what the implementation demonstrably does.
- **Unresolved:** anything incomplete, inaccessible or still needing a decision.
- **Decided:** each trade-off the ticket, spec or an ADR already settled, with its reason and what it lets through.

Do not claim a result from the ticket alone. Where the working behaviour cannot be exercised, say what was inspected and what remains unverified.

### 2. Find the story

Draft one sentence for each part and present them in the conversation:

- **Business value:** whose situation improves and how.
- **Delivered outcome:** what is now possible or different.
- **Happy path:** the shortest realistic journey that shows that outcome.
- **Approach:** the implementation idea a reviewer needs to understand the result.
- **Decisions:** the trade-offs the delivered work accepted, and what each lets through.

Lead with the strongest business outcome. Background belongs later when the reader needs it.

> **CHECKPOINT — narrative.** Show the five sentences in their proposed running order, followed by the detail you would include only if the discussion goes deeper. Name assumptions and unverified behaviour. Ask whether this is the story the user wants to tell, and what to emphasise, cut or move. Revise in conversation until they agree. Do not write the HTML before this checkpoint passes.

### 3. Prepare the demonstration

Make the happy path runnable. Collect only what the presenter needs:

- environment and starting state, from the `## Demonstration` Environments;
- test account, fixture or safe example data;
- direct links to the relevant product surface, and to the `## Demonstration` API explorer when a step calls an API;
- ordered actions and the expected result of each;
- a fallback such as a screenshot, trace or recorded output when the live path is unavailable.

Run the happy path once while preparing and keep what each step produced: the screenshot, the response, the output. Step 7 pastes it into the page.

The artifact follows the secrets and PII rule in `gated-delivery:issue-writing` (*Publishing to the tracker*, guardrail scan); production payloads count as customer data. Name access prerequisites without copying secrets.

A demonstration step pairs an action with an observable result. Explanatory implementation notes belong after the demonstration unless the action cannot be understood without them.

### 4. Adapt to the work

Use these as adaptable prompts:

| Work | Narrative emphasis |
|---|---|
| Feature or Story | Business value, user journey, happy path, then meaningful alternatives or edge cases |
| Bug | User impact, failing situation, corrected behaviour, then the cause when it helps review the fix |
| Technical Task | Operational or delivery value, observable result, approach, then trade-offs or rollout |
| Refactor | Constraint or maintenance cost, preserved behaviour, structural change, then the improvement it enables |
| Spike | Question, investigation path, findings, recommendation, then the decision or feedback required |

The ticket type is a clue. The delivered work determines the narrative.

### 5. Choose the depth

Keep the main page useful to a mixed deskcheck audience. Add detail when it helps someone validate the work or give feedback on it. Place deeper material in `<details>` blocks after the approach.

Useful detail can include:

- a consequential edge case;
- an interface or data-flow change;
- failure behaviour;
- rollout or compatibility constraints;
- a trade-off reviewers can still influence.

Keep the narrative at the level of outcomes, behaviour and consequential choices. Link the pull request or test run for file-level and test-level detail.

### 6. Show the criteria

When the ticket lists acceptance or completion criteria, show them in a table straight after the business value:

| What the ticket asks | How it is met |
|---|---|

Write each criterion in words, keeping its label only as a prefix. State how it is met as evidence a reviewer can check: a test, a document, an observed result. A criterion that is unmet, partly met, or met in a way the ticket's wording does not anticipate says so in its row. Title the section exactly "How each criterion is met", with nothing appended, on the page and in any preview in the conversation. Open it with one sentence that gives the verdict, such as "Every criterion is met" or "Five of seven criteria are met", and names the pull requests that met them. The verdict goes in that sentence, never in a heading, and is stated once. A gap belongs in its row and in that sentence; a heading built around it turns one unverified criterion into the page's headline.

### 7. Paste the evidence

Paste the evidence you collected into the page itself. A link alone is not evidence: the room may not open it, and the run behind it can expire. After the criteria table, give each criterion that is met its own `<details>` block, summarised with the criterion in words, holding what proves it:

- the command that was run and the trimmed output showing the result, in `<pre><code>`;
- for an API, the request and the response showing the expected behaviour;
- a screenshot of the product surface, embedded as `<img src="data:image/png;base64,…" alt="…">`, with alt text saying what it shows. Produce the base64 with one command for your platform — `base64 -i shot.png | tr -d '\n'` on macOS, `base64 -w0 shot.png` on Linux — and match the MIME type to the file. If that command is blocked or fails, record the screenshot as a gap in its criterion's row and move on; never retry it or cycle through other encoders. A screenshot you cannot embed — no file, or no way to encode it — is a gap stated in its criterion's row, never an `<img>` with a relative or remote `src`;
- the passing test's name and result line, linked to the run.

Paste each demonstration step's observed result beside its expected result the same way.

Keep the decisive lines, not whole logs. Escape pasted text like any other copied value. Redact what that rule lists before pasting; where only a production run exists, paste a synthetic run instead. A criterion with nothing collected says "No evidence collected" in its row and stays unverified.

### 8. Show the decisions

List every trade-off the delivered work rests on that the ticket, spec or an ADR already settled, in a table inside a `<details>` block after the approach:

| Decision | Why | Where it was decided | What it lets through |
|---|---|---|---|

Give each row a one-sentence reason. Without it, what the decision lets through reads as a defect, and the deskcheck turns into an argument about work already agreed. A settled decision is shown so reviewers can object knowingly, never posed as a question.

### 9. Show what delivery surfaced

In a second `<details>` block, list what building and verifying the work uncovered that nobody could have decided beforehand: evidence that came from somewhere other than planned, a criterion verified differently, a constraint found on the way. These are findings, stated plainly with their evidence.

### 10. Render the page

Replace the four document values, then write the complete narrative into `DESKCHECK_BODY` in this order:

1. Ticket, title, delivered outcome and source links.
2. Business value.
3. The criteria and how each is met, when the ticket lists any.
4. The evidence for each criterion.
5. Happy-path demonstration, each step with its observed result.
6. Approach overview.
7. Optional detail.
8. Decisions and what they let through.
9. What delivery surfaced.
10. The feedback prompt.
11. Reference links.
12. Feedback and actions already captured, when this is an update after the deskcheck.

The shell provides styles for `.value`, `.links`, `.setup`, `.steps`, `.approach-grid`, `details`, `table` inside `.table-wrap`, `.feedback`, `.evidence` and `.notes`. Use the structures that help this deskcheck.

Use direct, explanatory prose. A presenter should be able to follow the page without translating terse notes, while a reviewer should be able to skim the headings and understand the story.

Name what a source says in words and link it, and expand every criterion label as `prose-writing/writing.md` requires.

## Feedback

Close on one open prompt, such as "What did you expect to see that isn't here?" Questions written in advance anchor the room: reviewers answer what is on the page and stop looking for what the presenter missed.

Pre-write a question only for a choice that delivery surfaced and nobody has decided. A question that reopens something the ticket, spec or an ADR settled belongs in the decisions table instead.

After the deskcheck, update the same file when asked. Record the feedback, decisions and named follow-up actions under `Feedback and actions`. Keep observations distinct from actions.

## Verification

Before reporting the path:

1. Search the file for `{{` and `}}`; no placeholders remain.
2. Confirm the document contains one `h1` and sections for the criteria when the ticket lists any, business value, the happy path, the evidence, the approach, the decisions and feedback.
3. Confirm every demonstration step contains an action, an expected result and its observed result.
4. Confirm every criterion reported as met has pasted evidence beside it — output, response or screenshot, not only a link.
5. Confirm every local link resolves and every external link has an `https://` URL.
6. Confirm the file contains no `<script>`, `on…=` event attribute, `javascript:` or `data:` link (a `data:` image pasted as evidence is fine), remote stylesheet, remote font, credentials, customer data or production payloads, and that the `Content-Security-Policy` meta tag is unchanged.
7. Open the file in a browser. Inspect the full page at desktop width and a narrow viewport; fix overflow, unreadable contrast and broken hierarchy. Headless Chrome will not size a window below about 500 pixels, so its narrow screenshot clips the page; measure `document.documentElement.scrollWidth` inside a 390-pixel iframe instead.
8. Report the output path and any part of the delivered behaviour that remains unverified.
