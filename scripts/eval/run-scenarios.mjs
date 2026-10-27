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
import { constants, tmpdir } from "node:os";
import { basename, join, sep } from "node:path";
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

const LINE_BREAK = /\r?\n/;
const FENCE_BODY = /```[a-z]*\n([\s\S]*?)```/;
const ROW_CELLS = 4;

const sectionBody = (markdown, headingPrefix) => {
  assert(/^#+ /.test(headingPrefix), `a section heading starts with # marks and a space, got ${JSON.stringify(headingPrefix)}`);
  const all = markdown.split(LINE_BREAK);
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
  assert(!joined.startsWith(headingPrefix), `the body of ${headingPrefix} must exclude its own heading, got ${JSON.stringify(joined.slice(0, 40))}`);
  return joined;
};

export function parseEvals(markdown) {
  assert(markdown.length > 0, `an evals file must not be empty, got ${markdown.length} characters`);
  const all = markdown.split(LINE_BREAK);
  const rows = [];
  let inScenarios = false;
  let inFence = false;
  for (const line of all) {
    if (line.startsWith("```")) inFence = !inFence;
    if (!inFence && line.startsWith("## ")) inScenarios = line.startsWith("## Test Scenarios");
    if (!inScenarios || !line.startsWith("|")) continue;
    const cells = line
      .replace(/^\|/, "")
      .replace(/\|\s*$/, "")
      .split(/\s\|\s/)
      .map((cell) => cell.trim());
    if (cells[0] === "#" || /^[\s|:-]+$/.test(line)) continue;
    const [id, prompt, persona, pass] = cells;
    rows.push({
      id,
      prompt: prompt?.replace(/^"(.*)"$/, "$1"),
      persona,
      pass,
      cells: cells.length,
    });
  }
  const parsed = {
    rows,
    skillTemplate: sectionBody(markdown, "### Skill Agent")?.match(FENCE_BODY)?.[1]?.trimEnd() ?? null,
    baselineTemplate: sectionBody(markdown, "### Baseline Agent")?.match(FENCE_BODY)?.[1]?.trimEnd() ?? null,
    clientContext: sectionBody(markdown, "## Client context")?.match(FENCE_BODY)?.[1] ?? null,
    responseMode: /^mode:\s*response\b/m.test(sectionBody(markdown, "## Execution Model") ?? ""),
  };
  assert(parsed.rows.every((row) => row.id), `every scenario row needs an id, got ${JSON.stringify(parsed.rows.map((row) => row.id))}`);
  return parsed;
}

export const fillTemplate = (template, prompt, persona) => {
  assert(template.includes(PROMPT_PLACEHOLDER), `an agent template must carry ${PROMPT_PLACEHOLDER} or the prompt is dropped, got ${JSON.stringify(template.slice(0, 60))}`);
  const filled = template.replaceAll(PROMPT_PLACEHOLDER, () => prompt).replaceAll(PERSONA_PLACEHOLDER, () => persona);
  assert(prompt.includes(PROMPT_PLACEHOLDER) || !filled.includes(PROMPT_PLACEHOLDER), `${PROMPT_PLACEHOLDER} must be filled, got ${JSON.stringify(filled.slice(0, 60))}`);
  return filled;
};

const resultOf = (transcript) => {
  assert(typeof transcript === "string", `a transcript is utf8 text, a Buffer would split into nothing, got ${typeof transcript}`);
  const result =
    transcript
      .split(LINE_BREAK)
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .findLast((event) => event?.type === "result") ?? null;
  assert(result === null || result.type === "result", `resultOf must return the result event, got ${JSON.stringify(result?.type)}`);
  return result;
};

export function harnessFlags({ transcript, arm, skill, timedOut }) {
  assert([ARM_SKILL, ARM_BASELINE].includes(arm), `arm must be ${ARM_SKILL} or ${ARM_BASELINE}, got ${arm}`);
  assert(skill.length > 0, `a skill name is needed to spot reads of its pages, got ${JSON.stringify(skill)}`);
  const result = resultOf(transcript);
  const flags = [];
  if (arm === ARM_SKILL && !transcript.includes('"name":"Skill"')) flags.push("no-skill");
  if (arm === ARM_BASELINE && transcript.includes(`skills/${skill}/`)) flags.push("read-skill");
  if (!result) flags.push("no-result");
  if (result?.permission_denials?.length) flags.push(`${DENIED_NOTE}${result.permission_denials.length}`);
  if (timedOut) flags.push("timeout");
  assert(new Set(flags).size === flags.length, `a harness flag is raised once, got ${flags}`);
  return flags;
}

export const summaryTsv = (rows) => {
  assert(rows.every((row) => SUMMARY_COLUMNS.every((column) => row[column] !== undefined)), `every summary row needs ${SUMMARY_COLUMNS}, got ${JSON.stringify(rows)}`);
  const tsv = [SUMMARY_COLUMNS, ...rows.map((row) => SUMMARY_COLUMNS.map((column) => row[column]))]
    .map((cells) => `${cells.join("\t")}\n`)
    .join("");
  assert(tsv.split("\n").length === rows.length + 2, `the summary holds a header and one line per row, got ${JSON.stringify(tsv)}`);
  return tsv;
};

export function disagreements(rows) {
  assert(rows.every((row) => row.skill && row.id && row.arm), `every row names its skill, id and arm, got ${JSON.stringify(rows)}`);
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
  assert(disagreeing.every((group) => group.outcomes.length > 1), `a disagreement needs two runs, got ${JSON.stringify(disagreeing)}`);
  return disagreeing;
}

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g;

const usage = (message) => {
  assert(String(message).length > 0, `a usage error must say what is wrong, got ${JSON.stringify(message)}`);
  const readable = String(message).replace(CONTROL_CHARACTERS, " ");
  assert(readable.search(CONTROL_CHARACTERS) === -1, `usage text must carry no control characters, got ${JSON.stringify(readable)}`);
  console.error(readable);
  console.error("usage: run-scenarios.mjs <skill> [--scenario <id>…] [--repeat 2] [--jobs N] [--baseline] [--out DIR]");
  process.exit(EXIT_USAGE);
};

const positiveInteger = (flag, value) => {
  assert(flag.startsWith("--"), `a numeric option is a --flag, got ${flag}`);
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) usage(`${flag} needs a positive integer, got "${value}"`);
  assert(n >= 1, `${flag} must end up a positive integer, got ${n}`);
  return n;
};

