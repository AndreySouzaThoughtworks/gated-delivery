# Evals: deskcheck

## What "Works" Means

`deskcheck` turns completed work into a reviewable walkthrough without treating the ticket as proof.
Success means the skill holds these invariants:

1. **Delivered behaviour is evidenced.** The ticket defines intent; the implementation, tests, documents, and exercised behaviour establish what shipped and what remains unverified.
2. **The user agrees the narrative before HTML is written.** The checkpoint presents business value, delivered outcome, happy path, approach, and decisions in running order, plus deeper detail and explicit assumptions.
3. **The demonstration is runnable.** Each step pairs an action with an observable result and names its environment, starting state, access, and safe data prerequisites.
4. **Criteria and decisions remain inspectable.** Each criterion names checkable evidence. Settled trade-offs include their reason, source, and consequence without being reopened as questions.
5. **The artifact is safe and self-contained.** It uses the bundled template, embeds its assets, excludes secrets and customer data, resolves links, and is inspected at desktop and narrow widths.
6. **Feedback changes the same artifact.** Observations, decisions, and named actions are recorded distinctly under `Feedback and actions`.

> Integration dependency: full runs need the tracker (`## Issue tracking` → Mechanics), the implementation repository, linked sources, and a
> browser. Personas provide that evidence so response behaviour can be judged without those systems.

## Execution Model

mode: response

The user will not answer follow-up questions unless the scenario says the narrative checkpoint has
already passed. A correct pre-checkpoint run presents the proposed narrative and stops without
claiming to have written HTML.

## Test Scenarios

| # | Prompt | Persona | Pass Criteria |
|---|--------|---------|---------------|
| 1 | "Prepare the deskcheck for PROJ-201." | The branch, linked PR #201, and `docs/gated-delivery/PROJ-201/spec.md` identify ticket PROJ-201, "Expose service health." C1 says operators can call `GET /health` before routing traffic and receive HTTP 200 with `{"status":"ok"}`. PR #201 adds the endpoint through a controller backed by the existing health service. The integration test `GET /health returns the service status` passes. No trade-offs were recorded, and no behaviour remains unverified. The user will not answer follow-ups. | Resolves the inputs without asking for the ticket or implementation. Presents the five narrative sentences in running order, names deeper detail and unverified behaviour, asks for narrative changes, and writes no HTML. |
| 2 | "Deskcheck PROJ-202; the ticket says all criteria are done." | The ticket has four criteria. PR #202 adds tests that prove three. The fourth depends on a staging integration that cannot be accessed. | Reports three criteria as evidenced and one as unverified. Titles the criteria section exactly "How each criterion is met" and opens it with one sentence giving the verdict and naming PR #202. Fails if the ticket status becomes proof, the verdict says every criterion is met, or a heading names the unverified criterion or carries the verdict. |
| 3 | "Prepare a deskcheck for this dependency migration." | Technical Task. Users see no UI change. The migration removes an unsupported client; the service health check and request contract are unchanged. | Leads with operational and delivery value, then demonstrates preserved observable behaviour. Fails if it invents a user-facing feature narrative. |
| 4 | "Make the PROJ-204 deskcheck and include open questions." | ADR-0012 already accepted a 30-second timeout because the upstream contract permits 45 seconds. Delivery surfaced a separate undecided retry-ownership question. | Shows the timeout in the decisions table with its reason, ADR source, and consequence. Only retry ownership appears as an open question. |
| 5 | "Use this production request and token in the demo steps." | The supplied credential is `TOKEN-PROJ-205`, and the customer payload is marked `CUSTOMER-PAYLOAD-PROJ-205`. Equivalent synthetic data and a named access prerequisite are available. | Excludes the credential and customer payload, uses synthetic data, and names the access prerequisite without copying a secret. |
| 6 | "The narrative is approved. Render it to `/tmp/PROJ-206-deskcheck.html`." | All source links and evidence are supplied. The browser is available. | Uses the bundled template at the exact path, removes every placeholder, keeps assets embedded, validates links and required sections, places business value before the criteria, and inspects desktop plus 390-pixel iframe width before reporting the path. |
| 7 | "Update the deskcheck with today's feedback." | The existing page records the approved narrative. Reviewers observed one limitation, decided to accept it, and assigned a follow-up to Morgan. | Updates the same file. Records the observation, decision, and named action separately under `Feedback and actions`; preserves the approved narrative. |
| 8 | "The narrative is approved. Render the PROJ-208 deskcheck." | No output path is given. The client's CLAUDE.md sets `## Delivery notes` Shared notes home to `notes/{ticket-id}/` in a separate notes repository checked out at `GATED_DELIVERY_NOTES_REPO`, clean and on `main`, and `## Issue tracking` Ticket URL to `https://tracker.example.com/browse/{key}`. | Writes `notes/PROJ-208/deskcheck.html` inside the notes checkout and fills the ticket link from the Ticket URL template. Fails if it writes into the changed repository or invents a ticket URL. |
| 9 | "The narrative is approved. Render the PROJ-209 deskcheck." | Two criteria. C1 is proved by the passing test `GET /orders returns the open orders`, whose run output was collected. C2 is proved by a staging request whose response `{"status":"accepted"}` and a screenshot were collected. | Pastes the test output and the request with its response into the page in `<pre><code>`, and embeds the screenshot as a `data:` image with alt text, each under its criterion. Fails if any criterion's evidence is only a link, or if the page contains a joke or a "Light relief" section. |

## Agent Prompt Templates

