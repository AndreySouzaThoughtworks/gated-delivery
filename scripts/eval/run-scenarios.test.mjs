import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  disagreements,
  fillTemplate,
  harnessFlags,
  parseEvals,
  summaryTsv,
} from "./run-scenarios.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNNER = join(HERE, "run-scenarios.mjs");
const SKILL = "demo";

const EVALS = `# Evals: demo

## Execution Model

mode: response

## Client context used by every scenario

\`\`\`markdown
## Issue tracking
- **Tracker:** \`jira\`
\`\`\`

## Test Scenarios

| # | Prompt | Persona | Pass Criteria |
|---|--------|---------|---------------|
| 1 | "Do the thing." | Plain persona one. | Does the thing. |
| 2 | "Fix it." | Row persona two. | Fixes it. |

### Later group

| # | Prompt | Persona | Pass Criteria |
|---|--------|---------|---------------|
| G1 | "Grouped." | Persona with $& and $1 in it. | Grouped. |

## Agent Prompt Templates

### Baseline Agent (no skill)
\`\`\`
BASELINE NO SKILL.
USER: {{PROMPT}}
CONTEXT: {{PERSONA}}
\`\`\`

### Skill Agent
\`\`\`
MANDATORY FIRST STEP: Invoke Skill("gated-delivery:demo"). Then follow it.
USER: {{PROMPT}}
CONTEXT: {{PERSONA}}
\`\`\`

## Deterministic Checks

\`\`\`bash
grep -c thing output.md
\`\`\`
`;

const SKILL_TOOL_USE = JSON.stringify({
  type: "assistant",
  message: { content: [{ type: "tool_use", name: "Skill", input: { skill: "gated-delivery:demo" } }] },
});
const resultLine = (fields = {}) =>
  JSON.stringify({ type: "result", result: "done", total_cost_usd: 0.25, permission_denials: [], ...fields });

const STUB_CLAUDE = `#!/usr/bin/env node
const { writeFileSync } = require("node:fs");
const { join } = require("node:path");
const behaviour = process.env.STUB_BEHAVIOUR || "skill";
const id = process.cwd().split("/").slice(-3).join("_");
writeFileSync(join(process.env.STUB_LOG, id + ".json"), JSON.stringify({ cwd: process.cwd(), argv: process.argv.slice(2), path: process.env.PATH, pid: process.pid, tmpdir: process.env.TMPDIR }));
const skillUse = ${JSON.stringify(SKILL_TOOL_USE)};
const result = (extra) => JSON.stringify({ type: "result", result: "did the thing", total_cost_usd: 0.25, permission_denials: [], ...extra });
writeFileSync(join(process.env.TMPDIR, "scratch.txt"), "x");
if (behaviour === "pages") { writeFileSync("page.html", "thing"); writeFileSync(join(process.env.TMPDIR, "narrow.html"), "nope"); }
if (behaviour === "sleep") { setTimeout(() => {}, 60000); return; }
if (behaviour === "denynoskill") { console.log(result({ permission_denials: [{ tool_name: "Bash" }] })); return; }
if (behaviour === "noskill") { console.log(result()); return; }
if (behaviour === "deny") { console.log(skillUse); console.log(result({ permission_denials: [{ tool_name: "Bash" }] })); return; }
if (behaviour === "readskill") { console.log(JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Read", input: { file_path: "/x/plugin/skills/demo/SKILL.md" } }] } })); console.log(result()); return; }
if (behaviour === "alternate") { const n = Number(process.cwd().slice(-1)); console.log(skillUse); console.log(result({ result: n % 2 ? "thing" : "nope" })); return; }
console.log(skillUse);
console.log(result());
`;

const writeExecutable = (path, body) => {
  writeFileSync(path, body);
  chmodSync(path, 0o755);
};

