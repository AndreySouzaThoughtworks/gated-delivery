// Behaviour check for the consistency guard. Run: node --test scripts/audit/consistency.test.ts
//
// This script gates every PR and nothing tested it. Each test builds a minimal valid plugin repo in
// a temp dir, breaks exactly one thing, and asserts the guard reports that one thing — and, just as
// important, that a clean fixture stays silent. A guard that always passes and a guard that always
// fails look identical from the passing side.

import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { write, validRepo, runGuard, STRICT_ZANITY_CONFIG, ONE_SCENARIO } from "../test-support/consistency-fixtures.test.support.ts";

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

test("a repo file that is not valid UTF-8 stops the guard and names the file", () => {
  const dir = validRepo();
  writeFileSync(join(dir, "README.md"), Buffer.from([0xff, 0xfe, 0x20]));
  const { code, out } = runGuard(dir);
  assert.equal(code, 1, out);
  assert.match(out, /README\.md must be valid UTF-8/);
});

test("a plugin whose skills folder is missing or holds no folder stops the guard", () => {
  const missing = validRepo();
  rmSync(join(missing, "plugin/skills"), { recursive: true });
  const gone = runGuard(missing);
  assert.equal(gone.code, 1, gone.out);
  assert.match(gone.out, /plugin\/skills must exist before its folders are listed/);

  const empty = validRepo();
  rmSync(join(empty, "plugin/skills/alpha"), { recursive: true });
  const none = runGuard(empty);
  assert.equal(none.code, 1, none.out);
  assert.match(none.out, /plugin\/skills must hold at least one folder/);
});

test("a skill that declares a blank name stops the guard and names the file", () => {
  const dir = validRepo();
  write(dir, "plugin/skills/alpha/SKILL.md", "---\ndescription: x\nname:   \n---\n\n## Heading One\n");
  const { code, out } = runGuard(dir);
  assert.equal(code, 1, out);
  assert.match(out, /alpha\/SKILL\.md declares a blank name/);
});

test("a zanity config list with a blank quoted item stops the guard", () => {
  const dir = validRepo();
  write(dir, "zanity.toml", STRICT_ZANITY_CONFIG.replace('"evals/fixtures/"]', '"evals/fixtures/", ""]'));
  const { code, out } = runGuard(dir);
  assert.equal(code, 1, out);
  assert.match(out, /zanity\.toml lists must not hold blank items/);
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
  write(dir, "plugin/skills/alpha/evals.md", ONE_SCENARIO + "| Signal | How to Measure |\n|---|---|\n| x | `grep -c foo out` |\n");
  const { code, out } = runGuard(dir);
  assert.equal(code, 0, "a missing fence is judgment work, not drift — WARN, never ERROR");
  assert.match(out, /skill "alpha" has no runnable "## Deterministic Checks" fence/);
});

test("warns, without failing, on a check that carries no expect line", () => {
  const dir = validRepo();
  write(
    dir,
    "plugin/skills/alpha/evals.md",
    ONE_SCENARIO + "## Deterministic Checks\n\n```bash\n# Counts foo.\ngrep -c foo output.md\n# Graded.\n# expect: >=1 on 1\ngrep -c bar output.md\n```\n",
  );
  const { code, out } = runGuard(dir);
  assert.equal(code, 0, "a missing expectation is a WARN, never an ERROR");
  assert.match(out, /alpha\/evals\.md: check "Counts foo\." has no "# expect:" line/);
  assert.doesNotMatch(out, /check "Graded\."/);
});

test("a heading with no fence under it does not count as coverage", () => {
  // Grepping for the heading called this skill covered while the runner parsed zero checks from it.
  const dir = validRepo();
  write(dir, "plugin/skills/alpha/evals.md", ONE_SCENARIO + "## Deterministic Checks\n\nComing soon.\n");
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
  write(dir, "plugin/skills/alpha/evals.md", ONE_SCENARIO + '| x | `grep -iEc "foo|bar" out` |\n');
  assert.match(runGuard(dir).out, /unescaped "\|" in a table-cell code span/);
});

test("warns when a measure is keyed on one of the skill's own headings", () => {
  // Such a measure fires on any output of that shape, including a run that failed the scenario.
  const dir = validRepo();
  write(dir, "plugin/skills/alpha/evals.md", ONE_SCENARIO + '| x | `grep -c -e "Heading One" out` |\n');
  assert.match(runGuard(dir).out, /measure "heading one" also appears in SKILL\.md heading/);
});

test("warns when a check inside the fence is keyed on one of the skill's own headings", () => {
  // The table-cell trap missed this: `grep -iEc "draft"` scored a run that refused to open the
  // draft PR, because `draft` is also a heading in the skill it measures.
  const dir = validRepo();
  write(
    dir,
    "plugin/skills/alpha/evals.md",
    ONE_SCENARIO + "| Signal | How to Measure |\n|---|---|\n| x | y |\n\n## Deterministic Checks\n\n```bash\ngrep -iEc \"heading one\" output.md\n```\n",
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
    ONE_SCENARIO + "| Signal | How to Measure |\n|---|---|\n| x | y |\n\n## Deterministic Checks\n\n```bash\n## a shell comment that looks like a heading\ngrep -iEc \"heading one\" output.md\n```\n",
  );
  assert.match(runGuard(dir).out, /check keyed on "heading one"/);
});

test("a fence check marked heading-match-intended is left alone", () => {
  const dir = validRepo();
  write(
    dir,
    "plugin/skills/alpha/evals.md",
    ONE_SCENARIO + "| Signal | How to Measure |\n|---|---|\n| x | y |\n\n## Deterministic Checks\n\n```bash\ngrep -iEc \"heading one\" output.md   # heading-match-intended\n```\n",
  );
  assert.doesNotMatch(runGuard(dir).out, /check keyed on/);
});

test("a structured fence pattern is not read as a bare heading word", () => {
  // `route (a|b)` is scoped by its own structure; flagging it would make the warning noise.
  const dir = validRepo();
  write(
    dir,
    "plugin/skills/alpha/evals.md",
    ONE_SCENARIO + "| Signal | How to Measure |\n|---|---|\n| x | y |\n\n## Deterministic Checks\n\n```bash\ngrep -iEc \"heading one (a|b)\" output.md\n```\n",
  );
  assert.doesNotMatch(runGuard(dir).out, /check keyed on/);
});

test("does not warn on a measure that avoids the skill's headings", () => {
  const dir = validRepo();
  write(
    dir,
    "plugin/skills/alpha/evals.md",
    ONE_SCENARIO + '| x | `grep -c -e "unrelated token" out` |\n\n## Deterministic Checks\n\n```bash\n# expect: manual\ngrep -c foo output.md\n```\n',
  );
  const { code, out } = runGuard(dir);
  assert.doesNotMatch(out, /WARN/, "a clean measure must not warn");
  assert.equal(code, 0);
});
