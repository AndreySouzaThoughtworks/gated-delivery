#!/usr/bin/env node
// Runs a skill's eval scenarios as real `claude -p` sessions and grades each run.
//
//   node scripts/eval/run-scenarios.mjs <skill> [--scenario <id>…] [--repeat 2] [--jobs N] [--baseline] [--out DIR]

import assert from "node:assert";
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
const DENIED_NOTE = "denied=";
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
const RUN_TEMP_DIR = "run-tmp";

const SUMMARY_COLUMNS = ["skill", "id", "arm", "run", "harness", "checks", "judge", "cost", "secs"];

const lines = (text) => {
  assert(typeof text === "string", "lines needs text to be a string");
  const split = text.replace(/\r/g, "").split("\n");
  assert(split.length >= 1, `splitting always yields at least one line: ${JSON.stringify([split.length])}`);
  return split;
};

const sectionBody = (markdown, headingPrefix) => {
  assert(typeof markdown === "string", "sectionBody needs markdown to be a string");
  assert(
    /^#+ /.test(headingPrefix),
    `sectionBody needs headingPrefix to start with hashes and a space: ${JSON.stringify([headingPrefix])}`,
  );
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
  const joined = body.join("\n");
  assert(typeof joined === "string", "sectionBody returns the joined body text");
  return joined;
};

const firstFence = (body) => {
  assert(body === null || body === undefined || typeof body === "string", "firstFence needs body to be text or absent");
  const fence = body?.match(/```[a-z]*\n([\s\S]*?)```/)?.[1] ?? null;
  assert(fence === null || typeof fence === "string", "firstFence returns the fence text or null");
  return fence;
};

const splitRow = (line) => {
  assert(typeof line === "string", "splitRow needs line to be a string");
  const cells = line
    .replace(/^\|/, "")
    .replace(/\|\s*$/, "")
    .split(/\s\|\s/)
    .map((cell) => cell.trim());
  assert(cells.length >= 1, `splitRow returns at least one cell: ${JSON.stringify([cells.length])}`);
  return cells;
};

const ROW_CELLS = 4;
const isHeaderOrRule = (line, cells) => {
  assert(typeof line === "string", "isHeaderOrRule needs line to be a string");
  assert(Array.isArray(cells), `isHeaderOrRule needs cells to be an array: ${JSON.stringify([cells])}`);
  return cells[0] === "#" || /^[\s|:-]+$/.test(line);
};

export function parseEvals(markdown) {
  assert(typeof markdown === "string", "parseEvals needs markdown to be a string");
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
    rows.push({
      id,
      prompt: prompt?.replace(/^"(.*)"$/, "$1"),
      persona,
      pass,
      cells: cells.length,
    });
  }
  const template = (heading) => {
    assert(heading.startsWith("### "), "template needs a level three heading");
    const found = firstFence(sectionBody(markdown, heading))?.trimEnd() ?? null;
    assert(found === null || typeof found === "string", "template returns the fence text or null");
    return found;
  };
  const parsed = {
    rows,
    skillTemplate: template("### Skill Agent"),
    baselineTemplate: template("### Baseline Agent"),
    clientContext: firstFence(sectionBody(markdown, "## Client context")),
    responseMode: /^mode:\s*response\b/m.test(sectionBody(markdown, "## Execution Model") ?? ""),
  };
  assert(Array.isArray(parsed.rows), `parseEvals returns rows as an array: ${JSON.stringify([parsed.rows])}`);
  return parsed;
}

export const fillTemplate = (template, prompt, persona) => {
  assert(typeof template === "string", "fillTemplate needs template to be a string");
  assert(typeof prompt === "string" && typeof persona === "string", "fillTemplate needs prompt and persona strings");
  const filled = template.replaceAll(PROMPT_PLACEHOLDER, () => prompt).replaceAll(PERSONA_PLACEHOLDER, () => persona);
  assert(typeof filled === "string", "fillTemplate returns the filled text");
  return filled;
};

const resultOf = (transcript) => {
  assert(typeof transcript === "string", "resultOf needs transcript to be a string");
  const result =
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
  assert(result === null || result.type === "result", "resultOf returns a result event or null");
  return result;
};

