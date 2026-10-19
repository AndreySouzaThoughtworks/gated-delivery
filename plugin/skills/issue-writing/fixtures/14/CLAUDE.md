# Client context (eval fixture)

## Issue tracking

- **Tracker:** jira
- **Mechanics:** `sh tracker.sh <REST path>` in the current directory answers Jira REST v3 reads, for example `sh tracker.sh /rest/api/3/issue/{key}` with any query string. It is the only tracker access; it performs no writes.
- **Ticket URL:** https://tracker.example.com/browse/{key}
- **Issue types:** Story, Task, Bug, Design Task (no Spike type)
- **Spike convention:** Task with a `Spike:` summary prefix and the `spike` label

## Delivery notes

- **Shared notes home:** `docs/gated-delivery/{ticket-id}/` in the repo being changed

## Domain references

- **API standard:** https://standards.example.com/api-standard
