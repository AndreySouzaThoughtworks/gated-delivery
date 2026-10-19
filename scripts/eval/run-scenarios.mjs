#!/usr/bin/env node
// Runs a skill's eval scenarios as real `claude -p` sessions and grades each run.
//
//   node scripts/eval/run-scenarios.mjs <skill> [--scenario <id>…] [--repeat 2] [--jobs N] [--baseline] [--out DIR]

import { spawn, spawnSync } from "node:child_process";
import {
  closeSync,
  cpSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const PLUGIN_DIR = join(ROOT, "plugin");
const FIXTURES_DIR = join(ROOT, "evals", "fixtures");
const SKILLS_DIR = join(PLUGIN_DIR, "skills");
const RUN_CHECKS = join(ROOT, "scripts", "eval", "run-checks.mjs");
const JUDGE = join(ROOT, "scripts", "eval", "judge.mjs");
const CLAUDE_BIN = process.env.GATED_DELIVERY_CLAUDE_BIN || "claude";

const DEFAULT_RUN_TIMEOUT_SECONDS = 1200;
const RUN_TIMEOUT_SECONDS = Number(process.env.GATED_DELIVERY_RUN_TIMEOUT_SECONDS) || DEFAULT_RUN_TIMEOUT_SECONDS;
const MS_PER_SECOND = 1000;
const KILL_GRACE_MS = 10 * MS_PER_SECOND;
const DEFAULT_REPEAT = 2;
const DEFAULT_JOBS = 4;

const EXIT_OK = 0;
const EXIT_HARNESS_FAILURE = 1;
const EXIT_USAGE = 2;

const ARM_SKILL = "skill";
const ARM_BASELINE = "baseline";
const NOT_AVAILABLE = "n/a";
const HARNESS_OK = "ok";
const SETUP_FAILED = "setup-failed";

const FIXTURE_SETUP = "setup.sh";
const FIXTURE_ALLOWED_TOOLS = "allowed-tools";
const FIXTURE_BIN = "bin";
const SKIPPED_DIRS = new Set([".git", "node_modules"]);
const PAGE_EXTENSION = ".html";

const CHECKS_VERDICTS = { 0: "PASS", 1: "FAIL" };
const JUDGE_VERDICTS = { 0: "PASS", 1: "FAIL", 3: "UNCLEAR" };
const GRADER_ERROR = "ERR";
const VERDICT_SEVERITY = ["PASS", "FAIL", GRADER_ERROR];

const PROMPT_PLACEHOLDER = "{{PROMPT}}";
const PERSONA_PLACEHOLDER = "{{PERSONA}}";
const HARNESS_LINE =
  "EVAL HARNESS (execution model: response): no repository, tracker, GitHub or agents are reachable from this directory; ./persona.md is the fixture. Treat CONTEXT as the observed state and do not stop for missing integrations: respond with the route, plan, exact commands, dispatches and decisions you would run, in order.";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ALLOWED_TOOLS = [
  "Bash(grep:*)",
  "Bash(echo:*)",
  "Bash(printenv:*)",
  "Bash(base64:*)",
  "Bash(tr:*)",
  "Bash(mkdir:*)",
  "Bash(python3:*)",
  "Bash(awk:*)",
  "Bash(sed:*)",
  "Bash(ls:*)",
  "Bash(cat:*)",
  "Bash(wc:*)",
  "Bash(file:*)",
  "Bash(cp:*)",
  `Bash("${CHROME}":*)`,
  "Bash(git add:*)",
  "Bash(git commit:*)",
  "Bash(git status:*)",
  "Bash(git log:*)",
  "Bash(git diff:*)",
  "Bash(git show:*)",
  "Bash(git branch:*)",
  "Bash(git rev-parse:*)",
  "Bash(node scripts/audit/consistency.mjs)",
];
const RUN_TEMP_DIR = "tmp";

const SUMMARY_COLUMNS = ["skill", "id", "arm", "run", "harness", "checks", "judge", "cost", "secs"];

const lines = (text) => text.replace(/\r/g, "").split("\n");

const sectionBody = (markdown, headingPrefix) => {
  const all = lines(markdown);
  const start = all.findIndex((l) => l.startsWith(headingPrefix));
  if (start === -1) return null;
  const level = headingPrefix.match(/^#+ /)[0];
  const body = [];
  let inFence = false;
  for (const line of all.slice(start + 1)) {
    if (line.startsWith("```")) inFence = !inFence;
    if (!inFence && (line.startsWith("## ") || line.startsWith(level))) break;
    body.push(line);
  }
  return body.join("\n");
};

const firstFence = (body) => body?.match(/```[a-z]*\n([\s\S]*?)```/)?.[1] ?? null;

const splitRow = (line) =>
  line
    .replace(/^\|/, "")
    .replace(/\|\s*$/, "")
    .split(/\s\|\s/)
    .map((cell) => cell.trim());

const ROW_CELLS = 4;
const isHeaderOrRule = (line, cells) => cells[0] === "#" || /^[\s|:-]+$/.test(line);

export function parseEvals(markdown) {
  const all = lines(markdown);
  const rows = [];
  let inScenarios = false;
  let inFence = false;
  for (const line of all) {
    if (line.startsWith("```")) inFence = !inFence;
    if (!inFence && line.startsWith("## ")) inScenarios = line.startsWith("## Test Scenarios");
    if (!inScenarios || !line.startsWith("|")) continue;
    const cells = splitRow(line);
    if (isHeaderOrRule(line, cells)) continue;
    const [id, prompt, persona, pass] = cells;
    rows.push({ id, prompt: prompt?.replace(/^"(.*)"$/, "$1"), persona, pass, cells: cells.length });
  }
  const template = (heading) => firstFence(sectionBody(markdown, heading))?.trimEnd() ?? null;
  return {
    rows,
    skillTemplate: template("### Skill Agent"),
    baselineTemplate: template("### Baseline Agent"),
    clientContext: firstFence(sectionBody(markdown, "## Client context")),
    responseMode: /^mode:\s*response\b/m.test(sectionBody(markdown, "## Execution Model") ?? ""),
  };
}

export const fillTemplate = (template, prompt, persona) =>
  template.replaceAll(PROMPT_PLACEHOLDER, () => prompt).replaceAll(PERSONA_PLACEHOLDER, () => persona);

const resultOf = (transcript) =>
  lines(transcript)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .findLast((event) => event?.type === "result") ?? null;

export function harnessFlags({ transcript, arm, skill, timedOut }) {
  const result = resultOf(transcript);
  const flags = [];
  if (arm === ARM_SKILL && !transcript.includes('"name":"Skill"')) flags.push("no-skill");
  if (arm === ARM_BASELINE && transcript.includes(`skills/${skill}/`)) flags.push("read-skill");
  if (!result) flags.push("no-result");
  if (result?.permission_denials?.length) flags.push("denied");
  if (timedOut) flags.push("timeout");
  return flags;
}

export const summaryTsv = (rows) =>
  [SUMMARY_COLUMNS, ...rows.map((row) => SUMMARY_COLUMNS.map((column) => row[column]))]
    .map((cells) => `${cells.join("\t")}\n`)
    .join("");

export function disagreements(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.skill}\t${row.id}\t${row.arm}`;
    if (!groups.has(key)) groups.set(key, { skill: row.skill, id: row.id, arm: row.arm, outcomes: [] });
    groups.get(key).outcomes.push(`checks ${row.checks} judge ${row.judge}`);
  }
  return [...groups.values()].filter((group) => new Set(group.outcomes).size > 1);
}

const usage = (message) => {
  console.error(message);
  console.error(
    "usage: run-scenarios.mjs <skill> [--scenario <id>…] [--repeat 2] [--jobs N] [--baseline] [--out DIR]",
  );
  process.exit(EXIT_USAGE);
};

const positiveInteger = (flag, value) => {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) usage(`${flag} needs a positive integer, got "${value}"`);
  return n;
};

function parseArgs(argv) {
  const options = { skill: null, ids: [], repeat: DEFAULT_REPEAT, jobs: DEFAULT_JOBS, baseline: false, out: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--scenario") {
      while (argv[i + 1] !== undefined && !argv[i + 1].startsWith("--")) options.ids.push(argv[++i]);
    } else if (arg === "--repeat") options.repeat = positiveInteger(arg, argv[++i]);
    else if (arg === "--jobs") options.jobs = positiveInteger(arg, argv[++i]);
    else if (arg === "--baseline") options.baseline = true;
    else if (arg === "--out") options.out = argv[++i];
    else if (!arg.startsWith("--") && !options.skill) options.skill = arg;
    else usage(`Unknown argument: ${arg}`);
  }
  if (!options.skill) usage("No skill given.");
  return options;
}

const snapshotPlugin = (target) =>
  cpSync(PLUGIN_DIR, target, {
    recursive: true,
    filter: (source) => basename(source) !== "evals.md",
  });

const pagesIn = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) return SKIPPED_DIRS.has(entry.name) ? [] : pagesIn(join(dir, entry.name));
    return entry.name.endsWith(PAGE_EXTENSION) ? [join(dir, entry.name)] : [];
  });

const worst = (verdicts) => verdicts.reduce((a, b) => (VERDICT_SEVERITY.indexOf(b) > VERDICT_SEVERITY.indexOf(a) ? b : a));

function gradeChecks(skill, id, runDir) {
  if (!existsSync(RUN_CHECKS)) return NOT_AVAILABLE;
  const files = [join(runDir, "output.md"), ...pagesIn(runDir)];
  const log = [];
  const verdicts = files.map((file) => {
    const { status, stdout, stderr } = spawnSync("node", [RUN_CHECKS, skill, file, "--scenario", id], {
      cwd: ROOT,
      encoding: "utf8",
    });
    log.push(`## ${file}\n${stdout}${stderr}`);
    return CHECKS_VERDICTS[status] ?? GRADER_ERROR;
  });
  writeFileSync(join(runDir, "checks.txt"), log.join("\n"));
  return worst(verdicts);
}

