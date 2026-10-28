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
  scenarioVerdicts,
  smokeScenarioIds,
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

const readText = (path) => readFileSync(path, "utf8");

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
if (behaviour === "overbudget") { console.log(skillUse); console.log(result({ subtype: "error_max_budget_usd" })); return; }
if (behaviour === "recover") { const n = Number(process.cwd().slice(-1)); console.log(skillUse); console.log(result({ result: n % 2 ? "nope" : "thing" })); return; }
if (behaviour === "never") { console.log(skillUse); console.log(result({ result: "nope" })); return; }
if (behaviour === "alternate") { const n = Number(process.cwd().slice(-1)); console.log(skillUse); console.log(result({ result: n % 2 ? "thing" : "nope" })); return; }
console.log(skillUse);
console.log(result());
`;

const EXECUTABLE_MODE = 0o755;

const writeExecutable = (path, body) => {
  writeFileSync(path, body);
  chmodSync(path, EXECUTABLE_MODE);
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
  copyFileSync(join(HERE, "run-checks.mjs"), join(root, "scripts", "eval", "run-checks.mjs"));
  if (graders) {
    writeFileSync(
      join(root, "scripts", "eval", "run-checks.mjs"),
      `import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
export const parseChecks = () => ({ prelude: [], checks: [] });
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [skill, file, flag, id] = process.argv.slice(2);
  if (flag !== "--scenario" || !id) process.exit(2);
  process.exit(readFileSync(file, "utf8").includes("thing") ? 0 : 1);
}
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

const runnerEnv = (repo, env) => ({ ...process.env, GATED_DELIVERY_CLAUDE_BIN: repo.claude, STUB_LOG: repo.log, ...env });

const run = (repo, args, env = {}) => {
  const out = join(repo.root, "out");
  const result = spawnSync("node", ["scripts/eval/run-scenarios.mjs", SKILL, ...args, "--out", out], {
    cwd: repo.root,
    encoding: "utf8",
    env: runnerEnv(repo, { STUB_BEHAVIOUR: "skill", ...env }),
  });
  return { ...result, out };
};

const startRunner = (repo, env) =>
  spawn("node", ["scripts/eval/run-scenarios.mjs", SKILL, "--scenario", "1", "--repeat", "1", "--out", join(repo.root, "out")], {
    cwd: repo.root,
    env: runnerEnv(repo, env),
  });

const exitStatus = (args, cwd) => spawnSync("node", args, { cwd, encoding: "utf8" }).status;

const stubCalls = (repo) => readdirSync(repo.log).map((f) => JSON.parse(readText(join(repo.log, f))));

const promptOf = (call) => call.argv[call.argv.indexOf("-p") + 1];

const summaryRows = (out) =>
  readText(join(out, "summary.tsv"))
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

const DENIED_TOOLS = [{ tool_name: "Bash" }, { tool_name: "Read" }];
const READ_SKILL_FILE = `{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{"file_path":"/p/skills/demo/SKILL.md"}}]}}\n${resultLine()}\n`;

test("harnessFlags names each way a run went wrong, and nothing for a clean run", () => {
  const cases = [
    { transcript: `${SKILL_TOOL_USE}\n${resultLine()}\n`, flags: [] },
    { transcript: `${resultLine()}\n`, flags: ["no-skill"] },
    { transcript: `${SKILL_TOOL_USE}\n${resultLine({ permission_denials: DENIED_TOOLS })}\n`, flags: ["denied=2"] },
    { transcript: `${SKILL_TOOL_USE}\n`, timedOut: true, flags: ["no-result", "timeout"] },
    { transcript: READ_SKILL_FILE, arm: "baseline", flags: ["read-skill"] },
    { transcript: `${resultLine()}\n`, arm: "baseline", flags: [] },
  ];
  for (const { transcript, arm = "skill", timedOut = false, flags } of cases) {
    assert.deepEqual(harnessFlags({ transcript, arm, skill: SKILL, timedOut }), flags);
  }
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
  assert.equal(readText(join(runDir, "persona.md")), "Plain persona one.\n");
  assert.equal(readText(join(runDir, "CLAUDE.md")), "## Issue tracking\n- **Tracker:** `jira`\n");
  assert.equal(readText(join(runDir, "output.md")), "did the thing\n");
  assert.ok(existsSync(join(runDir, "transcript.jsonl")));
  assert.equal(readText(join(runDir, "prompt.txt")), prompt);
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
  assert.ok(!existsSync(join(out, "plugin")), "a temp --add-dir above the out dir must not reach a plugin copy");
  const [row] = summaryRows(out);
  assert.equal(row.arm, "baseline");
  assert.equal(row.harness, "ok");
});

