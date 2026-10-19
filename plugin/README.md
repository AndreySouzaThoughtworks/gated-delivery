# gated-delivery

Claude Code plugin — issue-driven, test-first delivery flow. The orchestration skills are stack-agnostic; the stack recipes and reviewers they call come from the client's CLAUDE.md (see [client-context](../docs/client-context.md)). Install: [onboarding](../docs/onboarding.md).

## What it ships

What ships, what each piece does and how the pieces call each other — all in **[`docs/skill-graph.md`](../docs/skill-graph.md)**, one inventory, kept honest by `scripts/audit/consistency.mjs` in CI.

## Dev flow at a glance

`/slice` → (`/spec` if needed) → one Rollout slice per branch/PR → `slice-executor` per functional batch → batch tests and targeted review → slice-end validators, full verification, structural lens, and fresh-context correctness review → merge → next slice. Stop, format, and guard hooks run underneath the loop.

## Dependencies & knobs

- **A lint script** — the verify hook runs the repo's own lint (`pnpm lint` unless `GATED_DELIVERY_VERIFY_CMD` says otherwise). Knobs: [`docs/onboarding.md`](../docs/onboarding.md#knobs-environment-variables).
- **`senior-review-lens`** ships **in this plugin** — the canonical 8-lens copy, so every repo runs the same version.
- **Stack recipes and validator agents** — not bundled; each client names its own under `## Stack recipes` and `## Review routing`.