function gradeJudge(skill, id, runDir) {
  if (!existsSync(JUDGE)) return NOT_AVAILABLE;
  const { status, stdout, stderr } = spawnSync("node", [JUDGE, skill, id, runDir], { cwd: ROOT, encoding: "utf8" });
  writeFileSync(join(runDir, "judge.json"), stdout || stderr);
  return JUDGE_VERDICTS[status] ?? GRADER_ERROR;
}

const liveGroups = new Set();
const signalGroup = (pid, name) => {
  try {
    process.kill(-pid, name);
  } catch {}
};
for (const name of ["SIGINT", "SIGTERM"]) {
  process.on(name, () => {
    for (const pid of liveGroups) signalGroup(pid, "SIGTERM");
    process.exit(EXIT_HARNESS_FAILURE);
  });
}

const runClaude = (args, { cwd, env, transcriptPath, stderrPath }) =>
  new Promise((resolve) => {
    const out = openSync(transcriptPath, "w");
    const err = openSync(stderrPath, "w");
    const child = spawn(CLAUDE_BIN, args, { cwd, env, stdio: ["ignore", out, err], detached: true });
    liveGroups.add(child.pid);
    let timedOut = false;
    const signal = (name) => signalGroup(child.pid, name);
    const timer = setTimeout(() => {
      timedOut = true;
      signal("SIGTERM");
      setTimeout(() => signal("SIGKILL"), KILL_GRACE_MS).unref();
    }, RUN_TIMEOUT_SECONDS * MS_PER_SECOND);
    const finish = () => {
      liveGroups.delete(child.pid);
      clearTimeout(timer);
      closeSync(out);
      closeSync(err);
      resolve({ timedOut });
    };
    child.on("close", finish);
    child.on("error", (error) => {
      writeFileSync(stderrPath, String(error));
      finish();
    });
  });

