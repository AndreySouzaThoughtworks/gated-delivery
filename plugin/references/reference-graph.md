# gated-delivery — domain references

The index of domain references, beneath [`docs/skill-graph.md`](../../docs/skill-graph.md), which
inventories everything this plugin ships. Skills link here, not to a reference directly, so a skill
never carries knowledge of one technology and a new reference needs no skill edit.

A reference states what is true of a technology now — what it can express, where it stops, how to
tell. It is something to know, not something to do, which is why these are not skills.

## References

| Reference | Covers | Read when |
|-----------|--------|-----------|

The plugin ships no reference of its own yet. Client-specific references — a technology one client
uses and others do not — are listed in the `## Domain references` section of the client's CLAUDE.md
(see [`client-context.md`](./client-context.md), the contract for every client key). Read that section too, and apply its rows
the same way as the rows above.

## Adding one

Add a row above and a file beside it. Nothing in any skill changes. `scripts/audit/consistency.mjs`
fails CI on a file with no row, a row with no file, and this index missing from `docs/skill-graph.md`.

Add a reference when its subject has constraints a competent engineer would not guess and
would otherwise discover by shipping something that silently does nothing. Guidance a reviewer would
catch belongs in the repo's own docs instead. A reference only one client needs belongs in that
client's `## Domain references` section, not here.

Keep each one current rather than historical: state today's behaviour, not how it changed. A reader
reconciling a changelog is reading the wrong document.