const fakeRepo = ({ evals = EVALS, fixtures = {}, graders = false } = {}) => {
  const root = mkdtempSync(join(tmpdir(), "gated-delivery-runner-"));
  const skillDir = join(root, "plugin", "skills", SKILL);
  mkdirSync(join(root, "plugin", ".claude-plugin"), { recursive: true });
  writeFileSync(join(root, "plugin", ".claude-plugin", "plugin.json"), '{"name":"gated-delivery"}\n');
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, "SKILL.md"), "# demo\n");
  writeFileSync(join(skillDir, "evals.md"), evals);
  for (const [path, body] of Object.entries(fixtures)) {
    const target = join(root, "evals", "fixtures", SKILL, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, body);
  }
  mkdirSync(join(root, "scripts", "eval"), { recursive: true });
  copyFileSync(RUNNER, join(root, "scripts", "eval", "run-scenarios.mjs"));
  if (graders) {
    writeFileSync(
      join(root, "scripts", "eval", "run-checks.mjs"),
      `import { readFileSync } from "node:fs";
const [skill, file, flag, id] = process.argv.slice(2);
if (flag !== "--scenario" || !id) process.exit(2);
process.exit(readFileSync(file, "utf8").includes("thing") ? 0 : 1);
`,
    );
    writeFileSync(
      join(root, "scripts", "eval", "judge.mjs"),
      `import { existsSync } from "node:fs";
import { join } from "node:path";
const [skill, id, runDir] = process.argv.slice(2);
if (!existsSync(join(runDir, "output.md")) || !existsSync(join(runDir, "transcript.jsonl"))) process.exit(2);
console.log(JSON.stringify({ verdict: id === "2" ? "UNCLEAR" : "PASS", clauses: [] }));
process.exit(id === "2" ? 3 : 0);
`,
    );
  }
  const bin = join(root, "bin");
  mkdirSync(bin);
  writeExecutable(join(bin, "claude"), STUB_CLAUDE);
  const log = join(root, "stub-log");
  mkdirSync(log);
  return { root, skillDir, claude: join(bin, "claude"), log };
};

const run = (repo, args, env = {}) => {
  const out = join(repo.root, "out");
  const result = spawnSync("node", ["scripts/eval/run-scenarios.mjs", SKILL, ...args, "--out", out], {
    cwd: repo.root,
    encoding: "utf8",
    env: {
      ...process.env,
      GATED_DELIVERY_CLAUDE_BIN: repo.claude,
      STUB_LOG: repo.log,
      STUB_BEHAVIOUR: "skill",
      ...env,
    },
  });
  return { ...result, out };
};

const stubCalls = (repo) =>
  readdirSync(repo.log).map((f) => JSON.parse(readFileSync(join(repo.log, f), "utf8")));

const promptOf = (call) => call.argv[call.argv.indexOf("-p") + 1];

const summaryRows = (out) =>
  readFileSync(join(out, "summary.tsv"), "utf8")
    .trim()
    .split("\n")
    .slice(1)
    .map((line) => {
      const [skill, id, arm, runNo, harness, checks, judge, cost, secs] = line.split("\t");
      return { skill, id, arm, run: runNo, harness, checks, judge, cost, secs };
    });

test("parses every scenario row across grouped tables", () => {
  const { rows } = parseEvals(EVALS);
  assert.deepEqual(
    rows.map((r) => r.id),
    ["1", "2", "G1"],
  );
  assert.equal(rows[0].prompt, "Do the thing.");
  assert.equal(rows[1].persona, "Row persona two.");
  assert.equal(rows[1].pass, "Fixes it.");
});

test("reads both templates, the client context and the execution mode", () => {
  const parsed = parseEvals(EVALS);
  assert.match(parsed.skillTemplate, /^MANDATORY FIRST STEP/);
  assert.match(parsed.baselineTemplate, /^BASELINE NO SKILL/);
  assert.equal(parsed.clientContext, "## Issue tracking\n- **Tracker:** `jira`\n");
  assert.equal(parsed.responseMode, true);
});

