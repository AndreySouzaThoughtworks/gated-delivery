#!/usr/bin/env node
// Runs a skill's eval scenarios as real `claude -p` sessions and grades each run.
//
//   node scripts/eval/run-scenarios.mjs <skill> [--scenario <id>…] [--repeat 2] [--jobs N] [--baseline] [--out DIR]
//     [--smoke] [--rerun-failures] [--budget-usd N] [--total-budget-usd N] [--model M]

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
import { parseChecks } from "./run-checks.mjs";

const ROOT = process.cwd();
const PLUGIN_DIR = join(ROOT, "plugin");
const FIXTURES_DIR = join(ROOT, "evals", "fixtures");
const SKILLS_DIR = join(PLUGIN_DIR, "skills");
const RUN_CHECKS = join(ROOT, "scripts", "eval", "run-checks.mjs");
const JUDGE = join(ROOT, "scripts", "eval", "judge.mjs");
const CLAUDE_BIN = process.env.GATED_DELIVERY_CLAUDE_BIN || "claude";
const RUN_MODEL = process.env.GATED_DELIVERY_RUN_MODEL || null;

const DEFAULT_RUN_TIMEOUT_SECONDS = 1200;
const RUN_TIMEOUT_SECONDS = Number(process.env.GATED_DELIVERY_RUN_TIMEOUT_SECONDS) || DEFAULT_RUN_TIMEOUT_SECONDS;
const MS_PER_SECOND = 1000;
const KILL_GRACE_MS = 10 * MS_PER_SECOND;
const DEFAULT_REPEAT = 2;
const DEFAULT_JOBS = 4;
const RERUN_REPEAT = 1;
const RERUN_START = 2;
const VERDICTS_FILE = "verdicts.json";
const BUDGET_STOPPED_SUBTYPE = "error_max_budget_usd";
const VERDICT_PASS = "pass";
const VERDICT_FLAKY = "flaky";
const VERDICT_FAIL = "fail";
const VERDICT_NOT_RUN = "not-run";

const EXIT_OK = 0;
const EXIT_HARNESS_FAILURE = 1;
const EXIT_USAGE = 2;

const ARM_SKILL = "skill";
const ARM_BASELINE = "baseline";
const NOT_AVAILABLE = "n/a";
const NOTHING_TO_JUDGE = "—";
const HARNESS_OK = "ok";
const PASSING_GRADES = new Set(["PASS", NOT_AVAILABLE]);
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
  return body.join("\n");
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
  assert(parsed.rows.every((row) => row.id && !row.id.includes(sep)), `every scenario row needs an id that names one folder, got ${JSON.stringify(parsed.rows.map((row) => row.id))}`);
  return parsed;
}

export const fillTemplate = (template, prompt, persona) => {
  assert(template.includes(PROMPT_PLACEHOLDER), `an agent template must carry ${PROMPT_PLACEHOLDER} or the prompt is dropped, got ${JSON.stringify(template.slice(0, 60))}`);
  return template.replaceAll(PROMPT_PLACEHOLDER, () => prompt).replaceAll(PERSONA_PLACEHOLDER, () => persona);
};

const resultOf = (transcript) => {
  return (
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
      .findLast((event) => event?.type === "result") ?? null
  );
};

export function harnessFlags({ transcript, arm, skill, timedOut }) {
  const result = resultOf(transcript);
  const flags = [];
  if (arm === ARM_SKILL && !transcript.includes('"name":"Skill"')) flags.push("no-skill");
  if (arm === ARM_BASELINE && transcript.includes(`skills/${skill}/`)) flags.push("read-skill");
  if (!result) flags.push("no-result");
  if (result?.permission_denials?.length) flags.push(`${DENIED_NOTE}${result.permission_denials.length}`);
  if (timedOut) flags.push("timeout");
  if (result?.subtype === BUDGET_STOPPED_SUBTYPE) flags.push("over-budget");
  if (result?.is_error) flags.push("api-error");
  return flags;
}

export const summaryTsv = (rows) => {
  return [SUMMARY_COLUMNS, ...rows.map((row) => SUMMARY_COLUMNS.map((column) => row[column]))]
    .map((cells) => `${cells.join("\t")}\n`)
    .join("");
};