function parseArgs(argv) {
  assert(!argv.includes(undefined), `an argument list holds no holes, got ${JSON.stringify(argv)}`);
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
  assert(options.ids.every((id) => !id.startsWith("--")), `a scenario id is not a flag, got ${options.ids}`);
  return options;
}

const pagesIn = (dir) => {
  assert(existsSync(dir), `pages are listed from a folder that exists, got ${dir}`);
  const pages = readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) return SKIPPED_DIRS.has(entry.name) ? [] : pagesIn(join(dir, entry.name));
    return entry.name.endsWith(PAGE_EXTENSION) ? [join(dir, entry.name)] : [];
  });
  assert(pages.every((page) => page.startsWith(dir) && page.endsWith(PAGE_EXTENSION)), `every page lies under ${dir} and ends ${PAGE_EXTENSION}, got ${pages}`);
  return pages;
};

const worst = (verdicts) => {
  assert(verdicts.length > 0, `at least one verdict is needed to find the worst, got ${verdicts.length}`);
  assert(verdicts.every((verdict) => VERDICT_SEVERITY.includes(verdict)), `verdicts must be ranked, got ${verdicts}`);
  const severest = verdicts.reduce((a, b) => (VERDICT_SEVERITY.indexOf(b) > VERDICT_SEVERITY.indexOf(a) ? b : a));
  assert(verdicts.includes(severest), `the worst verdict comes from the list, got ${severest} from ${verdicts}`);
  return severest;
};

function gradeChecks(skill, id, runDir) {
  assert(id.length > 0 && !id.includes(sep), `a scenario id names one folder, got ${JSON.stringify(id)}`);
  assert(existsSync(runDir), `a run folder must exist to be graded, got ${runDir}`);
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
  assert([...VERDICT_SEVERITY, NOT_AVAILABLE].includes(verdict), `the checks verdict must be a known one, got ${verdict}`);
  return verdict;
}

