import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, rmSync, chmodSync } from "node:fs";
import { join } from "node:path";

import { write, validRepo, runGuard, STRICT_ZANITY_CONFIG, ONE_SCENARIO, RELAXED_TEST_RULES, SELECT_ALL } from "../test-support/consistency-fixtures.test.support.ts";

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
  write(dir, "plugin/skills/prose-writing/evals.md", ONE_SCENARIO + "## Deterministic Checks\n\n```bash\ngrep -c foo output.md\n```\n");
  write(dir, "plugin/skills/prose-writing/writing.md", "- the phrases \"earns its place\" and \"load-bearing\"\n");
  write(dir, "README.md", "The plugin — 2 skills, 1 agents, 1 hooks.\n\n[MIT](LICENSE)\n");
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
    "assertion-density disabled under [rules]": STRICT_ZANITY_CONFIG.replace(SELECT_ALL, `${SELECT_ALL}\ndisable = ["assertion-density"]`),
    "another rule disabled under [rules]": STRICT_ZANITY_CONFIG.replace(SELECT_ALL, `${SELECT_ALL}\ndisable = ["recursion"]`),
    "assertion-density moved into the test-file table": STRICT_ZANITY_CONFIG.replace(RELAXED_TEST_RULES, '["assertion-density", "filesystem-in-test", "process-in-test"]'),
    "a disable at the top level": `disable = ["assertion-density"]\n${STRICT_ZANITY_CONFIG}`,
    "an extra rule in the test-file table": STRICT_ZANITY_CONFIG.replace(RELAXED_TEST_RULES, `${RELAXED_TEST_RULES.slice(0, -1)}, "hollow-test"]`),
    "a rule missing from the test-file table": STRICT_ZANITY_CONFIG.replace(RELAXED_TEST_RULES, '["filesystem-in-test"]'),
    "the table on a non-test glob": STRICT_ZANITY_CONFIG.replace("**/*.test.mjs", "**/*.mjs"),
    "a second paths table": `${STRICT_ZANITY_CONFIG}[paths."tests/e2e/"]\ndisable = ["process-in-test"]\n`,
    "a dotted paths key at the top level": `paths."plugin/".disable = ["assertion-density"]\n${STRICT_ZANITY_CONFIG}`,
    "a single-quoted rule the guard cannot read": STRICT_ZANITY_CONFIG.replace(SELECT_ALL, `${SELECT_ALL}\ndisable = ['assertion-density']`),
    "a byte order mark": `\uFEFF${STRICT_ZANITY_CONFIG}`,
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

const mustReject = (dir: string, pattern: RegExp) => {
  assert(existsSync(dir), `the guard must run on a repo that exists, got none at ${dir}; build the fixture first`);
  assert(pattern.source.length > 0, `a rejection pattern must not be empty, got ${pattern}; it would match any output`);
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

test("rejects an evals.md with no scenario row, whether the section is empty or missing", () => {
  const withoutRows = ["## Test Scenarios\n\n| # | Prompt |\n|---|---|\n\n## Deterministic Checks\n", "## Deterministic Checks\n"];
  for (const body of withoutRows) {
    const dir = validRepo();
    write(dir, "plugin/skills/alpha/evals.md", body);
    mustReject(dir, /alpha\/evals\.md has no scenario row under "## Test Scenarios"\. Hint: add one table row/);
  }
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

test("a GATED_DELIVERY_ variable read by a .ts script must be named, a .test.ts file is exempt", () => {
  const dir = validRepo();
  write(dir, "scripts/tool.ts", "process.exit(Number(process.env.GATED_DELIVERY_TS_KNOB) || 0);\n");
  write(dir, "scripts/tool.test.ts", "process.exit(Number(process.env.GATED_DELIVERY_TEST_ONLY_KNOB) || 0);\n");
  const { code, out } = runGuard(dir);
  assert.equal(code, 1);
  assert.match(out, /scripts\/tool\.ts reads GATED_DELIVERY_TS_KNOB/);
  assert.doesNotMatch(out, /GATED_DELIVERY_TEST_ONLY_KNOB/);
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
