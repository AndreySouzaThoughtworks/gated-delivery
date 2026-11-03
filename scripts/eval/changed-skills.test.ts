import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { changedSkills, skillHash, stampStatus } from "./changed-skills.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT_NAMES = ["changed-skills.ts", "run-scenarios.ts", "run-checks.ts", "judge-model.ts"];
const EXECUTABLE_MODE = 0o755;
const BASE = "main";
const FEATURE_BRANCH = "feature";
const SHA256_HEX = /^[0-9a-f]{64}$/;
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
  if (process.env.STUB_PROBE === "error-no-result") { console.log(JSON.stringify({ is_error: true })); return; }
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

const git = (cwd: string, args: string[]) => {
  assert(existsSync(cwd), `git ran in ${cwd}, which does not exist; expected an existing repository folder`);
  assert(args.length > 0, `git got ${JSON.stringify(args)}; expected at least one subcommand argument`);
  return execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, ...GIT_IDENTITY } });
};

const write = (root: string, path: string, body: string) => {
  assert(!isAbsolute(path), `write got absolute path ${path}; expected a path relative to the fake repository`);
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), body);
  assert(readFileSync(join(root, path), "utf8") === body, `${path} does not hold what write put there`);
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
  git(root, ["checkout", "-b", FEATURE_BRANCH]);
  assert(git(root, ["rev-parse", "--abbrev-ref", "HEAD"]).trim() === FEATURE_BRANCH, "fakeRepo left HEAD off the feature branch; expected changes to be measured against the base branch");
  assert(git(root, ["status", "--porcelain"]) === "", "fakeRepo left uncommitted files; expected a clean tree so tests see only their own edits");
  return root;
};

const commitAll = (root: string) => {
  const pending = git(root, ["status", "--porcelain"]);
  assert(pending !== "", `commitAll got status ${JSON.stringify(pending)}; expected uncommitted edits, so the test must edit a file first`);
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "change"]);
  assert(git(root, ["status", "--porcelain"]) === "", "commitAll left uncommitted files; expected a clean tree after the commit");
};

const claudeCalls = (root: string) => {
  assert(existsSync(join(root, "stub-log")), `claudeCalls found no stub-log folder under ${JSON.stringify(root)}; expected fakeRepo to create it`);
  const log = join(root, "stub-log", "calls");
  const calls = existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line)) : [];
  const emptyCalls = calls.filter((call) => call.length === 0);
  assert(emptyCalls.length === 0, `claudeCalls read ${emptyCalls.length} calls with no arguments; expected every logged call to carry its argv`);
  return calls;
};

