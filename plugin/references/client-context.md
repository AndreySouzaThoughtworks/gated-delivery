# Client context contract

The core plugin never names a client. Everything client-specific comes from sections of the nearest CLAUDE.md (a client folder's CLAUDE.md, or a file it imports with `@`). A skill that needs a key reads it there; when the section or key is absent it uses the stated default, or asks.

| Section | Key | Meaning | Default when absent |
|---|---|---|---|
| `## Issue tracking` | Tracker | `jira`, `github`, `linear`, … | Ask |
| | Mechanics | Skill, MCP server or CLI that performs tracker calls | The tracker's connected MCP server, else its CLI |
| | Extra guardrail terms | Terms that must never reach the tracker | Base guardrail only |
| | Ticket URL | URL template for a ticket key | The tracker's default link form |
| | Issue types | Issue types the project offers, and what stands in for a missing one | Discover from the tracker |
| | Spike convention | How a Spike is filed when the tracker has no Spike type | Ask |
| | Bug fields | Dedicated fields for environment, steps, expected and actual result | Put them in the description |
| | Incident tracker | Project or board that holds production incidents | The project the ticket lives in |
| `## Commit convention` | Applies to, Subject, Ticket key, Branch, Remote, PR title | See `/gated-delivery:commit` | Plain Conventional Commits |
| `## Delivery notes` | Shared notes home | Per-ticket handoff, progress, findings and spec files shared across machines and people, and how they are published | `docs/gated-delivery/{ticket-id}/` in the repo being changed |
| | Local notes home | Machine-local scratch: agent notes, review worktrees, parallel slice worktrees, batch state. The verify lock (`verify.lock`) stays at the default path whatever this says, so every client on the machine shares one | `~/.local/state/gated-delivery/` — allow it once per profile in `permissions.additionalDirectories` (see onboarding) |
| | Spec placement | Per-repo rule for whether specs live in the repo | Ask on first spec in a repo, then record the answer here |
| | `GATED_DELIVERY_NOTES_REPO` (env var, not a CLAUDE.md key) | Local checkout of the notes repository when the Shared notes home lives in a separate repo | Clone it with `gh` |
| `## Stack recipes` | per stack | Skills or docs to load when writing or reviewing code in that stack | None; use the repo's own conventions |
| `## Review routing` | per job | Reviewer agents or skills for security, architecture, types, tests | Built-in `/security-review` and `/code-review`; skip the rest and say so |
| `## Domain references` | per domain | Client reference docs a skill may load | None |
| | API standard | The client's normative API guidelines | Ask when a story defines an API |
| `## Verification` | Verify command | The one verify command for the turn-end gate, `/slice` and the code-reviewer. Resolution: `GATED_DELIVERY_VERIFY_CMD`, else this key from the nearest CLAUDE.md in a folder above the repo and inside the home folder — never the repo's own CLAUDE.md, never an `@`-imported file, never a folder above or outside home | Gate: `pnpm lint`. `/slice` and code-reviewer: `pnpm check`, else `pnpm lint`, else `pnpm test` |
| `## Production support` | Observability | Tool that holds production logs, and how to drive it | Ask which tool holds production logs |
| | Log query | Log query for the service | Ask |
| | Environment | Environment tag, and look-alikes that return nothing | Ask; never guess an environment name |
| | Auth errors | Where auth and streaming 401s surface | Backend logs, then front-end monitoring where the tool has it |
| | Retention | Log retention, and the longer-lived source past it | Check the tool's retention before querying |
| | Runbook index | Symptom-to-runbook index | The index the repo's instructions name; else ask |
| | Config fix | Reversible config-fix runbook | None; a config fix needs the client's documented path |
| | Ship path | How a fix reaches production | The path-to-production doc the repo's instructions name; else ask |
| | Investigation corpus | Where per-incident notes go | `~/.local/state/gated-delivery/prod-support/<ticket>/` — machine-local, outside every repo |
| | Deploy correlation | Source for correlating deploys | Git log and release tags of the service repo |
| | Intake fields | Intake-form fields that carry the report | Every populated field, not only `description` |
| | Similar tickets | Projects to search for related tickets | The Incident tracker, else the project the ticket lives in |
| | Call capture | Network or call capture stack | Ask |
| `## Demonstration` | Environments | Non-production environments a deskcheck demonstration may run in, and how to reach each | Ask; never guess an environment name |
| | API explorer | Interactive API documentation to link from demonstration steps | Link the request itself |
| `## Artifact style` | Template, Brand skill | HTML template and brand skill for generated pages | The core's neutral `primer.html`; no brand skill |
| | Disclosure | Disclosure wording shared pages must carry | The template's own footer line; no extra banner |
| | Team primer home | Repository and folder that hold team primers from `/primer`, and how they are published (for example, pushed to `main` without a PR) | Ask where to write a team primer |
