import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { changedSkills, skillHash } from "./changed-skills.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT_NAMES = ["changed-skills.mjs", "run-scenarios.mjs", "run-checks.mjs"];
const EXECUTABLE_MODE = 0o755;
const BASE = "main";
const GIT_IDENTITY = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };

const EVALS = `# Evals: demo

## Test Scenarios

| # | Prompt | Persona | Pass Criteria |
|---|--------|---------|---------------|
| 1 | "Do the thing." | Plain persona. | Does the thing. |

## Agent Prompt Templates

### Skill Agent
\`\`\`
Invoke Skill("gated-delivery:demo").
USER: {{PROMPT}}
CONTEXT: {{PERSONA}}
\`\`\`

## Deterministic Checks

\`\`\`bash
# expect: >=1 on 1
grep -c thing output.md
\`\`\`
`;

const STUB_CLAUDE = `#!/usr/bin/env node
const { appendFileSync } = require("node:fs");
const args = process.argv.slice(2);
if (args.includes("--output-format") && args.includes("json")) {
  appendFileSync(process.env.STUB_LOG + ".probe", JSON.stringify({ args, cwd: process.cwd() }) + "\\n");
  if (process.env.STUB_PROBE === "garbage") { console.log("<html>gateway error</html>"); return; }
  console.log(JSON.stringify({ is_error: process.env.STUB_PROBE === "error", result: process.env.STUB_PROBE === "error" ? "Not logged in" : "ok" }));
  return;
}
appendFileSync(process.env.STUB_LOG, JSON.stringify(args) + "\\n");
const runNumber = Number(process.cwd().slice(-1));
const recovering = process.env.STUB_RECOVER === "1" && runNumber % 2 === 1;
const text = process.env.STUB_OUTPUT || (recovering ? "nope" : "thing");
console.log(JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Skill", input: {} }] } }));
console.log(JSON.stringify({ type: "result", result: text, total_cost_usd: 0.1, permission_denials: [] }));
`;

const git = (cwd, args) => execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, ...GIT_IDENTITY } });

const write = (root, path, body) => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), body);
};

const fakeRepo = () => {
  const root = mkdtempSync(join(tmpdir(), "gated-delivery-changed-"));
  for (const name of SCRIPT_NAMES) {
    mkdirSync(join(root, "scripts", "eval"), { recursive: true });
    copyFileSync(join(HERE, name), join(root, "scripts", "eval", name));
  }
  write(root, "plugin/skills/demo/SKILL.md", "# demo\nDispatches the bot agent.\n");
  write(root, "plugin/skills/demo/evals.md", EVALS);
  write(root, "plugin/skills/demo/scripts/tool.sh", "echo tool\n");
  write(root, "plugin/skills/demo/scripts/tool.test.sh", "echo test\n");
  write(root, "plugin/agents/bot.md", "bot v1\n");
  write(root, "plugin/agents/other.md", "other v1\n");
  write(root, "bin/claude", STUB_CLAUDE);
  chmodSync(join(root, "bin", "claude"), EXECUTABLE_MODE);
  mkdirSync(join(root, "stub-log"));
  git(root, ["init", "-b", BASE]);
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "base"]);
  git(root, ["checkout", "-b", "feature"]);
  return root;
};

const commitAll = (root) => {
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "change"]);
};

const claudeCalls = (root) => {
  const log = join(root, "stub-log", "calls");
  return existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line)) : [];
};

const runChangedSkills = (root, args = [], env = {}) =>
  spawnSync("node", ["scripts/eval/changed-skills.mjs", ...args], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      GATED_DELIVERY_CLAUDE_BIN: join(root, "bin", "claude"),
      GATED_DELIVERY_BASE_REF: BASE,
      STUB_LOG: join(root, "stub-log", "calls"),
      ...env,
    },
  });

const stampOf = (root) => JSON.parse(readFileSync(join(root, "evals", "results", "demo.json"), "utf8"));

test("the hash is stable, and moves for SKILL.md and a named agent but not for evals.md, skill test files or an unnamed agent", () => {
  const root = fakeRepo();
  const before = skillHash(root, "demo");
  assert.equal(skillHash(root, "demo"), before);
  write(root, "plugin/skills/demo/evals.md", `${EVALS}\nmore\n`);
  write(root, "plugin/skills/demo/scripts/tool.test.sh", "echo changed test\n");
  write(root, "plugin/agents/other.md", "other v2\n");
  assert.equal(skillHash(root, "demo"), before);
  write(root, "plugin/agents/bot.md", "bot v2\n");
  const afterAgent = skillHash(root, "demo");
  assert.notEqual(afterAgent, before);
  write(root, "plugin/skills/demo/SKILL.md", "# demo\nDispatches the bot agent. Changed.\n");
  assert.notEqual(skillHash(root, "demo"), afterAgent);
});

test("a skill is changed by its own files and its named agents, not by evals.md or an unnamed agent", () => {
  const root = fakeRepo();
  assert.deepEqual(changedSkills(root, BASE), []);
  write(root, "plugin/skills/demo/evals.md", `${EVALS}\nmore\n`);
  write(root, "plugin/agents/other.md", "other v2\n");
  commitAll(root);
  assert.deepEqual(changedSkills(root, BASE), []);
  write(root, "plugin/agents/bot.md", "bot v2\n");
  assert.deepEqual(changedSkills(root, BASE), ["demo"]);
  commitAll(root);
  assert.deepEqual(changedSkills(root, BASE), ["demo"]);
});