export function disagreements(rows) {
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
  return [...groups.values()].filter((group) => new Set(group.outcomes).size > 1);
}

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g;

const USAGE_LINES = [
  "usage: run-scenarios.mjs <skill> [--scenario <id>…] [--repeat 2] [--jobs N] [--baseline] [--out DIR]",
  "         [--smoke] [--rerun-failures] [--budget-usd N] [--total-budget-usd N] [--model M]",
];

const usage = (message) => {
  const readable = String(message).replace(CONTROL_CHARACTERS, " ");
  console.error(readable);
  for (const line of USAGE_LINES) console.error(line);
  process.exit(EXIT_USAGE);
};

const positiveInteger = (flag, value) => {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) usage(`${flag} needs a positive integer, got "${value}"`);
  return n;
};

const positiveNumber = (flag, value) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) usage(`${flag} needs a positive number, got "${value}"`);
  return n;
};

const BOOLEAN_FLAGS = { "--baseline": "baseline", "--smoke": "smoke", "--rerun-failures": "rerunFailures" };
const VALUE_FLAGS = {
  "--repeat": ["repeat", positiveInteger],
  "--jobs": ["jobs", positiveInteger],
  "--budget-usd": ["budgetUsd", positiveNumber],
  "--total-budget-usd": ["totalBudgetUsd", positiveNumber],
  "--model": ["model", (flag, value) => value || usage(`${flag} needs a model name`)],
  "--out": ["out", (flag, value) => value],
};

function parseArgs(argv) {
  const options = {
    skill: null,
    ids: [],
    repeat: null,
    jobs: DEFAULT_JOBS,
    baseline: false,
    out: null,
    smoke: false,
    rerunFailures: false,
    budgetUsd: null,
    totalBudgetUsd: null,
    model: RUN_MODEL,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--scenario") {
      while (argv[i + 1] !== undefined && !argv[i + 1].startsWith("--")) options.ids.push(argv[++i]);
    } else if (Object.hasOwn(BOOLEAN_FLAGS, arg)) options[BOOLEAN_FLAGS[arg]] = true;
    else if (Object.hasOwn(VALUE_FLAGS, arg)) {
      const [key, parse] = VALUE_FLAGS[arg];
      options[key] = parse(arg, argv[++i]);
    } else if (!arg.startsWith("--") && !options.skill) options.skill = arg;
    else usage(`Unknown argument: ${arg}`);
  }
  if (!options.skill) usage("No skill given.");
  if (options.smoke && options.ids.length) usage("--smoke picks the scenarios itself; drop --scenario.");
  options.repeat ??= options.rerunFailures ? RERUN_REPEAT : DEFAULT_REPEAT;
  return options;
}

const pagesIn = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) return SKIPPED_DIRS.has(entry.name) ? [] : pagesIn(join(dir, entry.name));
    return entry.name.endsWith(PAGE_EXTENSION) ? [join(dir, entry.name)] : [];
  });

function gradeChecks(skill, id, runDir) {
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
  return verdicts.reduce((a, b) => (VERDICT_SEVERITY.indexOf(b) > VERDICT_SEVERITY.indexOf(a) ? b : a));
}

function gradeJudge(skill, id, runDir, criteria) {
  if (!existsSync(JUDGE) || criteria === NOTHING_TO_JUDGE) return NOT_AVAILABLE;
  const { status, stdout, stderr } = spawnSync("node", [JUDGE, skill, id, runDir], { cwd: ROOT, encoding: "utf8" });
  writeFileSync(join(runDir, "judge.json"), stdout || stderr);
  return JUDGE_VERDICTS[status] ?? GRADER_ERROR;
}