const runChangedSkills = (root: string, args: string[] = [], env: Record<string, string> = {}) => {
  assert(existsSync(join(root, "bin", "claude")), `runChangedSkills found no stub claude under ${JSON.stringify(root)}; expected fakeRepo to install one`);
  const result = spawnSync("node", ["scripts/eval/changed-skills.ts", ...args], {
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
  assert(result.error === undefined, `changed-skills.ts did not start: ${result.error?.message}`);
  assert(result.signal === null, `changed-skills.ts was killed by ${result.signal}; expected it to exit on its own`);
  return result;
};

const stampOf = (root: string) => {
  const stampFile = join(root, "evals", "results", "demo.json");
  assert(existsSync(stampFile), `stampOf found no stamp at ${JSON.stringify(stampFile)}; expected the run to have written one`);
  const stamp = JSON.parse(readFileSync(stampFile, "utf8"));
  assert(SHA256_HEX.test(stamp.hash), `the stamp hash is ${JSON.stringify(stamp.hash)}; expected 64 lowercase hex characters from skillHash`);
  return stamp;
};

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

test("hash and stamp lookups reject a skill name that is a path or empty, and changedSkills a blank base ref", () => {
  const root = fakeRepo();
  for (const skill of ["", "..", "../escape", "nested/skill"]) {
    assert.throws(() => skillHash(root, skill), /needs a skill folder name/);
    assert.throws(() => stampStatus(root, skill), /needs a skill folder name/);
  }
  assert.throws(() => changedSkills(root, ""), /needs a base ref/);
});

test("an uncommitted skill edit counts as a change", () => {
  const root = fakeRepo();
  write(root, "plugin/skills/demo/SKILL.md", "# demo\nDispatches the bot agent. Edited.\n");
  assert.deepEqual(changedSkills(root, BASE), ["demo"]);
});

const probeCalls = (root: string) => {
  assert(existsSync(join(root, "stub-log")), `probeCalls found no stub-log folder under ${JSON.stringify(root)}; expected fakeRepo to create it`);
  const log = join(root, "stub-log", "calls.probe");
  const calls = existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line)) : [];
  const nonProbeCalls = calls.filter((call) => !call.args.includes("--output-format"));
  assert(nonProbeCalls.length === 0, `probeCalls read ${nonProbeCalls.length} calls without --output-format; expected only probe runs in this log`);
  return calls;
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

test("a probe reply with is_error and no result prints a readable reason, not undefined", () => {
  const root = fakeRepo();
  write(root, "plugin/skills/demo/SKILL.md", "# demo\nbot. Edited.\n");
  const result = runChangedSkills(root, [], { STUB_PROBE: "error-no-result" });
  assert.equal(result.status, 3);
  assert.match(result.stdout, /SKIPPED: claude cannot run with the eval flags: claude reported an error and gave no detail/);
  assert.doesNotMatch(result.stdout, /undefined/);
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

test("the stamp names the model that ran the scenarios and the one that judged, and the default names neither as Claude", () => {
  const glm = fakeRepo();
  write(glm, "plugin/skills/demo/SKILL.md", "# demo\nbot. Edited.\n");
  const glmRun = runChangedSkills(glm, ["--model", "glm-5.3-flash[1m]"], { GATED_DELIVERY_JUDGE_MODEL: "glm-5.3" });
  assert.equal(glmRun.status, 0, glmRun.stdout + glmRun.stderr);
  assert.equal(stampOf(glm).model, "glm-5.3-flash[1m]");
  assert.equal(stampOf(glm).judgeModel, "glm-5.3");
  const plain = fakeRepo();
  write(plain, "plugin/skills/demo/SKILL.md", "# demo\nbot. Edited.\n");
  const plainRun = runChangedSkills(plain, [], { GATED_DELIVERY_JUDGE_MODEL: "", GATED_DELIVERY_RUN_MODEL: "" });
  assert.equal(plainRun.status, 0, plainRun.stdout + plainRun.stderr);
  assert.equal(stampOf(plain).model, "unset (the provider default)");
  assert.equal(stampOf(plain).judgeModel, "haiku");
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

const writeStamp = (root: string, stamp: Record<string, unknown>) => {
  assert(existsSync(root), `writeStamp got ${root}, which does not exist; expected a fake repository`);
  assert(Object.hasOwn(stamp, "hash"), `writeStamp got ${JSON.stringify(stamp)}; expected every stamp to carry the hash it vouches for`);
  write(root, "evals/results/demo.json", JSON.stringify(stamp));
  assert(readFileSync(join(root, "evals", "results", "demo.json"), "utf8") === JSON.stringify(stamp), "the stamp on disk differs from the one written");
};

test("stampStatus: a waiver with the current hash is waived, a stale or blank one is not", () => {
  const root = fakeRepo();
  const hash = skillHash(root, "demo");
  assert.equal(stampStatus(root, "demo"), "missing");
  writeStamp(root, { hash });
  assert.equal(stampStatus(root, "demo"), "ok");
  writeStamp(root, { hash, waived: "no credentials" });
  assert.equal(stampStatus(root, "demo"), "waived");
  writeStamp(root, { hash: "old", waived: "no credentials" });
  assert.equal(stampStatus(root, "demo"), "stale");
  for (const waived of ["", "   ", 7, null]) {
    writeStamp(root, { hash, waived });
    assert.equal(stampStatus(root, "demo"), "blank-waiver");
  }
});

test("--waive writes the waiver for the current hash and exits 0 without running claude", () => {
  const root = fakeRepo();
  const result = runChangedSkills(root, ["--waive", "demo", "--reason", "no credentials"]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const stamp = stampOf(root);
  assert.equal(stamp.hash, skillHash(root, "demo"));
  assert.equal(stamp.waived, "no credentials");
  assert.ok(!Number.isNaN(Date.parse(stamp.ranAt)));
  assert.equal(stampStatus(root, "demo"), "waived");
  assert.deepEqual(claudeCalls(root), []);
  assert.deepEqual(probeCalls(root), []);
});

test("--waive rejects a missing or blank reason, an unknown skill and extra arguments, and writes nothing", () => {
  const root = fakeRepo();
  const bad = [
    ["--waive", "demo"],
    ["--waive", "demo", "--reason", "  "],
    ["--waive", "ghost", "--reason", "x"],
    ["--waive", "demo", "--reason", "x", "other"],
    ["--waive", "demo", "--reason", "x", "--full"],
    ["--reason", "x"],
  ];
  for (const args of bad) {
    const result = runChangedSkills(root, args);
    assert.equal(result.status, 2, args.join(" "));
  }
  assert.equal(existsSync(join(root, "evals", "results")), false);
});

test("a skill name that is a path, empty or unknown is a usage error before the probe, with no stack", () => {
  const root = fakeRepo();
  for (const name of ["a/b", "demo/../demo", "..", ".", "", "nope"]) {
    const result = runChangedSkills(root, [name]);
    assert.equal(result.status, 2, `${JSON.stringify(name)}: ${result.stdout}${result.stderr}`);
    assert.doesNotMatch(result.stderr, /AssertionError|ENOENT/);
  }
  assert.deepEqual(probeCalls(root), []);
  assert.deepEqual(claudeCalls(root), []);
});

test("--waive with a skill that reaches SKILL.md through .. is a usage error and writes nothing", () => {
  const root = fakeRepo();
  const result = runChangedSkills(root, ["--waive", "demo/../demo", "--reason", "x"]);
  assert.equal(result.status, 2, result.stdout + result.stderr);
  assert.match(result.stderr, /not a skill name/);
  assert.doesNotMatch(result.stderr, /AssertionError/);
  assert.equal(existsSync(join(root, "evals", "results")), false);
});

test("a failure inside the harness exits 4, not 1 which means evals failed", () => {
  const root = fakeRepo();
  write(root, "evals/results", "a file where the stamp folder belongs\n");
  const result = runChangedSkills(root, ["--waive", "demo", "--reason", "x"]);
  assert.equal(result.status, 4, result.stdout + result.stderr);
  assert.match(result.stderr, /EEXIST|ENOTDIR/);
});
