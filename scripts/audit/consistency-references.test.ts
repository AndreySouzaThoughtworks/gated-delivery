import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { join } from "node:path";

import { write, validRepo, runGuard } from "../test-support/consistency-fixtures.test.support.ts";

/** `validRepo()` plus one indexed domain reference, documented in the canonical inventory. */
const withReference = (dir: string) => {
  assert(typeof dir === "string", `a fixture is a directory path, got ${typeof dir}`);
  write(dir, "plugin/references/reference-graph.md", "| [`thing.md`](./thing.md) | a technology | when it matters |\n");
  write(dir, "plugin/references/thing.md", "# Thing\n");
  write(dir, "plugin/skills/alpha/SKILL.md", "---\nname: alpha\ndescription: x\n---\n\n## Heading One\n\nRead `../../references/thing.md`.\n");
  write(dir, "docs/skill-graph.md", "| `/alpha` | a skill |\n| `bot` | an agent |\n| `h.mjs` | a hook |\n| `reference-graph.md` | the references |\n");
  assert(typeof dir === "string", `the fixture must come back as its path, got ${typeof dir}`);
  return dir;
};

test("a repo with an indexed reference passes and counts it", () => {
  const { code, out } = runGuard(withReference(validRepo()));
  assert.equal(code, 0);
  assert.match(out, /1 skills, 1 agents, 1 hooks, 1 references/);
  assert.doesNotMatch(out, /ERROR/);
});

test("a repo with no references directory stays silent about them", () => {
  const { code, out } = runGuard(validRepo());
  assert.equal(code, 0);
  assert.doesNotMatch(out, /references/);
});

test("a reference file with no row in the index is reported", () => {
  const dir = withReference(validRepo());
  write(dir, "plugin/references/orphan.md", "# Orphan\n");
  const { code, out } = runGuard(dir);
  assert.equal(code, 1);
  assert.match(out, /reference "orphan\.md" is not indexed/);
});

test("a references directory missing its index is reported", () => {
  const dir = withReference(validRepo());
  rmSync(join(dir, "plugin/references/reference-graph.md"));
  const { code, out } = runGuard(dir);
  assert.equal(code, 1);
  assert.match(out, /has no reference-graph\.md/);
});

test("an index absent from the canonical inventory is reported", () => {
  const dir = withReference(validRepo());
  write(dir, "docs/skill-graph.md", "| `/alpha` | a skill |\n| `bot` | an agent |\n");
  const { code, out } = runGuard(dir);
  assert.equal(code, 1);
  assert.match(out, /docs\/skill-graph\.md does not document plugin\/references/);
});

test("an index row naming a deleted file is reported whatever notation carries it", () => {
  for (const row of ["| [`thing.md`](./thing.md) |\n", "| [`thing.md`](thing.md) |\n", "| `thing.md` | a technology |\n"]) {
    const dir = withReference(validRepo());
    write(dir, "plugin/references/reference-graph.md", row);
    rmSync(join(dir, "plugin/references/thing.md"));
    const { code, out } = runGuard(dir);
    assert.equal(code, 1, `expected failure for row ${row.trim()}`);
    assert.match(out, /names "thing\.md", which does not exist/);
  }
});

test("a path to another document is not read as a reference beside the index", () => {
  const dir = withReference(validRepo());
  write(
    dir,
    "plugin/references/reference-graph.md",
    "Beneath [`docs/skill-graph.md`](../../docs/skill-graph.md).\n\n| [`thing.md`](./thing.md) | a technology |\n",
  );
  const { code, out } = runGuard(dir);
  assert.equal(code, 0);
  assert.doesNotMatch(out, /ERROR/);
});

test("deleting the references directory is reported while a doc still points at the index", () => {
  const dir = withReference(validRepo());
  write(dir, "plugin/skills/alpha/SKILL.md", "---\nname: alpha\ndescription: x\n---\n\nIndexed in reference-graph.md.\n");
  rmSync(join(dir, "plugin/references"), { recursive: true });
  const { code, out } = runGuard(dir);
  assert.equal(code, 1);
  assert.match(out, /points at reference-graph\.md, which no longer exists/);
});