export function harnessFlags({ transcript, arm, skill, timedOut }) {
  assert(typeof transcript === "string", "harnessFlags needs transcript to be a string");
  assert(arm === ARM_SKILL || arm === ARM_BASELINE, "harnessFlags needs arm to be skill or baseline");
  const result = resultOf(transcript);
  const flags = [];
  if (arm === ARM_SKILL && !transcript.includes('"name":"Skill"')) flags.push("no-skill");
  if (arm === ARM_BASELINE && transcript.includes(`skills/${skill}/`)) flags.push("read-skill");
  if (!result) flags.push("no-result");
  if (result?.permission_denials?.length) flags.push(`${DENIED_NOTE}${result.permission_denials.length}`);
  if (timedOut) flags.push("timeout");
  assert(
    flags.every((flag) => typeof flag === "string"),
    "harnessFlags returns only string flags",
  );
  return flags;
}

export const summaryTsv = (rows) => {
  assert(Array.isArray(rows), `summaryTsv needs rows to be an array: ${JSON.stringify([rows])}`);
  const tsv = [SUMMARY_COLUMNS, ...rows.map((row) => SUMMARY_COLUMNS.map((column) => row[column]))]
    .map((cells) => `${cells.join("\t")}\n`)
    .join("");
  assert(tsv.endsWith("\n"), "summaryTsv ends with the header or a row terminator");
  return tsv;
};