test("a skill without a client block, a baseline template or response mode reports none", () => {
  const bare = EVALS.replace(/## Client context[\s\S]*?## Test Scenarios/, "## Test Scenarios")
    .replace(/### Baseline Agent[\s\S]*?### Skill Agent/, "### Skill Agent")
    .replace("mode: response", "mode: artifact");
  const parsed = parseEvals(bare);
  assert.equal(parsed.clientContext, null);
  assert.equal(parsed.baselineTemplate, null);
  assert.equal(parsed.responseMode, false);
});

test("fills the placeholders literally, even when the persona holds replacement patterns", () => {
  const filled = fillTemplate("USER: {{PROMPT}}\nCONTEXT: {{PERSONA}}", "go", "costs $& and $1");
  assert.equal(filled, "USER: go\nCONTEXT: costs $& and $1");
});

test("flags a skill run that never invoked the skill, and passes one that did", () => {
  const withSkill = `${SKILL_TOOL_USE}\n${resultLine()}\n`;
  assert.deepEqual(harnessFlags({ transcript: withSkill, arm: "skill", skill: SKILL, timedOut: false }), []);
  assert.deepEqual(harnessFlags({ transcript: `${resultLine()}\n`, arm: "skill", skill: SKILL, timedOut: false }), [
    "no-skill",
  ]);
});

test("notes how many permissions were denied, and stays quiet on an empty list", () => {
  const denied = `${SKILL_TOOL_USE}\n${resultLine({ permission_denials: [{ tool_name: "Bash" }, { tool_name: "Read" }] })}\n`;
  assert.deepEqual(harnessFlags({ transcript: denied, arm: "skill", skill: SKILL, timedOut: false }), ["denied=2"]);
  const clean = `${SKILL_TOOL_USE}\n${resultLine()}\n`;
  assert.deepEqual(harnessFlags({ transcript: clean, arm: "skill", skill: SKILL, timedOut: false }), []);
});

test("flags a timeout and a run with no result line", () => {
  const flags = harnessFlags({ transcript: `${SKILL_TOOL_USE}\n`, arm: "skill", skill: SKILL, timedOut: true });
  assert.deepEqual(flags, ["no-result", "timeout"]);
});

test("flags a baseline that read the skill's text, and not one that stayed away", () => {
  const read = `{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{"file_path":"/p/skills/demo/SKILL.md"}}]}}\n${resultLine()}\n`;
  assert.deepEqual(harnessFlags({ transcript: read, arm: "baseline", skill: SKILL, timedOut: false }), ["read-skill"]);
  assert.deepEqual(harnessFlags({ transcript: `${resultLine()}\n`, arm: "baseline", skill: SKILL, timedOut: false }), []);
});

test("a scenario whose repeats disagree is flagged, and one whose repeats agree is not", () => {
  const base = { skill: SKILL, arm: "skill", harness: "ok", cost: "0", secs: "1" };
  const rows = [
    { ...base, id: "1", run: 1, checks: "PASS", judge: "PASS" },
    { ...base, id: "1", run: 2, checks: "PASS", judge: "PASS" },
    { ...base, id: "2", run: 1, checks: "PASS", judge: "PASS" },
    { ...base, id: "2", run: 2, checks: "FAIL", judge: "PASS" },
  ];
  assert.deepEqual(
    disagreements(rows).map((d) => d.id),
    ["2"],
  );
});

test("the summary has a header and one tab-separated line per run", () => {
  const tsv = summaryTsv([
    { skill: SKILL, id: "1", arm: "skill", run: 1, harness: "ok", checks: "PASS", judge: "n/a", cost: "0.25", secs: "3" },
  ]);
  assert.equal(tsv, "skill\tid\tarm\trun\tharness\tchecks\tjudge\tcost\tsecs\ndemo\t1\tskill\t1\tok\tPASS\tn/a\t0.25\t3\n");
});

test("runs each selected scenario N times with the documented flags", () => {
  const repo = fakeRepo();
  const { status, out, stderr } = run(repo, ["--scenario", "1", "--repeat", "2", "--jobs", "2"]);
  assert.equal(status, 0, stderr);
  const calls = stubCalls(repo);
  assert.equal(calls.length, 2);
  const snapshot = join(out, "plugin");
  for (const call of calls) {
    for (const flag of ["--strict-mcp-config", "--verbose", "--allowedTools"]) assert.ok(call.argv.includes(flag), flag);
    const pairs = [
      ["--plugin-dir", snapshot],
      ["--add-dir", snapshot],
      ["--setting-sources", "project,local"],
      ["--permission-mode", "acceptEdits"],
      ["--output-format", "stream-json"],
    ];
    for (const [flag, value] of pairs) assert.equal(call.argv[call.argv.indexOf(flag) + 1], value, flag);
    assert.ok(!call.argv.includes("--max-budget-usd"), "no spend cap");
    assert.ok(call.argv.includes("Bash(grep:*)"));
  }
});

const addDirs = (argv) => {
  const dirs = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== "--add-dir") continue;
    while (argv[i + 1] !== undefined && !argv[i + 1].startsWith("--")) dirs.push(argv[++i]);
  }
  return dirs;
};