test("a relative path from a skill that does not resolve is reported", () => {
  const dir = validRepo();
  write(dir, "plugin/skills/alpha/SKILL.md", "---\nname: alpha\ndescription: x\n---\n\nFill `../../templates/gone.md`.\n");
  const { code, out } = runGuard(dir);
  assert.equal(code, 1);
  assert.match(out, /points at "\.\.\/\.\.\/templates\/gone\.md", which does not resolve/);
});

test("a relative path from a skill that resolves stays silent", () => {
  const dir = validRepo();
  write(dir, "plugin/templates/story.md", "# Story\n");
  write(dir, "plugin/skills/alpha/SKILL.md", "---\nname: alpha\ndescription: x\n---\n\nFill `../../templates/story.md`.\n");
  const { code, out } = runGuard(dir);
  assert.equal(code, 0);
  assert.doesNotMatch(out, /ERROR/);
});

test("a command is a local name, invoked with or without the plugin prefix", () => {
  const dir = validRepo();
  write(dir, "plugin/commands/ship.md", "---\ndescription: ship it\n---\n");
  write(dir, "plugin/skills/alpha/SKILL.md", "---\nname: alpha\ndescription: x\n---\n\n## Heading One\n\nRun `/ship`, or `/gated-delivery:ship`.\n");
  const { code, out } = runGuard(dir);
  assert.equal(code, 0, out);
  assert.match(out, /1 commands/);
});

test("a prefixed command that does not exist is reported", () => {
  const dir = validRepo();
  write(dir, "plugin/skills/alpha/SKILL.md", "---\nname: alpha\ndescription: x\n---\n\n## Heading One\n\nRun `/gated-delivery:gone`.\n");
  const { code, out } = runGuard(dir);
  assert.equal(code, 1, out);
  assert.match(out, /references "gone"/);
});

test("a command without a frontmatter description is reported", () => {
  const dir = validRepo();
  write(dir, "plugin/commands/ship.md", "Just a body.\n");
  const { code, out } = runGuard(dir);
  assert.equal(code, 1, out);
  assert.match(out, /command "ship" has no frontmatter description/);
});

test("built-in review commands are not dangling references", () => {
  const dir = validRepo();
  write(dir, "plugin/skills/alpha/SKILL.md", "---\nname: alpha\ndescription: x\n---\n\n## Heading One\n\nFall back to `/security-review` and `/code-review`.\n");
  const { code, out } = runGuard(dir);
  assert.equal(code, 0, out);
});

test("an index naming CLAUDE.md as client context is not a dangling reference", () => {
  const dir = withReference(validRepo());
  write(dir, "plugin/references/reference-graph.md", "Client domains are listed in the client's CLAUDE.md.\n\n| [`thing.md`](./thing.md) | a technology |\n");
  const { code, out } = runGuard(dir);
  assert.equal(code, 0, out);
});

test("a manifest description naming a skill that does not exist is reported", () => {
  // Both manifests advertised "a quick behavioural story rewrite" long after that skill was deleted.
  // Prose cannot be resolved, so the descriptions name skills as `/name` and the guard resolves those.
  for (const manifest of ["plugin/.claude-plugin/plugin.json", ".claude-plugin/marketplace.json"]) {
    const dir = validRepo();
    const description = "Includes /alpha and /story-rewrite.";
    write(
      dir,
      manifest,
      manifest.startsWith("plugin/")
        ? JSON.stringify({ name: "p", description })
        : JSON.stringify({ plugins: [{ name: "p", source: "plugin", description }] }),
    );
    const { code, out } = runGuard(dir);
    assert.equal(code, 1, `expected failure for ${manifest}: ${out}`);
    assert.match(out, new RegExp(`${manifest.replace(/\./g, "\\.")} description names "/story-rewrite"`));
    assert.doesNotMatch(out, /names "\/alpha"/);
  }
});

test("a manifest description naming only real skills, commands and paths stays silent", () => {
  const dir = validRepo();
  write(dir, "plugin/commands/ship.md", "---\ndescription: ship it\n---\n");
  write(
    dir,
    "plugin/.claude-plugin/plugin.json",
    JSON.stringify({ name: "p", description: "Runs /alpha, /gated-delivery:ship and ./plugin/x, via and/or bot." }),
  );
  const { code, out } = runGuard(dir);
  assert.equal(code, 0, out);
  assert.doesNotMatch(out, /ERROR/);
});