test("an uncommitted skill edit counts as a change", () => {
  const root = fakeRepo();
  write(root, "plugin/skills/demo/SKILL.md", "# demo\nDispatches the bot agent. Edited.\n");
  assert.deepEqual(changedSkills(root, BASE), ["demo"]);
});

const probeCalls = (root) => {
  const log = join(root, "stub-log", "calls.probe");
  return existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line)) : [];
};

test("exit 3 and a SKIPPED line when the probe run reports is_error, and no eval runs", () => {
  const root = fakeRepo();
  write(root, "plugin/skills/demo/SKILL.md", "# demo\nbot. Edited.\n");
  const result = runChangedSkills(root, [], { STUB_PROBE: "error" });
  assert.equal(result.status, 3);
  assert.match(result.stdout, /SKIPPED: claude cannot run with the eval flags: Not logged in/);
  assert.match(result.stdout, /ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN/);
  assert.equal(probeCalls(root).length, 1);
  assert.deepEqual(claudeCalls(root), []);
  assert.equal(existsSync(join(root, "evals", "results")), false);
});

test("exit 3 when the probe prints something that is not JSON", () => {
  const root = fakeRepo();
  write(root, "plugin/skills/demo/SKILL.md", "# demo\nbot. Edited.\n");
  const result = runChangedSkills(root, [], { STUB_PROBE: "garbage" });
  assert.equal(result.status, 3);
  assert.match(result.stdout, /SKIPPED: .*gateway error/);
  assert.deepEqual(claudeCalls(root), []);
});

test("a good probe proceeds, and it runs with the eval flags, a cap, the model and its own directory", () => {
  const root = fakeRepo();
  write(root, "plugin/skills/demo/SKILL.md", "# demo\nbot. Edited.\n");
  const result = runChangedSkills(root, ["--model", "haiku"]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const [probe] = probeCalls(root);
  assert.equal(probe.args[probe.args.indexOf("--setting-sources") + 1], "");
  assert.equal(probe.args[probe.args.indexOf("--max-budget-usd") + 1], "0.05");
  assert.equal(probe.args[probe.args.indexOf("--model") + 1], "haiku");
  assert.notEqual(probe.cwd, root);
  assert.equal(existsSync(probe.cwd), false);
  assert.equal(claudeCalls(root).length, 1);
});

test("exit 3 when the claude binary is missing", () => {
  const root = fakeRepo();
  write(root, "plugin/skills/demo/SKILL.md", "# demo\nbot. Edited.\n");
  const result = runChangedSkills(root, [], { GATED_DELIVERY_CLAUDE_BIN: join(root, "bin", "absent") });
  assert.equal(result.status, 3);
  assert.match(result.stdout, /SKIPPED/);
});

test("exit 0 with nothing to run when no skill changed", () => {
  const root = fakeRepo();
  const result = runChangedSkills(root);
  assert.equal(result.status, 0);
  assert.deepEqual(claudeCalls(root), []);
});

test("a passing smoke run exits 0 and writes the stamp, with the smoke budget flags on every run", () => {
  const root = fakeRepo();
  write(root, "plugin/skills/demo/SKILL.md", "# demo\nbot. Edited.\n");
  const result = runChangedSkills(root);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const stamp = stampOf(root);
  assert.equal(stamp.hash, skillHash(root, "demo"));
  assert.equal(stamp.tier, "smoke");
  assert.deepEqual(stamp.scenarios, ["1"]);
  assert.deepEqual(stamp.verdicts, { 1: "pass" });
  assert.ok(stamp.totalCostUsd > 0);
  assert.ok(!Number.isNaN(Date.parse(stamp.ranAt)));
  const [call] = claudeCalls(root);
  assert.equal(call[call.indexOf("--max-budget-usd") + 1], "2");
  assert.equal(claudeCalls(root).length, 1);
});

test("a failing run exits 1 and writes no stamp", () => {
  const root = fakeRepo();
  write(root, "plugin/skills/demo/SKILL.md", "# demo\nbot. Edited.\n");
  const result = runChangedSkills(root, [], { STUB_OUTPUT: "nope" });
  assert.equal(result.status, 1);
  assert.equal(existsSync(join(root, "evals", "results")), false);
  assert.equal(claudeCalls(root).length, 2);
});

test("a flaky scenario passes, is printed, and is stamped", () => {
  const root = fakeRepo();
  write(root, "plugin/skills/demo/SKILL.md", "# demo\nbot. Edited.\n");
  const result = runChangedSkills(root, [], { STUB_RECOVER: "1" });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /FLAKY demo 1/);
  assert.deepEqual(stampOf(root).verdicts, { 1: "flaky" });
});

test("--full runs every scenario twice with no smoke caps and stamps the full tier", () => {
  const root = fakeRepo();
  write(root, "plugin/skills/demo/SKILL.md", "# demo\nbot. Edited.\n");
  const result = runChangedSkills(root, ["--full"]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(stampOf(root).tier, "full");
  assert.equal(claudeCalls(root).length, 2);
  assert.equal(claudeCalls(root)[0].includes("--max-budget-usd"), false);
});

test("--budget-usd overrides the smoke default", () => {
  const root = fakeRepo();
  write(root, "plugin/skills/demo/SKILL.md", "# demo\nbot. Edited.\n");
  runChangedSkills(root, ["--budget-usd", "7"]);
  const [call] = claudeCalls(root);
  assert.equal(call[call.indexOf("--max-budget-usd") + 1], "7");
  assert.deepEqual(readdirSync(join(root, "evals", "results")), ["demo.json"]);
});