for (const arm of ["skill", "baseline"]) {
  test(`a ${arm} run's --add-dir stays inside its own tree${arm === "skill" ? ", bar the snapshot" : ""}`, () => {
    const repo = fakeRepo();
    const args = ["--scenario", "1", "--repeat", "1", ...(arm === "baseline" ? ["--baseline"] : [])];
    const { out } = run(repo, args, { STUB_BEHAVIOUR: arm === "skill" ? "skill" : "noskill" });
    const [call] = stubCalls(repo);
    const runDir = join(out, SKILL, "1", `${arm}-1`);
    const allowed = arm === "skill" ? [join(out, "plugin")] : [];
    const dirs = addDirs(call.argv);
    assert.ok(dirs.length > 0);
    for (const dir of dirs) {
      assert.ok(allowed.includes(dir) || dir.startsWith(`${runDir}.`) || dir.startsWith(`${runDir}/`), dir);
    }
  });
}

test("each run gets its own temp dir as TMPDIR, kept in the run dir afterwards", () => {
  const repo = fakeRepo();
  const { out } = run(repo, ["--scenario", "1", "--repeat", "2"]);
  const calls = stubCalls(repo);
  const temps = calls.map((call) => call.tmpdir);
  assert.equal(new Set(temps).size, 2);
  for (const call of calls) {
    assert.ok(addDirs(call.argv).includes(call.tmpdir), "TMPDIR is writable to the run");
    assert.match(call.tmpdir, new RegExp(`^${join(out, SKILL, "1", "skill-")}[12]\\.`), "TMPDIR belongs to the run");
  }
  assert.ok(existsSync(join(out, SKILL, "1", "skill-1", "run-tmp", "scratch.txt")));
});

test("fills the Skill Agent template with the row, writes the persona and the client block", () => {
  const repo = fakeRepo();
  const { out } = run(repo, ["--scenario", "1", "--repeat", "1"]);
  const [call] = stubCalls(repo);
  const prompt = promptOf(call);
  assert.match(prompt, /^MANDATORY FIRST STEP: Invoke Skill\("gated-delivery:demo"\)/);
  assert.match(prompt, /USER: Do the thing\.\nCONTEXT: Plain persona one\./);
  assert.match(prompt, /EVAL HARNESS \(execution model: response\)/);
  const runDir = join(out, SKILL, "1", "skill-1");
  assert.equal(readFileSync(join(runDir, "persona.md"), "utf8"), "Plain persona one.\n");
  assert.equal(readFileSync(join(runDir, "CLAUDE.md"), "utf8"), "## Issue tracking\n- **Tracker:** `jira`\n");
  assert.equal(readFileSync(join(runDir, "output.md"), "utf8"), "did the thing\n");
  assert.ok(existsSync(join(runDir, "transcript.jsonl")));
  assert.equal(readFileSync(join(runDir, "prompt.txt"), "utf8"), prompt);
});

test("a skill outside response mode gets no harness line", () => {
  const repo = fakeRepo({ evals: EVALS.replace("mode: response", "mode: artifact") });
  run(repo, ["--scenario", "1", "--repeat", "1"]);
  assert.doesNotMatch(promptOf(stubCalls(repo)[0]), /EVAL HARNESS/);
});

test("--baseline fills the Baseline template and gives the run no plugin", () => {
  const repo = fakeRepo();
  const { out } = run(repo, ["--scenario", "1", "--repeat", "1", "--baseline"], { STUB_BEHAVIOUR: "noskill" });
  const [call] = stubCalls(repo);
  assert.match(promptOf(call), /^BASELINE NO SKILL\./);
  assert.ok(!call.argv.includes("--plugin-dir"));
  assert.ok(!call.argv.some((a) => a.startsWith(join(out, "plugin"))), "no --add-dir reaches the snapshot");
  assert.ok(!existsSync(join(out, "plugin")), "a temp --add-dir above the out dir must not reach a plugin copy");
  const [row] = summaryRows(out);
  assert.equal(row.arm, "baseline");
  assert.equal(row.harness, "ok");
});