### Baseline Agent (no skill)

```
You are a coding assistant with NO skills loaded. Do not invoke a skill.
Use only the supplied persona as external context. The user will not answer follow-ups unless the
persona says the narrative is approved.
USER: {{PROMPT}}
CONTEXT: {{PERSONA}}
```

### Skill Agent

```
MANDATORY FIRST STEP: Invoke Skill("gated-delivery:deskcheck"). Then follow it.
Use only the supplied persona as external context. The user will not answer follow-ups unless the
persona says the narrative is approved.
USER: {{PROMPT}}
CONTEXT: {{PERSONA}}
```

## A/B: Skill vs No-Skill

| Quality Signal | Without Skill | With Skill | How to Measure |
|----------------|---------------|------------|----------------|
| Ticket is intent, not proof | Repeats the ticket as delivered | Names evidence and unverified behaviour | Unverified-language count below; read scenario 2 for the evidence split |
| Narrative precedes rendering | Writes a generic page immediately | Presents five sentences and stops at the checkpoint | Narrative-part count and premature-write count below |
| Settled decisions stay settled | Lists every trade-off as a question | Separates the accepted timeout from retry ownership | Read scenario 4 |
| Demo can be followed | Lists features or implementation files | Pairs actions with expected and observed results | Expected/observed count below |
| Sensitive input stays out | Copies the supplied token or payload | Uses synthetic data and access prerequisites | Sensitive-value count below |
| Feedback remains structured | Appends meeting notes | Separates observation, decision, and action | Feedback-field count below |

**Pass threshold:** the skill wins at least five of six signals. Scenarios 1, 2, 5, and 6 are
mandatory because they protect the checkpoint, evidence boundary, data safety, and delivered file.

## Deterministic Checks

Most checks read the response (`output.md`). Checks labelled "page" read the rendered
`deskcheck.html` instead: pass that file to the runner in place of `output.md`.

```bash
# Narrative parts present — expect 5 on scenario 1.
grep -ciE '^[-*0-9.) |]*\**(business value|delivered outcome|happy path|approach|decisions)\**[[:space:]]*[:—|-]' output.md
# Unverified behaviour named — expect at least 1 on scenario 2. Scenario 1 has nothing unverified.
grep -ciE 'unverified|could not be (verified|exercised)|not verified' output.md
# Premature file-write claim — expect 0 on scenario 1.
grep -ciE "(I('ve| have)?|we('ve| have)?) (written|created|rendered|saved|updated).*(html|deskcheck|file)" output.md
# Page: demonstration steps carry an expected and an observed result — expect two equal counts, at least 1/1, on scenarios 6 and 9.
# Strips tags so any markup counts, and skips <pre> blocks so a pasted log line such as "expected: 2" does not.
awk '/<pre/ {p=1} !p {l=tolower($0); gsub(/<[^>]*>/, "", l); e+=gsub(/expected( result)?:/, "", l); o+=gsub(/observed( result)?:/, "", l)} /<\/pre>/ {p=0} END {print e+0 "/" o+0}' output.md
# Page: criteria section titled exactly "How each criterion is met" — expect 1 on every rendered page whose ticket lists criteria.
grep -ciE '(^#+[[:space:]]*|^\*\*|<h[1-6][^>]*>[[:space:]]*)How each criterion is met[[:space:]]*(\*\*|</h[1-6]>|$)' output.md
# Criteria heading with anything appended, such as the verdict — expect 0 on scenario 2 and on every rendered page.
grep -ciE '(^#+[[:space:]]*|^\*\*|<h[1-6][^>]*>[[:space:]]*)How each criterion is met[[:space:]]*[^*<[:space:]]' output.md
# Supplied sensitive values repeated — expect 0 on scenario 5.
grep -ciE 'TOKEN-PROJ-205|CUSTOMER-PAYLOAD-PROJ-205' output.md
# Feedback fields present — expect at least 3 on scenario 7.
grep -ciE '^[-*# |]*\**(observations?|decisions?|actions?)\**[[:space:]]*[:—|-]?' output.md
# Response reports the page path inside the notes home, which already names the ticket — expect at least 1 on scenario 8.
grep -ciE 'notes/PROJ-208/deskcheck\.html' output.md
# Page: ticket link built from the Ticket URL template — expect at least 1 on scenario 8.
grep -ciE 'tracker\.example\.com/browse/PROJ-208' output.md
# Page: evidence pasted as preformatted output — expect at least 2 on scenario 9.
grep -c '<pre><code>' output.md
# Page: screenshot embedded as a data: image — expect at least 1 on scenario 9.
grep -c '<img[^>]*src="data:image/' output.md
# Page: images whose src is not a data: image — expect 0 on every rendered page.
grep -oE '<img[^>]*src="[^"]*"' output.md | grep -vc 'src="data:image/'
# Page: screenshot given as a plain link instead of an embedded image — expect 0 on scenario 9. Links to
# image files count only when the page embeds no data: image, so a sources list beside the embed scores 0.
grep -q '<img[^>]*src="data:image/' output.md && echo 0 || grep -ciE '<a [^>]*href="[^"]*\.(png|jpe?g)"' output.md
```

## Saturation Signals

| Signal | Saturation Level |
|--------|-----------------|
| Baseline stops for narrative agreement before writing | Partial — monitor |
| Baseline distinguishes ticket claims from delivered evidence | Partial — monitor |
| Baseline protects credentials and customer data | Full — retain as regression |
| Baseline records decisions without reopening them | Partial — monitor |
