## Issue tracking
- **Tracker:** `jira`
- **Mechanics:** the connected Jira MCP server

## Production support
- **Observability:** Datadog via its MCP server
- **Log query:** `service:orders-api env:prod-eu1`
- **Environment:** `prod-eu1` — not `prod-eu`, which returns nothing
- **Retention:** logs ~15 days; database records ~30 days
- **Config fix:** `docs/runbooks/updating-account-settings.md` (Settings API `PATCH`, reversible)
- **Investigation corpus:** `.corpus/gated-delivery/prod-support/<ticket>/` in this checkout, excluded from git by `.git/info/exclude`
- **Similar tickets:** projects `SUP` and `OPS`
