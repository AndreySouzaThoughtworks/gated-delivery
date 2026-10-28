// Behaviour check for the consistency guard. Run: node --test scripts/audit/consistency.test.mjs
//
// This script gates every PR and nothing tested it. Each test builds a minimal valid plugin repo in
// a temp dir, breaks exactly one thing, and asserts the guard reports that one thing — and, just as
// important, that a clean fixture stays silent. A guard that always passes and a guard that always
// fails look identical from the passing side.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { skillHash } from "../eval/changed-skills.mjs";

const GUARD = join(dirname(fileURLToPath(import.meta.url)), "consistency.mjs");

const write = (dir, relPath, body) => {
  assert(typeof body === "string", `${relPath} needs text content, got ${typeof body}`);
  const full = join(dir, relPath);
  assert(full.startsWith(dir), `${relPath} must stay inside ${dir}`);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, body);
};

const TEST_FILES_TABLE = 'paths."**/*.test.mjs"';
const RELAXED_TEST_RULES = '["filesystem-in-test", "process-in-test"]';
const TOP_LEVEL_DISABLE = 'disable = ["assertion-density"]';
const STRICT_ZANITY_CONFIG = `exclude = ["tests/fixtures/", "evals/fixtures/"]\n[rules]\nselect = ["all"]\n${TOP_LEVEL_DISABLE}\n[${TEST_FILES_TABLE}]\ndisable = ${RELAXED_TEST_RULES}\n`;

/** A fixture the guard must accept: 1 skill, 1 agent, 1 hook, all documented. */
const validRepo = () => {
  const dir = mkdtempSync(join(tmpdir(), "gated-delivery-guard-test-"));
  assert(typeof dir === "string" && dir.length > 0, `mkdtemp must yield a directory, got ${dir}`);
  write(dir, "plugin/skills/alpha/SKILL.md", "---\nname: alpha\ndescription: x\n---\n\n## Heading One\n");
  write(
    dir,
    "plugin/skills/alpha/evals.md",
    "| Signal | How to Measure |\n|---|---|\n| x | `grep -c foo out` |\n\n## Deterministic Checks\n\n```bash\n# expect: manual\ngrep -c foo output.md\n```\n",
  );
  write(dir, "plugin/agents/bot.md", "---\nname: bot\ndescription: x\n---\n");
  write(dir, "plugin/hooks/h.mjs", "process.exit(0);\n");
  write(dir, "plugin/hooks/h.test.mjs", "process.exit(0);\n");
  write(dir, "plugin/hooks/hooks.json", JSON.stringify({ hooks: [{ command: "node hooks/h.mjs" }] }));
  write(dir, "plugin/.claude-plugin/plugin.json", JSON.stringify({ name: "p" }));
  write(dir, ".claude-plugin/marketplace.json", JSON.stringify({ plugins: [{ name: "p", source: "plugin" }] }));
  write(dir, "README.md", "The plugin — 1 skills, 1 agents, 1 hooks.\n");
  write(dir, "plugin/README.md", "| `/alpha` | a skill |\n| `bot` | an agent |\n");
  write(dir, "docs/skill-graph.md", "| `/alpha` | a skill |\n| `bot` | an agent |\n| `h.mjs` | a hook |\n");
  write(dir, "zanity.toml", STRICT_ZANITY_CONFIG);
  assert(dir.startsWith(tmpdir()), `${dir} must be a throwaway under ${tmpdir()}`);
  return dir;
};

/** Runs the guard in `dir`. Returns { code, out } and never throws, so a red run stays assertable. */
const runGuard = (dir, env = {}) => {
  assert(typeof dir === "string", `the guard runs in a directory, got ${typeof dir}`);
  let result;
  try {
    result = { code: 0, out: execFileSync("node", [GUARD], { cwd: dir, encoding: "utf8", env: { ...process.env, GATED_DELIVERY_BASE_REF: "", ...env } }) };
  } catch (e) {
    result = { code: e.status ?? 1, out: (e.stdout ?? "") + (e.stderr ?? "") };
  }
  assert(Number.isInteger(result.code), `the guard must report an integer exit code, got ${result.code}`);
  return result;
};