export function disagreements(rows) {
  assert(Array.isArray(rows), `disagreements needs rows to be an array: ${JSON.stringify([rows])}`);
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.skill}\t${row.id}\t${row.arm}`;
    if (!groups.has(key))
      groups.set(key, {
        skill: row.skill,
        id: row.id,
        arm: row.arm,
        outcomes: [],
      });
    groups.get(key).outcomes.push(`checks ${row.checks} judge ${row.judge}`);
  }
  const disagreeing = [...groups.values()].filter((group) => new Set(group.outcomes).size > 1);
  assert(
    disagreeing.every((group) => group.outcomes.length > 1),
    "a disagreement needs at least two outcomes",
  );
  return disagreeing;
}

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g;

const usage = (message) => {
  const readable = String(message).replace(CONTROL_CHARACTERS, " ");
  assert(
    !CONTROL_CHARACTERS.test(readable),
    `a usage message cannot carry line breaks or control characters: ${JSON.stringify([readable])}`,
  );
  assert(
    Number.isInteger(EXIT_USAGE) && EXIT_USAGE !== EXIT_OK,
    `a usage error must exit non-zero: ${JSON.stringify([EXIT_USAGE, EXIT_OK])}`,
  );
  console.error(readable);
  console.error("usage: run-scenarios.mjs <skill> [--scenario <id>…] [--repeat 2] [--jobs N] [--baseline] [--out DIR]");
  process.exit(EXIT_USAGE);
};

const positiveInteger = (flag, value) => {
  assert(flag.startsWith("--"), "positiveInteger needs flag to be a long option");
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) usage(`${flag} needs a positive integer, got "${value}"`);
  assert(n >= 1, `positiveInteger returns a number of at least one: ${JSON.stringify([n])}`);
  return n;
};

function parseArgs(argv) {
  assert(Array.isArray(argv), `parseArgs needs argv to be an array: ${JSON.stringify([argv])}`);
  const options = {
    skill: null,
    ids: [],
    repeat: DEFAULT_REPEAT,
    jobs: DEFAULT_JOBS,
    baseline: false,
    out: null,
  };
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
  assert(
    options.repeat >= 1 && options.jobs >= 1,
    `parseArgs returns positive repeat and jobs: ${JSON.stringify([options.repeat, options.jobs])}`,
  );
  return options;
}

const snapshotPlugin = (target) => {
  assert(
    typeof target === "string" && target.length > 0,
    `snapshotPlugin needs a target directory: ${JSON.stringify([target, target.length])}`,
  );
  assert(existsSync(PLUGIN_DIR), `snapshotPlugin needs the plugin directory to exist: ${JSON.stringify([PLUGIN_DIR])}`);
  cpSync(PLUGIN_DIR, target, {
    recursive: true,
    filter: (source) => basename(source) !== "evals.md",
  });
};

const pagesIn = (dir) => {
  assert(typeof dir === "string", "pagesIn needs dir to be a string");
  const pages = readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) return SKIPPED_DIRS.has(entry.name) ? [] : pagesIn(join(dir, entry.name));
    return entry.name.endsWith(PAGE_EXTENSION) ? [join(dir, entry.name)] : [];
  });
  assert(
    pages.every((page) => page.endsWith(PAGE_EXTENSION)),
    `pagesIn returns only page files: ${JSON.stringify([PAGE_EXTENSION])}`,
  );
  return pages;
};

const worst = (verdicts) => {
  assert(verdicts.length > 0, `worst needs at least one verdict: ${JSON.stringify([verdicts.length])}`);
  const severest = verdicts.reduce((a, b) => (VERDICT_SEVERITY.indexOf(b) > VERDICT_SEVERITY.indexOf(a) ? b : a));
  assert(VERDICT_SEVERITY.includes(severest), `worst returns a known verdict: ${JSON.stringify([severest])}`);
  return severest;
};

function gradeChecks(skill, id, runDir) {
  assert(typeof skill === "string" && typeof id === "string", "gradeChecks needs skill and id strings");
  if (!existsSync(RUN_CHECKS)) return NOT_AVAILABLE;
  const scratch = join(runDir, RUN_TEMP_DIR, "");
  const files = [join(runDir, "output.md"), ...pagesIn(runDir).filter((page) => !page.startsWith(scratch))];
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
  const verdict = worst(verdicts);
  assert(log.length === files.length, "gradeChecks logs one entry per graded file");
  return verdict;
}

function gradeJudge(skill, id, runDir) {
  assert(typeof skill === "string" && typeof id === "string", "gradeJudge needs skill and id strings");
  if (!existsSync(JUDGE)) return NOT_AVAILABLE;
  const { status, stdout, stderr } = spawnSync("node", [JUDGE, skill, id, runDir], { cwd: ROOT, encoding: "utf8" });
  writeFileSync(join(runDir, "judge.json"), stdout || stderr);
  const verdict = JUDGE_VERDICTS[status] ?? GRADER_ERROR;
  assert(
    verdict === GRADER_ERROR || Object.values(JUDGE_VERDICTS).includes(verdict),
    `gradeJudge returns a known verdict: ${JSON.stringify([verdict, GRADER_ERROR])}`,
  );
  return verdict;
}

const NO_SUCH_PROCESS = "ESRCH";
const liveGroups = new Set();
const signalGroup = (pid, name) => {
  assert(Number.isInteger(pid) && pid > 0, `signalGroup needs a positive process id: ${JSON.stringify([pid])}`);
  assert(
    typeof name === "string" && name.startsWith("SIG"),
    `signalGroup needs a signal name: ${JSON.stringify([name])}`,
  );
  try {
    process.kill(-pid, name);
  } catch (error) {
    if (error.code !== NO_SUCH_PROCESS) console.error(`could not signal process group ${pid}: ${error.message}`);
  }
};
for (const name of ["SIGINT", "SIGTERM"]) {
  process.on(name, () => {
    for (const pid of liveGroups) signalGroup(pid, "SIGTERM");
    process.exit(EXIT_HARNESS_FAILURE);
  });
}

const runClaude = (args, { cwd, env, transcriptPath, stderrPath }) => {
  assert(Array.isArray(args), `runClaude needs args to be an array: ${JSON.stringify([args])}`);
  assert(typeof transcriptPath === "string" && typeof stderrPath === "string", "runClaude needs output paths");
  return new Promise((resolve) => {
    const out = openSync(transcriptPath, "w");
    const err = openSync(stderrPath, "w");
    const child = spawn(CLAUDE_BIN, args, {
      cwd,
      env,
      stdio: ["ignore", out, err],
      detached: true,
    });
    liveGroups.add(child.pid);
    let timedOut = false;
    const signal = (name) => {
      assert(typeof name === "string", "signal needs a signal name");
      assert(child.pid > 0, `signal needs a spawned child: ${JSON.stringify([child.pid])}`);
      signalGroup(child.pid, name);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      if (child.pid === undefined) return;
      signal("SIGTERM");
      setTimeout(() => signal("SIGKILL"), KILL_GRACE_MS).unref();
    }, RUN_TIMEOUT_SECONDS * MS_PER_SECOND);
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      assert(liveGroups.has(child.pid), `finish runs once per live process group: ${JSON.stringify([child.pid])}`);
      assert(typeof timedOut === "boolean", "finish reports whether the run timed out");
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
};

const stageFixture = ({ skill, row, runDir }) => {
  assert(typeof skill === "string" && typeof row?.id === "string", "stageFixture needs a skill and a scenario row");
  assert(typeof runDir === "string", "stageFixture needs a run directory");
  const fixture = join(FIXTURES_DIR, skill, row.id);
  const hasFixture = existsSync(fixture);
  const setup = join(fixture, FIXTURE_SETUP);
  const allowedToolsFile = join(fixture, FIXTURE_ALLOWED_TOOLS);
  if (!hasFixture) return { hasFixture, allowedToolsFile, setupFailed: false };
  cpSync(fixture, runDir, {
    recursive: true,
    filter: (source) => source !== setup && source !== allowedToolsFile,
  });
  if (!existsSync(setup)) return { hasFixture, allowedToolsFile, setupFailed: false };
  const built = spawnSync("bash", [setup, fixture], {
    cwd: runDir,
    encoding: "utf8",
  });
  writeFileSync(`${runDir}.setup.log`, `${built.stdout ?? ""}${built.stderr ?? ""}`);
  return { hasFixture, allowedToolsFile, setupFailed: built.status !== 0 };
};

const claudeArgs = ({ arm, prompt, snapshot, tempDir, extraRules }) => {
  assert(arm === ARM_SKILL || arm === ARM_BASELINE, "claudeArgs needs arm to be skill or baseline");
  assert(Array.isArray(extraRules), `claudeArgs needs extraRules to be an array: ${JSON.stringify([extraRules])}`);
  const args = [
    "-p",
    prompt,
    ...(arm === ARM_SKILL ? ["--plugin-dir", snapshot, "--add-dir", snapshot] : []),
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
  assert(args[1] === prompt, "claudeArgs puts the prompt right after -p");
  return args;
};

async function runOne({ skill, evals, arm, row, n, out, snapshot }) {
  assert(typeof skill === "string" && typeof row?.id === "string", "runOne needs a skill and a scenario row");
  assert(Number.isInteger(n) && n >= 1, `runOne needs a one-based run number: ${JSON.stringify([n])}`);
  const runDir = join(out, skill, row.id, `${arm}-${n}`);
  const base = {
    skill,
    id: row.id,
    arm,
    run: n,
    checks: NOT_AVAILABLE,
    judge: NOT_AVAILABLE,
    cost: "0.00",
    secs: 0,
  };
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "persona.md"), `${row.persona}\n`);
  if (evals.clientContext) writeFileSync(join(runDir, "CLAUDE.md"), evals.clientContext);

  const { hasFixture, allowedToolsFile, setupFailed } = stageFixture({
    skill,
    row,
    runDir,
  });
  if (setupFailed) return { ...base, harness: SETUP_FAILED, failed: true };
  const tempDir = `${runDir}.${RUN_TEMP_DIR}`;
  mkdirSync(tempDir, { recursive: true });
  const extraRules = existsSync(allowedToolsFile) ? lines(readFileSync(allowedToolsFile, "utf8")).filter(Boolean) : [];

  const persona = readFileSync(join(runDir, "persona.md"), "utf8").trimEnd();
  const template = arm === ARM_BASELINE ? evals.baselineTemplate : evals.skillTemplate;
  const harnessLine = evals.responseMode && !hasFixture ? `\n${HARNESS_LINE}` : "";
  const prompt = `${fillTemplate(template, row.prompt, persona)}${harnessLine}`;
  const args = claudeArgs({ arm, prompt, snapshot, tempDir, extraRules });
  const fixtureBin = join(runDir, FIXTURE_BIN);
  const path = existsSync(fixtureBin) ? `${fixtureBin}:${process.env.PATH}` : process.env.PATH;
  const env = { ...process.env, PATH: path, TMPDIR: tempDir };

  const started = performance.now();
  const transcriptPath = `${runDir}.transcript.jsonl`;
  const stderrPath = `${runDir}.stderr.txt`;
  const { timedOut } = await runClaude(args, {
    cwd: runDir,
    env,
    transcriptPath,
    stderrPath,
  });
  const secs = Math.round((performance.now() - started) / MS_PER_SECOND);
  renameSync(transcriptPath, join(runDir, "transcript.jsonl"));
  renameSync(stderrPath, join(runDir, "stderr.txt"));
  renameSync(tempDir, join(runDir, RUN_TEMP_DIR));

  return gradeRun({ base, skill, arm, row, runDir, prompt, timedOut, secs });
}

const gradeRun = ({ base, skill, arm, row, runDir, prompt, timedOut, secs }) => {
  assert(typeof prompt === "string", "gradeRun needs the prompt text");
  assert(typeof runDir === "string", "gradeRun needs a run directory");
  const transcript = readFileSync(join(runDir, "transcript.jsonl"), "utf8");
  const result = resultOf(transcript);
  writeFileSync(join(runDir, "prompt.txt"), prompt);
  writeFileSync(join(runDir, "output.md"), result?.result ? `${result.result}\n` : "");
  const flags = harnessFlags({ transcript, arm, skill, timedOut });
  const notes = flags.filter((flag) => flag.startsWith(DENIED_NOTE));
  const failures = flags.filter((flag) => !notes.includes(flag));
  assert(failures.length + notes.length === flags.length, "every flag is either a failure or a note");
  return {
    ...base,
    harness: [...(failures.length ? failures : [HARNESS_OK]), ...notes].join(","),
    failed: failures.length > 0,
    checks: gradeChecks(skill, row.id, runDir),
    judge: gradeJudge(skill, row.id, runDir),
    cost: (result?.total_cost_usd ?? 0).toFixed(2),
    secs,
  };
};

const table = (rows) => {
  assert(Array.isArray(rows), `table needs rows to be an array: ${JSON.stringify([rows])}`);
  const cells = [SUMMARY_COLUMNS, ...rows.map((row) => SUMMARY_COLUMNS.map((column) => String(row[column])))];
  const widths = SUMMARY_COLUMNS.map((_, i) => Math.max(...cells.map((r) => r[i].length)));
  const rendered = cells
    .map((r) =>
      r
        .map((cell, i) => cell.padEnd(widths[i]))
        .join("  ")
        .trimEnd(),
    )
    .join("\n");
  assert(
    rendered.split("\n").length >= rows.length + 1,
    `table renders a header and a line per row: ${JSON.stringify([rendered, rows.length])}`,
  );
  return rendered;
};

const selectScenarios = (options, evals, arm) => {
  assert(Array.isArray(evals.rows), `selectScenarios needs parsed rows: ${JSON.stringify([evals.rows])}`);
  assert(arm === ARM_SKILL || arm === ARM_BASELINE, "selectScenarios needs arm to be skill or baseline");
  if (arm === ARM_BASELINE && !evals.baselineTemplate) usage(`${options.skill} has no ### Baseline Agent template.`);
  if (arm === ARM_SKILL && !evals.skillTemplate) usage(`${options.skill} has no ### Skill Agent template.`);
  const unknown = options.ids.filter((id) => !evals.rows.some((row) => row.id === id));
  if (unknown.length) usage(`No such scenario in ${options.skill}: ${unknown.join(", ")}`);
  const selected = options.ids.length ? evals.rows.filter((row) => options.ids.includes(row.id)) : evals.rows;
  const malformed = selected.filter((row) => row.cells !== ROW_CELLS);
  if (malformed.length) usage(`Rows without ${ROW_CELLS} cells: ${malformed.map((row) => row.id).join(", ")}`);
  return selected;
};