async function runOne({ skill, evals, arm, row, n, out, snapshot }) {
  const runDir = join(out, skill, row.id, `${arm}-${n}`);
  const base = { skill, id: row.id, arm, run: n, checks: NOT_AVAILABLE, judge: NOT_AVAILABLE, cost: "0.00", secs: 0 };
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "persona.md"), `${row.persona}\n`);
  if (evals.clientContext) writeFileSync(join(runDir, "CLAUDE.md"), evals.clientContext);

  const fixture = join(FIXTURES_DIR, skill, row.id);
  const hasFixture = existsSync(fixture);
  const setup = join(fixture, FIXTURE_SETUP);
  const allowedToolsFile = join(fixture, FIXTURE_ALLOWED_TOOLS);
  if (hasFixture) {
    cpSync(fixture, runDir, { recursive: true, filter: (source) => source !== setup && source !== allowedToolsFile });
    if (existsSync(setup)) {
      const built = spawnSync("bash", [setup, fixture], { cwd: runDir, encoding: "utf8" });
      writeFileSync(`${runDir}.setup.log`, `${built.stdout ?? ""}${built.stderr ?? ""}`);
      if (built.status !== 0) return { ...base, harness: SETUP_FAILED };
    }
  }
  const tempDir = `${runDir}.${RUN_TEMP_DIR}`;
  mkdirSync(tempDir, { recursive: true });
  const extraRules = existsSync(allowedToolsFile) ? lines(readFileSync(allowedToolsFile, "utf8")).filter(Boolean) : [];

  const persona = readFileSync(join(runDir, "persona.md"), "utf8").trimEnd();
  const template = arm === ARM_BASELINE ? evals.baselineTemplate : evals.skillTemplate;
  const harnessLine = evals.responseMode && !hasFixture ? `\n${HARNESS_LINE}` : "";
  const prompt = `${fillTemplate(template, row.prompt, persona)}${harnessLine}`;
  const pluginArgs = arm === ARM_SKILL ? ["--plugin-dir", snapshot, "--add-dir", snapshot] : [];
  const args = [
    "-p",
    prompt,
    ...pluginArgs,
    "--setting-sources",
    "project,local",
    "--strict-mcp-config",
    "--permission-mode",
    "acceptEdits",
    "--allowedTools",
    ...ALLOWED_TOOLS,
    ...extraRules,
    "--add-dir",
    tempDir,
    "--output-format",
    "stream-json",
    "--verbose",
  ];
  const fixtureBin = join(runDir, FIXTURE_BIN);
  const path = existsSync(fixtureBin) ? `${fixtureBin}:${process.env.PATH}` : process.env.PATH;
  const env = { ...process.env, PATH: path, TMPDIR: tempDir };

  const started = Date.now();
  const transcriptPath = `${runDir}.transcript.jsonl`;
  const stderrPath = `${runDir}.stderr.txt`;
  const { timedOut } = await runClaude(args, { cwd: runDir, env, transcriptPath, stderrPath });
  const secs = Math.round((Date.now() - started) / MS_PER_SECOND);
  renameSync(transcriptPath, join(runDir, "transcript.jsonl"));
  renameSync(stderrPath, join(runDir, "stderr.txt"));
  renameSync(tempDir, join(runDir, RUN_TEMP_DIR));

  const transcript = readFileSync(join(runDir, "transcript.jsonl"), "utf8");
  const result = resultOf(transcript);
  writeFileSync(join(runDir, "prompt.txt"), prompt);
  writeFileSync(join(runDir, "output.md"), result?.result ? `${result.result}\n` : "");
  const flags = harnessFlags({ transcript, arm, skill, timedOut });
  return {
    ...base,
    harness: flags.join(",") || HARNESS_OK,
    checks: gradeChecks(skill, row.id, runDir),
    judge: gradeJudge(skill, row.id, runDir),
    cost: (result?.total_cost_usd ?? 0).toFixed(2),
    secs,
  };
}