test("a valid repo passes silently", () => {
  const { code, out } = runGuard(validRepo());
  assert.equal(code, 0);
  assert.match(out, /1 skills, 1 agents, 1 hooks/);
  assert.doesNotMatch(out, /ERROR/);
  assert.doesNotMatch(out, /WARN/);
});

test("reports a skill missing its required files", () => {
  for (const missing of ["SKILL.md", "evals.md"]) {
    const dir = validRepo();
    rmSync(join(dir, "plugin/skills/alpha", missing));
    const { code, out } = runGuard(dir);
    assert.equal(code, 1, `expected failure when ${missing} is absent`);
    assert.match(out, new RegExp(`missing ${missing}`));
  }
});

test("a missing SKILL.md reports rather than crashing", () => {
  // Regression: frontmatterName() read the file unconditionally, so ENOENT killed the process
  // before the report block printed the error it had already recorded.
  const dir = validRepo();
  rmSync(join(dir, "plugin/skills/alpha/SKILL.md"));
  const { out } = runGuard(dir);
  assert.match(out, /missing SKILL\.md/);
  assert.doesNotMatch(out, /ENOENT/, "must not surface a raw stack trace");
});

test("reports a frontmatter name that disagrees with its directory or filename", () => {
  const dirSkill = validRepo();
  write(dirSkill, "plugin/skills/alpha/SKILL.md", "---\nname: not-alpha\ndescription: x\n---\n");
  assert.match(runGuard(dirSkill).out, /frontmatter name "not-alpha" != dir name/);

  const dirAgent = validRepo();
  write(dirAgent, "plugin/agents/bot.md", "---\nname: not-bot\ndescription: x\n---\n");
  assert.match(runGuard(dirAgent).out, /frontmatter name "not-bot" != filename/);
});

test("reports hooks.json problems", () => {
  const dangling = validRepo();
  write(dangling, "plugin/hooks/hooks.json", JSON.stringify({ hooks: [{ command: "node hooks/gone.mjs" }] }));
  assert.match(runGuard(dangling).out, /references missing hook file "gone\.mjs"/);

  const malformed = validRepo();
  write(malformed, "plugin/hooks/hooks.json", "{ not json");
  assert.match(runGuard(malformed).out, /hooks\.json invalid JSON/);
});