test("--baseline on a skill with no Baseline template is a usage error", () => {
  const repo = fakeRepo({ evals: EVALS.replace(/### Baseline Agent[\s\S]*?### Skill Agent/, "### Skill Agent") });
  const { status, stderr } = run(repo, ["--baseline"]);
  assert.equal(status, 2);
  assert.match(stderr, /Baseline/);
});

test("an unknown scenario id is a usage error", () => {
  const repo = fakeRepo();
  const { status, stderr } = run(repo, ["--scenario", "99"]);
  assert.equal(status, 2);
  assert.match(stderr, /99/);
});

test("the snapshot leaves out evals.md", () => {
  const repo = fakeRepo({ fixtures: { "2/notes.txt": "fixture file\n" } });
  const { out } = run(repo, ["--scenario", "1", "--repeat", "1"]);
  const snapSkill = join(out, "plugin", "skills", SKILL);
  assert.ok(existsSync(join(snapSkill, "SKILL.md")));
  assert.ok(!existsSync(join(snapSkill, "evals.md")));
});

test("copies a scenario's fixture, runs its setup.sh, and applies its extra rules and bin", () => {
  const repo = fakeRepo({
    fixtures: {
      "2/notes.txt": "fixture file\n",
      "2/persona.md": "Fixture persona.\n",
      "2/allowed-tools": "Bash(sh tracker.sh:*)\n",
      "2/setup.sh": 'test -f "$1/setup.sh" && echo built > built.txt && mkdir -p bin\n',
    },
  });
  const { out } = run(repo, ["--scenario", "2", "--repeat", "1"]);
  const runDir = join(out, SKILL, "2", "skill-1");
  assert.equal(readFileSync(join(runDir, "notes.txt"), "utf8"), "fixture file\n");
  assert.equal(readFileSync(join(runDir, "built.txt"), "utf8"), "built\n");
  assert.ok(!existsSync(join(runDir, "setup.sh")));
  assert.ok(!existsSync(join(runDir, "allowed-tools")));
  const [call] = stubCalls(repo);
  assert.ok(call.argv.includes("Bash(sh tracker.sh:*)"));
  assert.ok(call.path.startsWith(`${join(runDir, "bin")}:`));
  const prompt = promptOf(call);
  assert.match(prompt, /CONTEXT: Fixture persona\./);
  assert.doesNotMatch(prompt, /EVAL HARNESS/, "a fixture is reachable, so the no-fixture line would lie");
});

test("a scenario without a fixture keeps the default rules and PATH", () => {
  const repo = fakeRepo({ fixtures: { "2/allowed-tools": "Bash(sh tracker.sh:*)\n" } });
  run(repo, ["--scenario", "1", "--repeat", "1"]);
  const [call] = stubCalls(repo);
  assert.ok(!call.argv.includes("Bash(sh tracker.sh:*)"));
  assert.equal(call.path, process.env.PATH);
});

test("a failing setup.sh is a harness failure and the model is not called", () => {
  const repo = fakeRepo({ fixtures: { "2/setup.sh": "exit 4\n" } });
  const { status, out } = run(repo, ["--scenario", "2", "--repeat", "1"]);
  assert.equal(status, 1);
  assert.equal(stubCalls(repo).length, 0);
  assert.equal(summaryRows(out)[0].harness, "setup-failed");
});

test("graders that are not installed are marked n/a without crashing", () => {
  const repo = fakeRepo();
  const { status, out } = run(repo, ["--scenario", "1", "--repeat", "1"]);
  assert.equal(status, 0);
  const [row] = summaryRows(out);
  assert.deepEqual([row.checks, row.judge], ["n/a", "n/a"]);
  assert.equal(row.cost, "0.25");
});

test("grades through the run-checks and judge CLIs and records their verdicts", () => {
  const repo = fakeRepo({ graders: true });
  const { out, stdout } = run(repo, ["--scenario", "1", "--scenario", "2", "--repeat", "1"]);
  const rows = summaryRows(out);
  assert.deepEqual(
    rows.map((r) => [r.id, r.checks, r.judge]),
    [
      ["1", "PASS", "PASS"],
      ["2", "PASS", "UNCLEAR"],
    ],
  );
  assert.match(readFileSync(join(out, SKILL, "2", "skill-1", "judge.json"), "utf8"), /UNCLEAR/);
  assert.match(stdout, /skill\s+id\s+arm/);
});

test("grades the pages the run delivered, not scratch pages in its temp dir", () => {
  const repo = fakeRepo({ graders: true });
  const { out } = run(repo, ["--scenario", "1", "--repeat", "1"], { STUB_BEHAVIOUR: "pages" });
  const graded = readFileSync(join(out, SKILL, "1", "skill-1", "checks.txt"), "utf8");
  assert.match(graded, /page\.html/);
  assert.doesNotMatch(graded, /narrow\.html/);
  assert.equal(summaryRows(out)[0].checks, "PASS");
});

test("prints a disagreement when repeats of a scenario grade differently", () => {
  const repo = fakeRepo({ graders: true });
  const { stdout, out } = run(repo, ["--scenario", "1", "--repeat", "2"], { STUB_BEHAVIOUR: "alternate" });
  assert.deepEqual(
    summaryRows(out).map((r) => r.checks).sort(),
    ["FAIL", "PASS"],
  );
  assert.match(stdout, /DISAGREE demo 1 skill/);
});

test("a run past the wall-clock limit is stopped and flagged", () => {
  const repo = fakeRepo();
  const { out, status } = run(repo, ["--scenario", "1", "--repeat", "1"], {
    STUB_BEHAVIOUR: "sleep",
    GATED_DELIVERY_RUN_TIMEOUT_SECONDS: "1",
  });
  assert.equal(status, 1);
  assert.match(summaryRows(out)[0].harness, /timeout/);
});

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const waitFor = async (condition) => {
  for (let i = 0; i < 100 && !condition(); i++) await new Promise((r) => setTimeout(r, 50));
  return condition();
};

test("stopping the runner stops the sessions it started", async () => {
  const repo = fakeRepo();
  const runner = spawn("node", ["scripts/eval/run-scenarios.mjs", SKILL, "--scenario", "1", "--repeat", "1", "--out", join(repo.root, "out")], {
    cwd: repo.root,
    env: { ...process.env, GATED_DELIVERY_CLAUDE_BIN: repo.claude, STUB_LOG: repo.log, STUB_BEHAVIOUR: "sleep" },
  });
  assert.ok(await waitFor(() => readdirSync(repo.log).length === 1), "the stub session started");
  const [{ pid }] = stubCalls(repo);
  assert.ok(alive(pid));
  runner.kill("SIGTERM");
  assert.ok(await waitFor(() => !alive(pid)), "the session outlived the runner");
});

test("a denial is noted in the summary but is not a harness failure", () => {
  const repo = fakeRepo();
  const { out, status } = run(repo, ["--scenario", "1", "--repeat", "1"], { STUB_BEHAVIOUR: "deny" });
  assert.equal(summaryRows(out)[0].harness, "ok,denied=1");
  assert.equal(status, 0);
});

test("a skill run with no Skill call is a harness failure, and keeps its denial note", () => {
  const repo = fakeRepo();
  const { out, status } = run(repo, ["--scenario", "1", "--repeat", "1"], { STUB_BEHAVIOUR: "denynoskill" });
  assert.equal(summaryRows(out)[0].harness, "no-skill,denied=1");
  assert.equal(status, 1);
});

test("a baseline that reads the skill's files is a harness failure", () => {
  const repo = fakeRepo();
  const { out, status } = run(repo, ["--scenario", "1", "--repeat", "1", "--baseline"], {
    STUB_BEHAVIOUR: "readskill",
  });
  assert.equal(status, 1);
  assert.equal(summaryRows(out)[0].harness, "read-skill");
});

test("a missing skill argument or an unknown skill exits 2", () => {
  assert.equal(spawnSync("node", [RUNNER], { encoding: "utf8" }).status, 2);
  const repo = fakeRepo();
  const { status } = spawnSync("node", ["scripts/eval/run-scenarios.mjs", "nope"], { cwd: repo.root });
  assert.equal(status, 2);
});
