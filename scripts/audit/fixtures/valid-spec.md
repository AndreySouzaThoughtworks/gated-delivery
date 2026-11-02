---
ticket: PROJ-123
type: change
status: Ready
created: 2026-01-15
---
# PROJ-123 — Reject empty order lines

**Ticket:** https://tracker.example.com/browse/PROJ-123

## Summary

As a buyer, I cannot submit an order that contains a line with no quantity.

## Relevant files

- `src/orders/order.ts` — builds the order — guarded by `test/orders/order.spec.ts`

## Red flags

- (none found)

### Contradictions

No contradictions detected between the inspected surfaces.

### Stale or possibly stale

- (none)

## Domain model

N/A — no domain entities added, changed, or renamed, the order already carries lines.

## Acceptance criteria

- [ ] **AC[1] — `in-repo / unit test`:** Given an order line with quantity 0, when the order is submitted, then it is rejected with `EMPTY_LINE`.
- [ ] **AC[2] — `in-repo / integration test`:** Given a stored order with an empty line, when it is loaded, then loading fails with `EMPTY_LINE`.
- [ ] **AC[4] — `in-repo / unit test`:** Given a valid line, when submitted, then it is accepted.
- [ ] **AC[3] — `cross-repo / manual verification`:** Given the deployed environment, when a buyer submits an empty line, then the checkout page shows the error.

## Interface

N/A — internal change, no public surface moves.

## Security

N/A — no new trust boundary or sensitive data; STRIDE walk found nothing material, the endpoint is unchanged.

## Open decisions

- Decision: reject at submit or at load — chosen: both, because AC[1] and AC[2] each need one; consequence: two checks to keep in step.

## Rollout

Ordered merge sequence, one entry per slice.

| Wave | Slices | Why they cannot collide |
|---|---|---|
| 1 | S1 | only slice |
| 2 | S2 | depends on S1 |
| 3 | S3 | depends on S2 |

### Slice 1 — AC1 — exposure: complete

Order submission rejects empty lines on `main`.

Boundary: one rule, one test layer.

Lane fields:

- Depends on: none
- Write surface: src/orders
- Shared interface: none
- Verify needs: isolated

### Slice 2 — AC2 — exposure: flagged

Stored orders are validated on load behind a flag.

Flag: validate-on-load — default off — removed when 14 days at 100% show an EMPTY_LINE rate under 0.1%

- Depends on: Slice 1
- Write surface: src/orders/repository.ts
- Shared interface: none
- Verify needs: exclusive — boots the application

### Slice 3 — AC4 — exposure: unwired

Nothing calls this yet.

- Depends on: S2
- Write surface: src/orders/index.ts
- Shared interface: none
- Verify needs: isolated

## Edges

- (none)

## Done-when

### Slice 1

- [ ] Every AC assigned to this slice is implemented and verified by at least one test

### Slice 2

- [ ] Every AC assigned to this slice is implemented and verified by at least one test

### Slice 3

- [ ] Every AC assigned to this slice is implemented and verified by at least one test

### Per ticket

- [ ] No unresolved entries remain in Open decisions
- [ ] Every `cross-repo / manual verification` AC has recorded evidence and an owner
- [ ] AC3 — evidence: screenshot of the checkout error in the ticket — owner: checkout team
