# Order lifecycle

An order moves through four states: `placed`, `paid`, `fulfilled`, `closed`.

- `placed`: the checkout service creates the order and reserves stock.
- `paid`: the payment service confirms the charge. An order never reaches `fulfilled` unpaid.
- `fulfilled`: the warehouse reports the parcel as shipped.
- `closed`: set automatically 30 days after `fulfilled`, or on a refund.

Cancellation is only possible in `placed` and `paid`.