const NO_SUCH_PROCESS = "ESRCH";
const liveGroups = new Set();
const signalGroup = (pid, name) => {
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

const claudeArgs = ({ arm, prompt, snapshot, tempDir, extraRules, budgetUsd, model }) => {
  assert(extraRules.every((rule) => rule.trim()), `a fixture tool rule must not be blank, got ${JSON.stringify(extraRules)}`);
  return [
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
    ...(budgetUsd ? ["--max-budget-usd", String(budgetUsd)] : []),
    ...(model ? ["--model", model] : []),
  ];
};

async function runOne({ skill, evals, arm, row, n, out, snapshot, budgetUsd, model }) {
  const runDir = join(out, skill, row.id, `${arm}-${n}`);
  const base = {
    skill,
    id: row.id,
    arm,
    run: n,
    checks: NOT_AVAILABLE,
    judge: NOT_AVAILABLE,
    cost: "0.00",
    costUsd: 0,
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
  const args = claudeArgs({ arm, prompt, snapshot, tempDir, extraRules, budgetUsd, model });
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
  const transcript = readFileSync(join(runDir, "transcript.jsonl"), "utf8");
  const result = resultOf(transcript);
  writeFileSync(join(runDir, "prompt.txt"), prompt);
  writeFileSync(join(runDir, "output.md"), result?.result ? `${result.result}\n` : "");
  const flags = harnessFlags({ transcript, arm, skill, timedOut });
  const notes = flags.filter((flag) => flag.startsWith(DENIED_NOTE));
  const failures = flags.filter((flag) => !notes.includes(flag));
  return {
    ...base,
    harness: [...(failures.length ? failures : [HARNESS_OK]), ...notes].join(","),
    failed: failures.length > 0,
    checks: gradeChecks(skill, row.id, runDir),
    judge: gradeJudge(skill, row.id, runDir, row.pass),
    cost: (result?.total_cost_usd ?? 0).toFixed(2),
    costUsd: result?.total_cost_usd ?? 0,
    secs,
  };
};

const table = (rows) => {
  const cells = [SUMMARY_COLUMNS, ...rows.map((row) => SUMMARY_COLUMNS.map((column) => String(row[column])))];
  const widths = SUMMARY_COLUMNS.map((_, i) => Math.max(...cells.map((r) => r[i].length)));
  return cells
    .map((r) =>
      r
        .map((cell, i) => cell.padEnd(widths[i]))
        .join("  ")
        .trimEnd(),
    )
    .join("\n");
};

export function smokeScenarioIds(markdown, rowIds) {
  const known = new Set(rowIds);
  const coverage = new Map(rowIds.map((id) => [id, new Set()]));
  parseChecks(markdown).checks.forEach((check, index) => {
    for (const expect of check.expects) {
      for (const id of expect.ids ?? []) if (known.has(id)) coverage.get(id).add(index);
    }
  });
  const uncovered = new Set([...coverage.values()].flatMap((checks) => [...checks]));
  const chosen = new Set();
  while (uncovered.size) {
    let best = null;
    let bestGain = 0;
    for (const [id, checks] of coverage) {
      const gain = [...checks].filter((index) => uncovered.has(index)).length;
      if (gain > bestGain) {
        best = id;
        bestGain = gain;
      }
    }
    chosen.add(best);
    for (const index of coverage.get(best)) uncovered.delete(index);
  }
  return chosen.size ? rowIds.filter((id) => chosen.has(id)) : rowIds.slice(0, 1);
}

const passed = (row) => !row.failed && PASSING_GRADES.has(row.checks) && PASSING_GRADES.has(row.judge);

export function scenarioVerdicts({ ids, results, unlaunchedIds, rerunFailures }) {
  return Object.fromEntries(
    ids.map((id) => {
      const runs = results.filter((row) => row.id === id).sort((a, b) => a.run - b.run);
      let verdict;
      if (!runs.length) verdict = VERDICT_NOT_RUN;
      else if (rerunFailures) {
        const [first, second] = runs;
        if (passed(first)) verdict = VERDICT_PASS;
        else verdict = second && passed(second) ? VERDICT_FLAKY : VERDICT_FAIL;
      } else if (!runs.every(passed)) verdict = VERDICT_FAIL;
      else verdict = unlaunchedIds.has(id) ? VERDICT_NOT_RUN : VERDICT_PASS;
      return [id, verdict];
    }),
  );
}

const selectScenarios = (options, evals, arm, markdown) => {
  if (arm === ARM_BASELINE && !evals.baselineTemplate) usage(`${options.skill} has no ### Baseline Agent template.`);
  if (arm === ARM_SKILL && !evals.skillTemplate) usage(`${options.skill} has no ### Skill Agent template.`);
  const unknown = options.ids.filter((id) => !evals.rows.some((row) => row.id === id));
  if (unknown.length) usage(`No such scenario in ${options.skill}: ${unknown.join(", ")}`);
  const allIds = evals.rows.map((row) => row.id);
  const wanted = new Set(options.smoke ? smokeScenarioIds(markdown, allIds) : options.ids.length ? options.ids : allIds);
  const selected = evals.rows.filter((row) => wanted.has(row.id));
  const malformed = selected.filter((row) => row.cells !== ROW_CELLS);
  if (malformed.length) usage(`Rows without ${ROW_CELLS} cells: ${malformed.map((row) => row.id).join(", ")}`);
  return selected;
};

const runQueue = async (items, jobs, ledger) => {
  const queue = [...items];
  const results = [];
  await Promise.all(
    Array.from({ length: Math.min(jobs, queue.length) }, async () => {
      while (queue.length && ledger.spent < ledger.limit) {
        const result = await runOne(queue.shift());
        ledger.spent += result.costUsd;
        results.push(result);
      }
    }),
  );
  return { results, unlaunched: queue };
};

const report = ({ options, out, results, verdicts }) => {
  writeFileSync(join(out, "summary.tsv"), summaryTsv(results));
  console.log(table(results));
  for (const { skill, id, arm, outcomes } of disagreements(results)) {
    console.log(`DISAGREE ${skill} ${id} ${arm}: ${outcomes.join(" | ")}`);
  }
  for (const [id, verdict] of Object.entries(verdicts)) console.log(`VERDICT ${options.skill} ${id} ${verdict}`);
  console.log(`\n${join(out, "summary.tsv")}`);
  const verdictList = Object.values(verdicts);
  const anyFailed = options.rerunFailures ? verdictList.includes(VERDICT_FAIL) : results.some((row) => row.failed);
  return anyFailed || verdictList.includes(VERDICT_NOT_RUN) ? EXIT_HARNESS_FAILURE : EXIT_OK;
};

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const evalsPath = join(SKILLS_DIR, options.skill, "evals.md");
  if (!existsSync(evalsPath)) usage(`No such skill with evals: ${options.skill}`);
  const markdown = readFileSync(evalsPath, "utf8");
  const evals = parseEvals(markdown);
  const arm = options.baseline ? ARM_BASELINE : ARM_SKILL;
  const selected = selectScenarios(options, evals, arm, markdown);

  const out = options.out ?? join(tmpdir(), `gated-delivery-evals-${options.skill}-${Date.now()}`);
  const snapshot = join(out, "plugin");
  mkdirSync(out, { recursive: true });
  if (arm === ARM_SKILL) {
    cpSync(PLUGIN_DIR, snapshot, {
      recursive: true,
      filter: (source) => basename(source) !== "evals.md",
    });
  }

  const ledger = { spent: 0, limit: options.totalBudgetUsd ?? Number.POSITIVE_INFINITY };
  const plan = (rows, count, firstRun) =>
    rows.flatMap((row) =>
      Array.from({ length: count }, (_, i) => ({
        skill: options.skill,
        evals,
        arm,
        row,
        n: firstRun + i,
        out,
        snapshot,
        budgetUsd: options.budgetUsd,
        model: options.model,
      })),
    );
  const first = await runQueue(plan(selected, options.repeat, 1), options.jobs, ledger);
  const results = [...first.results];
  const unlaunched = [...first.unlaunched];
  if (options.rerunFailures) {
    const retry = selected.filter((row) => results.some((r) => r.id === row.id && !passed(r)));
    const second = await runQueue(plan(retry, RERUN_REPEAT, RERUN_START), options.jobs, ledger);
    results.push(...second.results);
    unlaunched.push(...second.unlaunched);
  }
  const rank = new Map(selected.map((row, index) => [row.id, index]));
  results.sort((a, b) => rank.get(a.id) - rank.get(b.id) || a.run - b.run);
  const verdicts = scenarioVerdicts({
    ids: selected.map((row) => row.id),
    results,
    unlaunchedIds: new Set(unlaunched.map((item) => item.row.id)),
    rerunFailures: options.rerunFailures,
  });
  writeFileSync(join(out, VERDICTS_FILE), JSON.stringify({ verdicts, totalCostUsd: ledger.spent, runs: results.length }));

  return report({ options, out, results, verdicts });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