async function main() {
  assert(Array.isArray(process.argv), `main needs process arguments: ${JSON.stringify([process.argv])}`);
  assert(existsSync(SKILLS_DIR), `main needs the skills directory to exist: ${JSON.stringify([SKILLS_DIR])}`);
  const options = parseArgs(process.argv.slice(2));
  const evalsPath = join(SKILLS_DIR, options.skill, "evals.md");
  if (!existsSync(evalsPath)) usage(`No such skill with evals: ${options.skill}`);
  const evals = parseEvals(readFileSync(evalsPath, "utf8"));
  const arm = options.baseline ? ARM_BASELINE : ARM_SKILL;
  const selected = selectScenarios(options, evals, arm);

  const out = options.out ?? join(tmpdir(), `gated-delivery-evals-${options.skill}-${Date.now()}`);
  const snapshot = join(out, "plugin");
  mkdirSync(out, { recursive: true });
  if (arm === ARM_SKILL) snapshotPlugin(snapshot);

  const queue = selected.flatMap((row) =>
    Array.from({ length: options.repeat }, (_, i) => ({
      skill: options.skill,
      evals,
      arm,
      row,
      n: i + 1,
      out,
      snapshot,
    })),
  );
  const order = (row) => {
    assert(typeof row.id === "string", "order needs a result with a scenario id");
    const position = selected.findIndex((r) => r.id === row.id) * (options.repeat + 1) + row.run;
    assert(Number.isInteger(position), `order returns an integer position: ${JSON.stringify([position])}`);
    return position;
  };
  const results = [];
  const worker = async () => {
    assert(Array.isArray(queue), `worker needs the shared queue: ${JSON.stringify([queue])}`);
    while (queue.length) results.push(await runOne(queue.shift()));
    assert(queue.length === 0, "a worker stops only when the queue is empty");
  };
  await Promise.all(Array.from({ length: Math.min(options.jobs, queue.length) }, worker));
  results.sort((a, b) => order(a) - order(b));

  writeFileSync(join(out, "summary.tsv"), summaryTsv(results));
  console.log(table(results));
  for (const { skill, id, arm: a, outcomes } of disagreements(results)) {
    console.log(`DISAGREE ${skill} ${id} ${a}: ${outcomes.join(" | ")}`);
  }
  console.log(`\n${join(out, "summary.tsv")}`);
  return results.some((row) => row.failed) ? EXIT_HARNESS_FAILURE : EXIT_OK;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