test("a usage error exits 2 and says what is wrong", () => {
  const withoutBaseline = fakeRepo({ evals: EVALS.replace(/### Baseline Agent[\s\S]*?### Skill Agent/, "### Skill Agent") });
  const cases = [
    { repo: withoutBaseline, args: ["--baseline"], message: /Baseline/ },
    { repo: fakeRepo(), args: ["--scenario", "99"], message: /99/ },
  ];
  for (const { repo, args, message } of cases) {
    const { status, stderr } = run(repo, args);
    assert.equal(status, 2);
    assert.match(stderr, message);
  }
  assert.equal(exitStatus([RUNNER]), 2, "no skill argument");
  assert.equal(exitStatus(["scripts/eval/run-scenarios.mjs", "nope"], fakeRepo().root), 2, "unknown skill");
});

test("the snapshot leaves out evals.md", () => {
  const repo = fakeRepo();
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
  assert.equal(readText(join(runDir, "notes.txt")), "fixture file\n");
  assert.equal(readText(join(runDir, "built.txt")), "built\n");
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

test("a judge that is not installed is marked n/a without crashing", () => {
  const repo = fakeRepo();
  const { status, out } = run(repo, ["--scenario", "1", "--repeat", "1"]);
  assert.equal(status, 0);
  const [row] = summaryRows(out);
  assert.deepEqual([row.checks, row.judge], ["PASS", "n/a"]);
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
  assert.match(readText(join(out, SKILL, "2", "skill-1", "judge.json")), /UNCLEAR/);
  assert.match(stdout, /skill\s+id\s+arm/);
});

test("grades the pages the run delivered, not scratch pages in its temp dir", () => {
  const repo = fakeRepo({ graders: true });
  const { out } = run(repo, ["--scenario", "1", "--repeat", "1"], { STUB_BEHAVIOUR: "pages" });
  const graded = readText(join(out, SKILL, "1", "skill-1", "checks.txt"));
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

const NO_SUCH_PROCESS = "ESRCH";

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code !== NO_SUCH_PROCESS) throw error;
    return false;
  }
};

const POLL_ATTEMPTS = 100;
const POLL_INTERVAL_MS = 50;

const waitFor = async (condition) => {
  for (let i = 0; i < POLL_ATTEMPTS && !condition(); i++) await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  return condition();
};

test("stopping the runner stops the sessions it started", async () => {
  const repo = fakeRepo();
  const runner = startRunner(repo, { STUB_BEHAVIOUR: "sleep" });
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

const withChecks = (fence) => EVALS.replace(/## Deterministic Checks[\s\S]*$/, `## Deterministic Checks\n\n\`\`\`bash\n${fence}\n\`\`\`\n`);
const COVER_FENCE = ["# expect: >=1 on 1,2", "grep -c a output.md", "# expect: >=1 on G1", "grep -c b output.md"].join("\n");
const ROW_IDS = ["1", "2", "G1"];

test("smoke picks the fewest scenarios covering every check, earliest row on a tie", () => {
  assert.deepEqual(smokeScenarioIds(withChecks(COVER_FENCE), ROW_IDS), ["1", "G1"]);
});

test("smoke falls back to the first scenario when no check names one", () => {
  assert.deepEqual(smokeScenarioIds(withChecks("# expect: manual\ngrep -c a output.md"), ROW_IDS), ["1"]);
});

test("--smoke launches only the covering scenarios", () => {
  const repo = fakeRepo({ evals: withChecks(COVER_FENCE) });
  const { out, status } = run(repo, ["--smoke", "--repeat", "1"]);
  assert.equal(status, 0);
  assert.deepEqual(summaryRows(out).map((r) => r.id), ["1", "G1"]);
});

test("--smoke refuses --scenario", () => {
  const repo = fakeRepo({ evals: withChecks(COVER_FENCE) });
  assert.equal(run(repo, ["--smoke", "--scenario", "1"]).status, 2);
});

test("--budget-usd and --model reach every claude run, and are absent by default", () => {
  const repo = fakeRepo();
  run(repo, ["--scenario", "1", "--repeat", "1", "--budget-usd", "1.5", "--model", "haiku"]);
  const [call] = stubCalls(repo);
  assert.equal(call.argv[call.argv.indexOf("--max-budget-usd") + 1], "1.5");
  assert.equal(call.argv[call.argv.indexOf("--model") + 1], "haiku");
  const plain = fakeRepo();
  run(plain, ["--scenario", "1", "--repeat", "1"]);
  assert.equal(stubCalls(plain)[0].argv.includes("--max-budget-usd"), false);
  assert.equal(stubCalls(plain)[0].argv.includes("--model"), false);
});

test("GATED_DELIVERY_RUN_MODEL sets the model unless --model is given", () => {
  const repo = fakeRepo();
  run(repo, ["--scenario", "1", "--repeat", "1"], { GATED_DELIVERY_RUN_MODEL: "sonnet" });
  const [call] = stubCalls(repo);
  assert.equal(call.argv[call.argv.indexOf("--model") + 1], "sonnet");
});

test("any is_error result is a harness failure, never a pass", () => {
  const transcript = `${SKILL_TOOL_USE}\n${resultLine({ is_error: true, subtype: "success" })}\n`;
  assert.deepEqual(harnessFlags({ transcript, arm: "skill", skill: SKILL, timedOut: false }), ["api-error"]);
});

test("a run the budget cap stopped is a harness failure, never a pass", () => {
  const repo = fakeRepo();
  const { out, status } = run(repo, ["--scenario", "1", "--repeat", "1", "--budget-usd", "1"], { STUB_BEHAVIOUR: "overbudget" });
  assert.equal(status, 1);
  assert.match(summaryRows(out)[0].harness, /over-budget/);
});

test("the total budget stops new runs, reports the rest as not-run and exits nonzero", () => {
  const repo = fakeRepo();
  const { out, status, stdout } = run(repo, ["--repeat", "1", "--jobs", "1", "--total-budget-usd", "0.25"]);
  assert.equal(status, 1);
  assert.deepEqual(summaryRows(out).map((r) => r.id), ["1"]);
  assert.match(stdout, /VERDICT demo 2 not-run/);
  assert.deepEqual(JSON.parse(readText(join(out, "verdicts.json"))).verdicts, { 1: "pass", 2: "not-run", G1: "not-run" });
});

const verdictsOf = (out) => JSON.parse(readText(join(out, "verdicts.json"))).verdicts;

test("--rerun-failures reruns only a failed scenario: pass then fail is flaky and exits 0", () => {
  const repo = fakeRepo({ graders: true });
  const { out, status } = run(repo, ["--scenario", "1", "--rerun-failures"], { STUB_BEHAVIOUR: "recover" });
  assert.equal(status, 0);
  assert.equal(verdictsOf(out)[1], "flaky");
  assert.equal(stubCalls(repo).length, 2);
});

test("--rerun-failures: a scenario that fails twice is fail and exits 1", () => {
  const repo = fakeRepo({ graders: true });
  const { out, status } = run(repo, ["--scenario", "1", "--rerun-failures"], { STUB_BEHAVIOUR: "never" });
  assert.equal(status, 1);
  assert.equal(verdictsOf(out)[1], "fail");
  assert.equal(stubCalls(repo).length, 2);
});

test("--rerun-failures: a scenario that passes first time runs once", () => {
  const repo = fakeRepo({ graders: true });
  const { out, status } = run(repo, ["--scenario", "1", "--rerun-failures"]);
  assert.equal(status, 0);
  assert.equal(verdictsOf(out)[1], "pass");
  assert.equal(stubCalls(repo).length, 1);
});

test("without --rerun-failures the default is two runs per scenario, and one failed repeat fails it", () => {
  const repo = fakeRepo({ graders: true });
  run(repo, ["--scenario", "1"]);
  assert.equal(stubCalls(repo).length, 2);
  const verdicts = scenarioVerdicts({ ids: ["1"], results: [{ id: "1", run: 1, checks: "PASS", judge: "PASS" }, { id: "1", run: 2, checks: "FAIL", judge: "PASS" }], unlaunchedIds: new Set(), rerunFailures: false });
  assert.equal(verdicts[1], "fail");
});

test("a scenario whose Pass Criteria is the em dash never reaches the judge; one with criteria does", () => {
  const repo = fakeRepo({ evals: EVALS.replace("| Does the thing. |", "| — |"), graders: true });
  const { out } = run(repo, ["--scenario", "1", "--scenario", "2", "--repeat", "1"]);
  const [dashed, judged] = summaryRows(out);
  assert.equal(dashed.judge, "n/a");
  assert.equal(existsSync(join(out, SKILL, "1", "skill-1", "judge.json")), false);
  assert.equal(judged.judge, "UNCLEAR");
  assert.equal(existsSync(join(out, SKILL, "2", "skill-1", "judge.json")), true);
});