function gradeJudge(skill, id, runDir) {
  assert(id.length > 0 && !id.includes(sep), `a scenario id names one folder, got ${JSON.stringify(id)}`);
  assert(existsSync(runDir), `a run folder must exist to be judged, got ${runDir}`);
  if (!existsSync(JUDGE)) return NOT_AVAILABLE;
  const { status, stdout, stderr } = spawnSync("node", [JUDGE, skill, id, runDir], { cwd: ROOT, encoding: "utf8" });
  writeFileSync(join(runDir, "judge.json"), stdout || stderr);
  const verdict = JUDGE_VERDICTS[status] ?? GRADER_ERROR;
  assert([...Object.values(JUDGE_VERDICTS), GRADER_ERROR].includes(verdict), `the judge verdict must be a known one, got ${verdict}`);
  return verdict;
}

const NO_SUCH_PROCESS = "ESRCH";
const liveGroups = new Set();
const signalGroup = (pid, name) => {
  assert(Number.isInteger(pid) && pid > 0, `a process group is signalled by its leader's pid, got ${pid}`);
  assert(name in constants.signals, `${name} must be a signal this platform knows`);
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
  assert(args[0] === "-p", `claude must run non-interactively with -p first, got ${args[0]}`);
  assert(existsSync(cwd), `the run folder must exist before claude starts in it, got ${cwd}`);
  assert(transcriptPath !== stderrPath, `the transcript and stderr need separate files, got ${transcriptPath}`);
  return new Promise((resolve) => {
    const out = openSync(transcriptPath, "w");
    const err = openSync(stderrPath, "w");
    const child = spawn(CLAUDE_BIN, args, {
      cwd,
      env,
      stdio: ["ignore", out, err],
      detached: true,
    });
    if (child.pid !== undefined) liveGroups.add(child.pid);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      if (child.pid === undefined) return;
      signalGroup(child.pid, "SIGTERM");
      setTimeout(() => signalGroup(child.pid, "SIGKILL"), KILL_GRACE_MS).unref();
    }, RUN_TIMEOUT_SECONDS * MS_PER_SECOND);
    let finished = false;
    for (const event of ["close", "error"]) {
      child.on(event, (reason) => {
        if (event === "error") writeFileSync(stderrPath, String(reason));
        if (finished) return;
        finished = true;
        liveGroups.delete(child.pid);
        clearTimeout(timer);
        closeSync(out);
        closeSync(err);
        resolve({ timedOut });
      });
    }
  });
};

const stageFixture = ({ skill, row, runDir }) => {
  assert(row.id.length > 0 && !row.id.includes(sep), `a scenario id names one folder, got ${JSON.stringify(row.id)}`);
  assert(existsSync(runDir), `the run folder must exist before a fixture is staged, got ${runDir}`);
  const fixture = join(FIXTURES_DIR, skill, row.id);
  assert(fixture.startsWith(FIXTURES_DIR + sep), `a fixture must stay under ${FIXTURES_DIR}, got ${fixture}`);
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
  assert(prompt.length > 0, `claude needs a prompt, got ${prompt.length} characters`);
  assert(extraRules.every((rule) => rule.trim()), `a fixture tool rule must not be blank, got ${JSON.stringify(extraRules)}`);
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
  assert(args.includes(tempDir) && (arm === ARM_BASELINE || args.includes(snapshot)), `the run's folders must reach claude, got ${tempDir} and ${snapshot}`);
  return args;
};

async function runOne({ skill, evals, arm, row, n, out, snapshot }) {
  assert(Number.isInteger(n) && n >= 1, `a repetition is counted from 1, got ${n}`);
  assert([ARM_SKILL, ARM_BASELINE].includes(arm), `arm must be ${ARM_SKILL} or ${ARM_BASELINE}, got ${arm}`);
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
  const extraRules = existsSync(allowedToolsFile) ? readFileSync(allowedToolsFile, "utf8").split(LINE_BREAK).filter(Boolean) : [];

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
  assert(existsSync(join(runDir, "transcript.jsonl")), `a finished run leaves its transcript in ${runDir}`);

  return gradeRun({ base, skill, arm, row, runDir, prompt, timedOut, secs });
}