test("warns on an orphan hook file", () => {
  const dir = validRepo();
  write(dir, "plugin/hooks/orphan.mjs", "process.exit(0);\n");
  const { out } = runGuard(dir);
  assert.match(out, /WARN.*orphan\.mjs" is not referenced/);
});

test("a colocated *.test.mjs is not counted as a hook", () => {
  // Regression: adding guard-bash.test.mjs made the guard read 4 hooks against a README saying 3,
  // and warn about it as an orphan. A test is not a hook.
  const dir = validRepo();
  write(dir, "plugin/hooks/h.test.mjs", "// test\n");
  const { code, out } = runGuard(dir);
  assert.match(out, /1 skills, 1 agents, 1 hooks/, "must not inflate the count");
  assert.doesNotMatch(out, /h\.test\.mjs/, "must not warn as an orphan");
  assert.equal(code, 0);
});

test("reports inventory counts that disagree with reality", () => {
  const dir = validRepo();
  write(dir, "README.md", "The plugin — 9 skills, 1 agents, 1 hooks.\n");
  const { code, out } = runGuard(dir);
  assert.equal(code, 1);
  assert.match(out, /README says "9 skills", actual is 1/);
});

test("reports a skill or agent missing from the canonical inventory", () => {
  const dir = validRepo();
  write(dir, "docs/skill-graph.md", "nothing here\n");
  const { out } = runGuard(dir);
  assert.match(out, /skill "alpha" is not documented in docs\/skill-graph\.md/);
  assert.match(out, /agent "bot" is not documented in docs\/skill-graph\.md/);
});

test("a doc that only links to the inventory is not required to repeat it", () => {
  // The three tables used to be duplicated across plugin/README.md, docs/skill-graph.md and
  // docs/onboarding.md; the guard checked only that a NAME appeared in each, never that they agreed,
  // and they drifted. One canonical table, the rest link.
  const dir = validRepo();
  write(dir, "plugin/README.md", "See [docs/skill-graph.md](../docs/skill-graph.md).\n");
  const { code, out } = runGuard(dir);
  assert.equal(code, 0, out);
  assert.doesNotMatch(out, /ERROR/);
});

test("reports a doc that references a skill or agent which does not exist", () => {
  // The absence side of the check above. A reference SURVIVING a deletion used to be invisible:
  // presence was enforced, absence was not.
  const dir = validRepo();
  write(dir, "plugin/skills/alpha/SKILL.md", "---\nname: alpha\ndescription: x\n---\n\n## Heading One\n\nSee `/removed-skill` and Agent(gone).\n");
  const { code, out } = runGuard(dir);
  assert.equal(code, 1, out);
  assert.match(out, /references "removed-skill", which is not a skill or agent in this repo/);
  assert.match(out, /references "gone", which is not a skill or agent in this repo/);
});

test("the typed agent form and a bare gated-delivery: prefix are both scanned", () => {
  // `Agent(subagent_type: x)` is what docs/skill-graph.md documents and what /slice uses, and
  // `gated-delivery:x` appears bare in prod-support and the README. Neither was matched at first, so a
  // stale reference in either form was reported as clean.
  const dir = validRepo();
  write(dir, "plugin/skills/alpha/SKILL.md", "---\nname: alpha\ndescription: x\n---\n\n## Heading One\n\nAgent(subagent_type: gone-agent) and `gated-delivery:gone-skill`.\n");
  const { code, out } = runGuard(dir);
  assert.equal(code, 1, out);
  assert.match(out, /references "gone-agent"/);
  assert.match(out, /references "gone-skill"/);
});

test("the typed agent form resolves a name that does exist", () => {
  const dir = validRepo();
  write(dir, "plugin/skills/alpha/SKILL.md", "---\nname: alpha\ndescription: x\n---\n\n## Heading One\n\nAgent(subagent_type: bot) and `gated-delivery:alpha`, plus Agent(subagent_type: other-plugin:thing).\n");
  const { code, out } = runGuard(dir);
  assert.equal(code, 0, out);
  assert.doesNotMatch(out, /ERROR/);
});

test("another plugin's namespaced skill is not treated as a dangling reference", () => {
  // `stack-plugin:architecture-recipe` and friends live outside this repo, so the
  // guard cannot resolve them and must not pretend to.
  const dir = validRepo();
  write(dir, "plugin/skills/alpha/SKILL.md", "---\nname: alpha\ndescription: x\n---\n\n## Heading One\n\nSkill(stack-plugin:architecture-recipe) and Agent(security-plugin:threat-modeler).\n");
  const { code, out } = runGuard(dir);
  assert.equal(code, 0, out);
  assert.doesNotMatch(out, /ERROR/);
});

test("built-ins and notation placeholders are not dangling references", () => {
  // `/compact` is Claude Code's, and `Skill(name)` is how skill-graph.md explains the notation.
  // Both would otherwise fail a check that assumes every slash-name is a local skill.
  const dir = validRepo();
  write(dir, "plugin/skills/alpha/SKILL.md", "---\nname: alpha\ndescription: x\n---\n\n## Heading One\n\nRun `/compact`, invoke `Skill(name)`, see `/skill-name`.\n");
  const { code, out } = runGuard(dir);
  assert.equal(code, 0, out);
  assert.doesNotMatch(out, /ERROR/);
});

test("an explicit gated-delivery: prefix resolves against the local inventory", () => {
  const dir = validRepo();
  write(dir, "plugin/skills/alpha/SKILL.md", '---\nname: alpha\ndescription: x\n---\n\n## Heading One\n\nSkill("gated-delivery:alpha") is here, Skill("gated-delivery:absent") is not.\n');
  const { code, out } = runGuard(dir);
  assert.equal(code, 1, out);
  assert.match(out, /references "absent"/);
  assert.doesNotMatch(out, /references "alpha"/);
});

test("warns on a skill whose evals carry no runnable fence", () => {
  const dir = validRepo();
  write(dir, "plugin/skills/alpha/evals.md", "| Signal | How to Measure |\n|---|---|\n| x | `grep -c foo out` |\n");
  const { code, out } = runGuard(dir);
  assert.equal(code, 0, "a missing fence is judgment work, not drift — WARN, never ERROR");
  assert.match(out, /skill "alpha" has no runnable "## Deterministic Checks" fence/);
});

test("warns, without failing, on a check that carries no expect line", () => {
  const dir = validRepo();
  write(
    dir,
    "plugin/skills/alpha/evals.md",
    "## Deterministic Checks\n\n```bash\n# Counts foo.\ngrep -c foo output.md\n# Graded.\n# expect: >=1 on 1\ngrep -c bar output.md\n```\n",
  );
  const { code, out } = runGuard(dir);
  assert.equal(code, 0, "a missing expectation is a WARN, never an ERROR");
  assert.match(out, /alpha\/evals\.md: check "Counts foo\." has no "# expect:" line/);
  assert.doesNotMatch(out, /check "Graded\."/);
});

test("a heading with no fence under it does not count as coverage", () => {
  // Grepping for the heading called this skill covered while the runner parsed zero checks from it.
  const dir = validRepo();
  write(dir, "plugin/skills/alpha/evals.md", "## Deterministic Checks\n\nComing soon.\n");
  assert.match(runGuard(dir).out, /skill "alpha" has no runnable/);
});

test("reports a marketplace source with no plugin manifest", () => {
  const dir = validRepo();
  rmSync(join(dir, "plugin/.claude-plugin/plugin.json"));
  assert.match(runGuard(dir).out, /source "plugin" has no \.claude-plugin\/plugin\.json/);
});

test("warns on an unescaped pipe inside a table-cell code span", () => {
  // The defect that survived three review rounds: GFM reads the pipe as a column separator, so the
  // command renders truncated; escaping it as \| fixes rendering but breaks the raw text.
  const dir = validRepo();
  write(dir, "plugin/skills/alpha/evals.md", '| x | `grep -iEc "foo|bar" out` |\n');
  assert.match(runGuard(dir).out, /unescaped "\|" in a table-cell code span/);
});

test("warns when a measure is keyed on one of the skill's own headings", () => {
  // Such a measure fires on any output of that shape, including a run that failed the scenario.
  const dir = validRepo();
  write(dir, "plugin/skills/alpha/evals.md", '| x | `grep -c -e "Heading One" out` |\n');
  assert.match(runGuard(dir).out, /measure "heading one" also appears in SKILL\.md heading/);
});

test("warns when a check inside the fence is keyed on one of the skill's own headings", () => {
  // The table-cell trap missed this: `grep -iEc "draft"` scored a run that refused to open the
  // draft PR, because `draft` is also a heading in the skill it measures.
  const dir = validRepo();
  write(
    dir,
    "plugin/skills/alpha/evals.md",
    "| Signal | How to Measure |\n|---|---|\n| x | y |\n\n## Deterministic Checks\n\n```bash\ngrep -iEc \"heading one\" output.md\n```\n",
  );
  assert.match(runGuard(dir).out, /check keyed on "heading one", also in SKILL\.md heading/);
});

test("a `## ` comment inside the fence does not hide the checks after it", () => {
  // The section used to end at the first line starting `## `, fence or not, so everything after a
  // `## ...` shell comment went unscanned and its collisions unreported.
  const dir = validRepo();
  write(
    dir,
    "plugin/skills/alpha/evals.md",
    "| Signal | How to Measure |\n|---|---|\n| x | y |\n\n## Deterministic Checks\n\n```bash\n## a shell comment that looks like a heading\ngrep -iEc \"heading one\" output.md\n```\n",
  );
  assert.match(runGuard(dir).out, /check keyed on "heading one"/);
});

test("a fence check marked heading-match-intended is left alone", () => {
  const dir = validRepo();
  write(
    dir,
    "plugin/skills/alpha/evals.md",
    "| Signal | How to Measure |\n|---|---|\n| x | y |\n\n## Deterministic Checks\n\n```bash\ngrep -iEc \"heading one\" output.md   # heading-match-intended\n```\n",
  );
  assert.doesNotMatch(runGuard(dir).out, /check keyed on/);
});

test("a structured fence pattern is not read as a bare heading word", () => {
  // `route (a|b)` is scoped by its own structure; flagging it would make the warning noise.
  const dir = validRepo();
  write(
    dir,
    "plugin/skills/alpha/evals.md",
    "| Signal | How to Measure |\n|---|---|\n| x | y |\n\n## Deterministic Checks\n\n```bash\ngrep -iEc \"heading one (a|b)\" output.md\n```\n",
  );
  assert.doesNotMatch(runGuard(dir).out, /check keyed on/);
});

test("does not warn on a measure that avoids the skill's headings", () => {
  const dir = validRepo();
  write(
    dir,
    "plugin/skills/alpha/evals.md",
    '| x | `grep -c -e "unrelated token" out` |\n\n## Deterministic Checks\n\n```bash\n# expect: manual\ngrep -c foo output.md\n```\n',
  );
  const { code, out } = runGuard(dir);
  assert.doesNotMatch(out, /WARN/, "a clean measure must not warn");
  assert.equal(code, 0);
});

/** `validRepo()` plus one indexed domain reference, documented in the canonical inventory. */
const withReference = (dir) => {
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

test("warns when a skill or agent file uses a phrase banned by the writing rules", () => {
  const skill = validRepo();
  write(skill, "plugin/skills/alpha/SKILL.md", "---\nname: alpha\ndescription: x\n---\n\n## Heading One\n\nThis step earns its place.\n");
  const skillRun = runGuard(skill);
  assert.equal(skillRun.code, 0, "style drift is a WARN, never an ERROR");
  assert.match(skillRun.out, /WARN.*plugin\/skills\/alpha\/SKILL\.md:8 uses banned phrase "earns its place"/);

  const agent = validRepo();
  write(agent, "plugin/agents/bot.md", "---\nname: bot\ndescription: x\n---\n\nThe Load-Bearing check.\n");
  assert.match(runGuard(agent).out, /WARN.*plugin\/agents\/bot\.md:6 uses banned phrase "load-bearing"/);
});

test("the prose-writing skill may name the phrases it bans", () => {
  const dir = validRepo();
  write(dir, "plugin/skills/prose-writing/SKILL.md", "---\nname: prose-writing\ndescription: x\n---\n\ngrep 'earns its place|load-bearing'\n");
  write(dir, "plugin/skills/prose-writing/evals.md", "## Deterministic Checks\n\n```bash\ngrep -c foo output.md\n```\n");
  write(dir, "plugin/skills/prose-writing/writing.md", "- the phrases \"earns its place\" and \"load-bearing\"\n");
  write(dir, "README.md", "The plugin — 2 skills, 1 agents, 1 hooks.\n");
  write(dir, "docs/skill-graph.md", "| `/alpha` | a skill |\n| `/prose-writing` | prose |\n| `bot` | an agent |\n| `h.mjs` | a hook |\n");
  const { code, out } = runGuard(dir);
  assert.equal(code, 0, out);
  assert.doesNotMatch(out, /banned phrase/);
});

test("zanity config with the allowed disables passes the guard", () => {
  const { code, out } = runGuard(validRepo());
  assert.equal(code, 0, out);
  assert.doesNotMatch(out, /zanity/);
});

test("zanity is a required check and its config cannot be loosened", () => {
  const loosened = {
    "a missing config": null,
    "a narrowed select": STRICT_ZANITY_CONFIG.replace('["all"]', '["correctness"]'),
    "a second rule disabled under [rules]": STRICT_ZANITY_CONFIG.replace(TOP_LEVEL_DISABLE, 'disable = ["assertion-density", "recursion"]'),
    "no rule disabled under [rules]": STRICT_ZANITY_CONFIG.replace(TOP_LEVEL_DISABLE, "disable = []"),
    "assertion-density moved into the test-file table": STRICT_ZANITY_CONFIG.replace(TOP_LEVEL_DISABLE, "disable = []").replace(RELAXED_TEST_RULES, '["assertion-density", "filesystem-in-test", "process-in-test"]'),
    "a disable at the top level": `disable = ["assertion-density"]\n${STRICT_ZANITY_CONFIG}`,
    "an extra rule in the test-file table": STRICT_ZANITY_CONFIG.replace(RELAXED_TEST_RULES, `${RELAXED_TEST_RULES.slice(0, -1)}, "hollow-test"]`),
    "a rule missing from the test-file table": STRICT_ZANITY_CONFIG.replace(RELAXED_TEST_RULES, '["filesystem-in-test"]'),
    "the table on a non-test glob": STRICT_ZANITY_CONFIG.replace("**/*.test.mjs", "**/*.mjs"),
    "a second paths table": `${STRICT_ZANITY_CONFIG}[paths."tests/e2e/"]\ndisable = ["process-in-test"]\n`,
    "a dotted paths key at the top level": `paths."plugin/".disable = ["assertion-density"]\n${STRICT_ZANITY_CONFIG}`,
    "a single-quoted rule the guard cannot read": STRICT_ZANITY_CONFIG.replace(TOP_LEVEL_DISABLE, "disable = ['assertion-density']"),
    "an extra excluded path": STRICT_ZANITY_CONFIG.replace('"evals/fixtures/"', '"evals/fixtures/", "plugin/"'),
  };
  for (const [label, config] of Object.entries(loosened)) {
    const dir = validRepo();
    if (config === null) rmSync(join(dir, "zanity.toml"));
    else write(dir, "zanity.toml", config);
    const { code, out } = runGuard(dir);
    assert.notEqual(code, 0, `expected failure for ${label}, got ${out}`);
    assert.match(out, /zanity\.toml/, `the error for ${label} must name the config`);
  }
});

const mustReject = (dir, pattern) => {
  const { code, out } = runGuard(dir);
  assert.equal(code, 1, `expected the guard to fail, got ${out}`);
  assert.match(out, pattern);
};

test("rejects a skill or agent with a blank description", () => {
  const skill = validRepo();
  write(skill, "plugin/skills/alpha/SKILL.md", "---\nname: alpha\ndescription:\n---\n");
  mustReject(skill, /skill "alpha" has no frontmatter description\. Hint:/);

  const agent = validRepo();
  write(agent, "plugin/agents/bot.md", "---\nname: bot\ndescription:   \n---\n");
  mustReject(agent, /agent "bot" has no frontmatter description\. Hint:/);

  const described = validRepo();
  write(described, "plugin/skills/alpha/SKILL.md", "---\nname: alpha\ndescription: Does a thing.\n---\n");
  assert.equal(runGuard(described).code, 0);
});

test("rejects a repeated scenario id", () => {
  const dir = validRepo();
  const rows = "| # | Prompt |\n|---|---|\n| 1 | a |\n| 3 | b |\n| 3 | c |\n";
  write(dir, "plugin/skills/alpha/evals.md", `## Test Scenarios\n\n${rows}\n## Deterministic Checks\n\n\`\`\`bash\n# expect: manual\ngrep -c foo output.md\n\`\`\`\n`);
  mustReject(dir, /alpha\/evals\.md repeats scenario id 3\. Hint:/);
});

test("rejects a script path that does not resolve, and a skill script that is not executable", () => {
  const dangling = validRepo();
  write(dangling, "plugin/skills/alpha/SKILL.md", "---\nname: alpha\ndescription: x\n---\nRun `scripts/gone.sh`.\n");
  mustReject(dangling, /names scripts\/gone\.sh, which exists under no skill/);

  const flat = validRepo();
  write(flat, "plugin/skills/alpha/SKILL.md", "---\nname: alpha\ndescription: x\n---\nRun `scripts/run.sh`.\n");
  write(flat, "plugin/skills/alpha/scripts/run.sh", "#!/bin/sh\n");
  chmodSync(join(flat, "plugin/skills/alpha/scripts/run.sh"), 0o644);
  mustReject(flat, /plugin\/skills\/alpha\/scripts\/run\.sh, which is not executable/);

  chmodSync(join(flat, "plugin/skills/alpha/scripts/run.sh"), 0o755);
  assert.equal(runGuard(flat).code, 0);
});

test("rejects a reference that nothing reads", () => {
  const dir = validRepo();
  write(dir, "plugin/references/reference-graph.md", "| `lonely.md` | a reference |\n");
  write(dir, "plugin/references/lonely.md", "text\n");
  write(dir, "docs/skill-graph.md", "| `/alpha` | a skill |\n| `bot` | an agent |\n| `h.mjs` | a hook |\n`reference-graph.md`\n");
  mustReject(dir, /reference "lonely\.md" is read by no skill, agent or command\. Hint:/);

  write(dir, "plugin/skills/alpha/SKILL.md", "---\nname: alpha\ndescription: x\n---\nRead `../../references/lonely.md`.\n");
  assert.equal(runGuard(dir).code, 0);
});

test("rejects a hook with no colocated test", () => {
  const dir = validRepo();
  rmSync(join(dir, "plugin/hooks/h.test.mjs"));
  mustReject(dir, /hook "h\.mjs" has no colocated h\.test\.mjs\. Hint:/);
});

test("rejects a hook missing from the skill graph", () => {
  const dir = validRepo();
  write(dir, "docs/skill-graph.md", "| `/alpha` | a skill |\n| `bot` | an agent |\n");
  mustReject(dir, /hook "h\.mjs" is not documented in docs\/skill-graph\.md\. Hint:/);
});

test("rejects manifests that carry different versions", () => {
  const dir = validRepo();
  write(dir, "plugin/.claude-plugin/plugin.json", JSON.stringify({ name: "p", version: "1.0.0" }));
  write(dir, ".claude-plugin/marketplace.json", JSON.stringify({ metadata: { version: "1.0.1" }, plugins: [{ name: "p", source: "plugin" }] }));
  mustReject(dir, /manifest versions disagree: .*plugin\.json says 1\.0\.0, .*marketplace\.json says 1\.0\.1\. Hint:/);

  write(dir, ".claude-plugin/marketplace.json", JSON.stringify({ metadata: { version: "1.0.0" }, plugins: [{ name: "p", source: "plugin" }] }));
  assert.equal(runGuard(dir).code, 0);
});

test("a GATED_DELIVERY_ variable the code reads must be named in the docs", () => {
  const dir = validRepo();
  write(dir, "plugin/hooks/h.mjs", "process.exit(Number(process.env.GATED_DELIVERY_SECRET_KNOB) || 0);\n");
  const undocumented = runGuard(dir);
  assert.equal(undocumented.code, 1);
  assert.match(undocumented.out, /plugin\/hooks\/h\.mjs reads GATED_DELIVERY_SECRET_KNOB/);
  write(dir, "docs/knobs.md", "| `GATED_DELIVERY_SECRET_KNOB` | `0` | tunes the hook |\n");
  const documented = runGuard(dir);
  assert.equal(documented.code, 0, documented.out);
});

test("a condition that never varies is rejected, one that can change is accepted", () => {
  const constant = {
    "a literal assert": 'assert(true, "m");',
    "a literal comparison in an if": "if (1 === 1) process.exit(0);",
    "a literal while": "while (false) {}",
    "an assert on a same-file constant": 'const EXIT_OK = 0;\nconsole.assert(Number.isInteger(EXIT_OK), "m");',
    "an if on a same-file string constant": 'const MODE = "fast";\nif (MODE === "fast") process.exit(0);',
  };
  const varying = {
    "a parameter check": 'export const f = (x) => { assert(typeof x === "string", "m"); };',
    "an env-derived constant": 'const limit = Number(process.argv[2]);\nassert(Number.isFinite(limit), "m");',
    "a mutated array": "const errors = [];\nerrors.push(1);\nif (errors.length) process.exit(1);",
    "a commented-out assert": '// assert(true, "m")\nprocess.exit(0);',
  };
  for (const [label, code] of Object.entries(constant)) {
    const dir = validRepo();
    write(dir, "plugin/hooks/h.mjs", `${code}\n`);
    const { code: exit, out } = runGuard(dir);
    assert.equal(exit, 1, `expected failure for ${label}`);
    assert.match(out, /plugin\/hooks\/h\.mjs:\d+ .* never varies/, `the error for ${label} must name the file and line`);
  }
  for (const [label, code] of Object.entries(varying)) {
    const dir = validRepo();
    write(dir, "plugin/hooks/h.mjs", `${code}\n`);
    const { code: exit, out } = runGuard(dir);
    assert.equal(exit, 0, `${label} must pass: ${out}`);
  }
});

const BASE_REF = "main";
const GIT_IDENTITY = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const git = (dir, args) => execFileSync("git", args, { cwd: dir, encoding: "utf8", env: { ...process.env, ...GIT_IDENTITY } });

const featureBranchEditing = (file, body) => {
  const dir = validRepo();
  git(dir, ["init", "-b", BASE_REF]);
  git(dir, ["add", "."]);
  git(dir, ["commit", "-m", "base"]);
  git(dir, ["checkout", "-b", "feature"]);
  write(dir, file, body);
  git(dir, ["add", "."]);
  git(dir, ["commit", "-m", "change"]);
  return dir;
};

const SKILL_EDIT = ["plugin/skills/alpha/SKILL.md", "---\nname: alpha\ndescription: x\n---\n\n## Heading One\n\nEdited.\n"];
const stamp = (dir, hash) => write(dir, "evals/results/alpha.json", JSON.stringify({ hash }));

test("a skill changed against the base ref needs an eval stamp with a matching hash", () => {
  const dir = featureBranchEditing(...SKILL_EDIT);
  const missing = runGuard(dir, { GATED_DELIVERY_BASE_REF: BASE_REF });
  assert.equal(missing.code, 1);
  assert.match(missing.out, /skill alpha changed since its evals last passed; run node scripts\/eval\/changed-skills\.mjs and commit evals\/results\/alpha\.json/);
  stamp(dir, "not-the-hash");
  const stale = runGuard(dir, { GATED_DELIVERY_BASE_REF: BASE_REF });
  assert.equal(stale.code, 1);
  assert.match(stale.out, /skill alpha/);
  stamp(dir, skillHash(dir, "alpha"));
  const matching = runGuard(dir, { GATED_DELIVERY_BASE_REF: BASE_REF });
  assert.equal(matching.code, 0, matching.out);
});

test("the stamp check is skipped when GATED_DELIVERY_BASE_REF is unset", () => {
  const dir = featureBranchEditing(...SKILL_EDIT);
  const { code, out } = runGuard(dir);
  assert.equal(code, 0, out);
});

test("a skill nobody changed, or whose only change is evals.md, needs no stamp", () => {
  const evalsOnly = featureBranchEditing("plugin/skills/alpha/evals.md", "| Signal | How to Measure |\n|---|---|\n| x | `grep -c foo out` |\n\n## Deterministic Checks\n\n```bash\n# expect: manual\ngrep -c bar output.md\n```\n");
  const edited = runGuard(evalsOnly, { GATED_DELIVERY_BASE_REF: BASE_REF });
  assert.equal(edited.code, 0, edited.out);
  const untouched = featureBranchEditing("docs/note.md", "note\n");
  const unchanged = runGuard(untouched, { GATED_DELIVERY_BASE_REF: BASE_REF });
  assert.equal(unchanged.code, 0, unchanged.out);
});