const table = (rows) => {
  const cells = [SUMMARY_COLUMNS, ...rows.map((row) => SUMMARY_COLUMNS.map((column) => String(row[column])))];
  const widths = SUMMARY_COLUMNS.map((_, i) => Math.max(...cells.map((r) => r[i].length)));
  return cells.map((r) => r.map((cell, i) => cell.padEnd(widths[i])).join("  ").trimEnd()).join("\n");
};

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const evalsPath = join(SKILLS_DIR, options.skill, "evals.md");
  if (!existsSync(evalsPath)) usage(`No such skill with evals: ${options.skill}`);
  const evals = parseEvals(readFileSync(evalsPath, "utf8"));
  const arm = options.baseline ? ARM_BASELINE : ARM_SKILL;
  if (arm === ARM_BASELINE && !evals.baselineTemplate) usage(`${options.skill} has no ### Baseline Agent template.`);
  if (arm === ARM_SKILL && !evals.skillTemplate) usage(`${options.skill} has no ### Skill Agent template.`);
  const unknown = options.ids.filter((id) => !evals.rows.some((row) => row.id === id));
  if (unknown.length) usage(`No such scenario in ${options.skill}: ${unknown.join(", ")}`);
  const selected = options.ids.length ? evals.rows.filter((row) => options.ids.includes(row.id)) : evals.rows;
  const malformed = selected.filter((row) => row.cells !== ROW_CELLS);
  if (malformed.length) usage(`Rows without ${ROW_CELLS} cells: ${malformed.map((row) => row.id).join(", ")}`);

  const out = options.out ?? join(tmpdir(), `gated-delivery-evals-${options.skill}-${Date.now()}`);
  const snapshot = join(out, "plugin");
  mkdirSync(out, { recursive: true });
  if (arm === ARM_SKILL) snapshotPlugin(snapshot);

  const queue = selected.flatMap((row) =>
    Array.from({ length: options.repeat }, (_, i) => ({ skill: options.skill, evals, arm, row, n: i + 1, out, snapshot })),
  );
  const order = (row) => selected.findIndex((r) => r.id === row.id) * (options.repeat + 1) + row.run;
  const results = [];
  const worker = async () => {
    while (queue.length) results.push(await runOne(queue.shift()));
  };
  await Promise.all(Array.from({ length: Math.min(options.jobs, queue.length) }, worker));
  results.sort((a, b) => order(a) - order(b));

  writeFileSync(join(out, "summary.tsv"), summaryTsv(results));
  console.log(table(results));
  for (const { skill, id, arm: a, outcomes } of disagreements(results)) {
    console.log(`DISAGREE ${skill} ${id} ${a}: ${outcomes.join(" | ")}`);
  }
  console.log(`\n${join(out, "summary.tsv")}`);
  return results.some((row) => row.harness !== HARNESS_OK) ? EXIT_HARNESS_FAILURE : EXIT_OK;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