const gradeRun = ({ base, skill, arm, row, runDir, prompt, timedOut, secs }) => {
  assert(existsSync(join(runDir, "transcript.jsonl")), `a run is graded from its transcript in ${runDir}`);
  assert(Number.isFinite(secs) && secs >= 0, `a run lasts a finite, non-negative time, got ${secs}`);
  const transcript = readFileSync(join(runDir, "transcript.jsonl"), "utf8");
  const result = resultOf(transcript);
  writeFileSync(join(runDir, "prompt.txt"), prompt);
  writeFileSync(join(runDir, "output.md"), result?.result ? `${result.result}\n` : "");
  const flags = harnessFlags({ transcript, arm, skill, timedOut });
  const notes = flags.filter((flag) => flag.startsWith(DENIED_NOTE));
  const failures = flags.filter((flag) => !notes.includes(flag));
  const graded = {
    ...base,
    harness: [...(failures.length ? failures : [HARNESS_OK]), ...notes].join(","),
    failed: failures.length > 0,
    checks: gradeChecks(skill, row.id, runDir),
    judge: gradeJudge(skill, row.id, runDir),
    cost: (result?.total_cost_usd ?? 0).toFixed(2),
    secs,
  };
  assert(graded.failed === !graded.harness.split(",").includes(HARNESS_OK), `a run fails exactly when the harness is not ${HARNESS_OK}, got ${graded.harness}`);
  return graded;
};

const table = (rows) => {
  assert(rows.every((row) => SUMMARY_COLUMNS.every((column) => row[column] !== undefined)), `every row needs ${SUMMARY_COLUMNS}, got ${JSON.stringify(rows)}`);
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
  assert(rendered.split("\n").length === rows.length + 1, `the table holds a header and one line per row, got ${JSON.stringify(rendered)}`);
  return rendered;
};

const selectScenarios = (options, evals, arm) => {
  assert([ARM_SKILL, ARM_BASELINE].includes(arm), `arm must be ${ARM_SKILL} or ${ARM_BASELINE}, got ${arm}`);
  assert(options.skill.length > 0, `scenarios are chosen for a named skill, got ${JSON.stringify(options.skill)}`);
  if (arm === ARM_BASELINE && !evals.baselineTemplate) usage(`${options.skill} has no ### Baseline Agent template.`);
  if (arm === ARM_SKILL && !evals.skillTemplate) usage(`${options.skill} has no ### Skill Agent template.`);
  const unknown = options.ids.filter((id) => !evals.rows.some((row) => row.id === id));
  if (unknown.length) usage(`No such scenario in ${options.skill}: ${unknown.join(", ")}`);
  const selected = options.ids.length ? evals.rows.filter((row) => options.ids.includes(row.id)) : evals.rows;
  const malformed = selected.filter((row) => row.cells !== ROW_CELLS);
  if (malformed.length) usage(`Rows without ${ROW_CELLS} cells: ${malformed.map((row) => row.id).join(", ")}`);
  assert(selected.every((row) => row.cells === ROW_CELLS), `every chosen row has ${ROW_CELLS} cells, got ${JSON.stringify(selected.map((row) => row.cells))}`);
  return selected;
};

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const evalsPath = join(SKILLS_DIR, options.skill, "evals.md");
  if (!existsSync(evalsPath)) usage(`No such skill with evals: ${options.skill}`);
  const evals = parseEvals(readFileSync(evalsPath, "utf8"));
  const arm = options.baseline ? ARM_BASELINE : ARM_SKILL;
  const selected = selectScenarios(options, evals, arm);
  assert(options.repeat >= 1 && options.jobs >= 1, `repeat and jobs are positive, got ${options.repeat} and ${options.jobs}`);

  const out = options.out ?? join(tmpdir(), `gated-delivery-evals-${options.skill}-${Date.now()}`);
  const snapshot = join(out, "plugin");
  mkdirSync(out, { recursive: true });
  if (arm === ARM_SKILL) {
    cpSync(PLUGIN_DIR, snapshot, {
      recursive: true,
      filter: (source) => basename(source) !== "evals.md",
    });
  }

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
  const rank = new Map(selected.map((row, index) => [row.id, index]));
  const results = [];
  await Promise.all(
    Array.from({ length: Math.min(options.jobs, queue.length) }, async () => {
      while (queue.length) results.push(await runOne(queue.shift()));
    }),
  );
  results.sort((a, b) => rank.get(a.id) - rank.get(b.id) || a.run - b.run);
  assert(results.length === selected.length * options.repeat, `every chosen scenario runs ${options.repeat} times, got ${results.length} results for ${selected.length} scenarios`);

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
