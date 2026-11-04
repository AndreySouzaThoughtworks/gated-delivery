#!/usr/bin/env node
// Runs a skill's eval scenarios as real `claude -p` sessions and grades each run.
//
//   node scripts/eval/run-scenarios.ts <skill> [--scenario <id>…] [--repeat 2] [--jobs N] [--baseline] [--out DIR]
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
import { parseChecks } from "./run-checks.ts";

const ROOT = process.cwd();
const PLUGIN_DIR = join(ROOT, "plugin");
const FIXTURES_DIR = join(ROOT, "evals", "fixtures");
const SKILLS_DIR = join(PLUGIN_DIR, "skills");
const RUN_CHECKS = join(ROOT, "scripts", "eval", "run-checks.ts");
const JUDGE = join(ROOT, "scripts", "eval", "judge.ts");
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
const VERDICTS = [VERDICT_PASS, VERDICT_FLAKY, VERDICT_FAIL, VERDICT_NOT_RUN];

const EXIT_OK = 0;
const EXIT_HARNESS_FAILURE = 1;
const EXIT_USAGE = 2;
const EXIT_INTERNAL_ERROR = 3;

const ARM_SKILL = "skill";
const ARM_BASELINE = "baseline";
const ARMS = [ARM_SKILL, ARM_BASELINE];
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

const CHECKS_VERDICTS: Record<string, string> = { 0: "PASS", 1: "FAIL" };
const JUDGE_VERDICTS: Record<string, string> = { 0: "PASS", 1: "FAIL", 3: "UNCLEAR" };
const GRADER_ERROR = "ERR";
const VERDICT_SEVERITY = ["PASS", "FAIL", GRADER_ERROR];
const KNOWN_GRADES = new Set(["PASS", "FAIL", "UNCLEAR", GRADER_ERROR, NOT_AVAILABLE]);
const SIGNAL_TERM = "SIGTERM";
const SIGNAL_KILL = "SIGKILL";
const TSV_CELL_BREAK = /[\t\n]/;

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
  "Bash(node scripts/audit/consistency.ts)",
];
const RUN_TEMP_DIR = "run-tmp";

const SUMMARY_COLUMNS = ["skill", "id", "arm", "run", "harness", "checks", "judge", "cost", "secs"];

const LINE_BREAK = /\r?\n/;
const FENCE_BODY = /```[a-z]*\n([\s\S]*?)```/;
const ROW_CELLS = 4;
const UNUSABLE_ID = /^$|[\t\n\r/\\]/;

export type Arm = typeof ARM_SKILL | typeof ARM_BASELINE;
type EvalRow = { id: string; prompt: string; persona: string; pass: string; cells: number };
type ParsedEvals = {
  rows: EvalRow[];
  skillTemplate: string | null;
  baselineTemplate: string | null;
  clientContext: string | null;
  responseMode: boolean;
};
type ResultEvent = {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  permission_denials?: unknown[];
  result?: string;
  total_cost_usd?: number;
};
type RunRow = {
  skill: string;
  id: string;
  arm: string;
  run: number;
  checks: string;
  judge: string;
  cost: string;
  costUsd: number;
  secs: number;
  harness?: string;
  failed?: boolean;
};
type Options = {
  skill: string | null;
  ids: string[];
  repeat: number | null;
  jobs: number;
  baseline: boolean;
  out: string | null;
  smoke: boolean;
  rerunFailures: boolean;
  budgetUsd: number | null;
  totalBudgetUsd: number | null;
  model: string | null;
};
type ParsedOptions = Options & { skill: string; repeat: number };
type RunJob = {
  skill: string;
  evals: ParsedEvals;
  arm: Arm;
  row: EvalRow;
  n: number;
  out: string;
  snapshot: string;
  budgetUsd: number | null;
  model: string | null;
};
type Ledger = { spent: number; limit: number };
type ClaudeRun = { cwd: string; env: NodeJS.ProcessEnv; transcriptPath: string; stderrPath: string };
type ClaudeArgs = {
  arm: Arm;
  prompt: string;
  snapshot: string;
  tempDir: string;
  extraRules: string[];
  budgetUsd: number | null;
  model: string | null;
};
type GradeRun = {
  base: RunRow;
  skill: string;
  arm: Arm;
  row: EvalRow;
  runDir: string;
  prompt: string;
  timedOut: boolean;
  secs: number;
};
type GradedRun = Pick<RunRow, "id" | "run" | "checks" | "judge" | "failed">;
type Verdicts = Record<string, string>;
type FlagParser = (flag: string, value: string) => string | number;

const sectionBody = (markdown: string, headingPrefix: string) => {
  assert(typeof markdown === "string", `markdown must be a string, got ${typeof markdown}`);
  assert(/^#+ /.test(headingPrefix), `a heading prefix starts with hashes and a space, got ${JSON.stringify(headingPrefix)}`);
  const all = markdown.split(LINE_BREAK);
  const start = all.findIndex((l: string) => l.startsWith(headingPrefix));
  if (start === -1) return null;
  const level = headingPrefix.match(/^#+ /)![0];
  const body: string[] = [];
  let inFence = false;
  for (const line of all.slice(start + 1)) {
    if (line.startsWith("```")) inFence = !inFence;
    if (!inFence && (line.startsWith("## ") || line.startsWith(level))) break;
    body.push(line);
  }
  assert(body.length <= all.length - start - 1, `a section of ${headingPrefix} cannot be longer than the text after its heading`);
  return body.join("\n");
};

export function parseEvals(markdown: string): ParsedEvals {
  assert(typeof markdown === "string", `markdown must be a string, got ${typeof markdown}`);
  const all = markdown.split(LINE_BREAK);
  const rows: EvalRow[] = [];
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
      .map((cell: string) => cell.trim());
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
  assert(rows.every((row) => row.id !== "#"), `the table header must not become a scenario row, got ids ${JSON.stringify(rows.map((row) => row.id))}`);
  return parsed;
}

export const fillTemplate = (template: string, prompt: string, persona: string) => {
  assert(template.includes(PROMPT_PLACEHOLDER), `a template must carry ${PROMPT_PLACEHOLDER} or the prompt is dropped, got ${JSON.stringify(template.slice(0, 80))}`);
  const filled = template
    .split(PROMPT_PLACEHOLDER)
    .map((part: string) => part.replaceAll(PERSONA_PLACEHOLDER, () => persona))
    .join(prompt);
  assert(filled.includes(prompt), `the filled template must carry the prompt ${JSON.stringify(prompt)}`);
  return filled;
};

export function inspectRun({ transcript, arm, skill, timedOut }: { transcript: string; arm: Arm; skill: string; timedOut: boolean }) {
  assert(ARMS.includes(arm), `an arm is one of ${ARMS.join(", ")}, got ${JSON.stringify(arm)}`);
  assert(skill, `a run belongs to a skill, got ${JSON.stringify(skill)}`);
  const result =
    transcript
      .split(LINE_BREAK)
      .filter(Boolean)
      .map((line: string): ResultEvent | null => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .findLast((event: ResultEvent | null) => event?.type === "result") ?? null;
  const flags: string[] = [];
  if (arm === ARM_SKILL && !transcript.includes('"name":"Skill"')) flags.push("no-skill");
  if (arm === ARM_BASELINE && transcript.includes(`skills/${skill}/`)) flags.push("read-skill");
  if (!result) flags.push("no-result");
  if (result?.permission_denials?.length) flags.push(`${DENIED_NOTE}${result.permission_denials.length}`);
  if (timedOut) flags.push("timeout");
  if (result?.subtype === BUDGET_STOPPED_SUBTYPE) flags.push("over-budget");
  if (result?.is_error) flags.push("api-error");
  assert(new Set(flags).size === flags.length, `each flag is raised once, got ${JSON.stringify(flags)}`);
  assert(result !== null || flags.includes("no-result"), `a run without a result event must be flagged no-result, got ${JSON.stringify(flags)}`);
  return { flags, result };
}

export const summaryTsv = (rows: Record<string, unknown>[]) => {
  const cellRows = rows.map((row) => SUMMARY_COLUMNS.map((column) => row[column]));
  assert(cellRows.every((cells) => cells.every((cell) => !TSV_CELL_BREAK.test(String(cell)))), `a TSV cell cannot hold a tab or newline, got ${JSON.stringify(cellRows)}`);
  const tsv = [SUMMARY_COLUMNS, ...cellRows].map((cells) => `${cells.join("\t")}\n`).join("");
  assert(tsv.split("\n").length - 1 === rows.length + 1, `the TSV needs one header line and one line per row, got ${rows.length} rows`);
  return tsv;
};

export function disagreements(rows: Pick<RunRow, "skill" | "id" | "arm" | "checks" | "judge">[]) {
  assert(rows.every((row) => ![row.skill, row.id, row.arm].some((part) => part.includes("\t"))), `a group key is tab separated, so no part may hold a tab, got ${JSON.stringify(rows)}`);
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
  assert(disagreeing.every((group) => group.outcomes.length > 1), `a group disagrees only across at least two runs, got ${JSON.stringify(disagreeing)}`);
  return disagreeing;
}

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g;

const USAGE_LINES = [
  "usage: run-scenarios.ts <skill> [--scenario <id>…] [--repeat 2] [--jobs N] [--baseline] [--out DIR]",
  "         [--smoke] [--rerun-failures] [--budget-usd N] [--total-budget-usd N] [--model M]",
];

const usage = (message: unknown): never => {
  const readable = String(message).replace(CONTROL_CHARACTERS, " ");
  assert(readable.trim(), `a usage error must say what is wrong, got ${JSON.stringify(message)}`);
  assert(!/[\r\n]/.test(readable), `a usage error prints on one line, got ${JSON.stringify(readable)}`);
  console.error(readable);
  for (const line of USAGE_LINES) console.error(line);
  process.exit(EXIT_USAGE);
};

const positiveInteger = (flag: string, value: string) => {
  assert(flag.startsWith("--") && Object.hasOwn(VALUE_FLAGS, flag), `${JSON.stringify(flag)} is not a value flag`);
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) usage(`${flag} needs a positive integer, got "${value}"`);
  assert(Number.isInteger(n) && n >= 1, `${flag} must yield a positive integer, got ${n}`);
  return n;
};

const positiveNumber = (flag: string, value: string) => {
  assert(flag.startsWith("--") && Object.hasOwn(VALUE_FLAGS, flag), `${JSON.stringify(flag)} is not a value flag`);
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) usage(`${flag} needs a positive number, got "${value}"`);
  assert(Number.isFinite(n) && n > 0, `${flag} must yield a positive number, got ${n}`);
  return n;
};

const BOOLEAN_FLAGS: Record<string, "baseline" | "smoke" | "rerunFailures"> = { "--baseline": "baseline", "--smoke": "smoke", "--rerun-failures": "rerunFailures" };
const VALUE_FLAGS: Record<string, [string, FlagParser]> = {
  "--repeat": ["repeat", positiveInteger],
  "--jobs": ["jobs", positiveInteger],
  "--budget-usd": ["budgetUsd", positiveNumber],
  "--total-budget-usd": ["totalBudgetUsd", positiveNumber],
  "--model": ["model", (flag: string, value: string) => value || usage(`${flag} needs a model name`)],
  "--out": ["out", (_flag: string, value: string) => value],
};

function parseArgs(argv: string[]): ParsedOptions {
  assert(Array.isArray(argv), `arguments must be an array, got ${Object.prototype.toString.call(argv)}`);
  const options: Options = {
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
      Object.assign(options, { [key]: parse(arg, argv[++i]!) });
    } else if (!arg.startsWith("--") && !options.skill) options.skill = arg;
    else usage(`Unknown argument: ${arg}`);
  }
  const { skill } = options;
  if (!skill) return usage("No skill given.");
  if (options.smoke && options.ids.length) usage("--smoke picks the scenarios itself; drop --scenario.");
  const repeat = options.repeat ?? (options.rerunFailures ? RERUN_REPEAT : DEFAULT_REPEAT);
  assert(repeat >= 1, `repeat must be at least 1, got ${repeat}`);
  assert(options.jobs >= 1, `jobs must be at least 1, got ${options.jobs}`);
  return { ...options, skill, repeat };
}

const pagesIn = (dir: string): string[] => {
  assert(existsSync(dir), `pages are read from an existing directory, got ${dir}`);
  const pages = readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) return SKIPPED_DIRS.has(entry.name) ? [] : pagesIn(join(dir, entry.name));
    return entry.name.endsWith(PAGE_EXTENSION) ? [join(dir, entry.name)] : [];
  });
  assert(pages.every((page) => page.startsWith(dir) && page.endsWith(PAGE_EXTENSION)), `every page must be a ${PAGE_EXTENSION} file under ${dir}, got ${JSON.stringify(pages)}`);
  return pages;
};

function gradeChecks(skill: string, id: string, runDir: string) {
  assert(id, `grading names a scenario, got ${JSON.stringify(id)}`);
  assert(existsSync(runDir), `grading reads a run directory that exists, got ${runDir}`);
  if (!existsSync(RUN_CHECKS)) return NOT_AVAILABLE;
  const scratch = join(runDir, RUN_TEMP_DIR, "");
  const files = [join(runDir, "output.md"), ...pagesIn(runDir).filter((page: string) => !page.startsWith(scratch))];
  const log: string[] = [];
  const verdicts = files.map((file) => {
    const { status, stdout, stderr } = spawnSync("node", [RUN_CHECKS, skill, file, "--scenario", id], {
      cwd: ROOT,
      encoding: "utf8",
    });
    log.push(`## ${file}\n${stdout}${stderr}`);
    return CHECKS_VERDICTS[String(status)] ?? GRADER_ERROR;
  });
  writeFileSync(join(runDir, "checks.txt"), log.join("\n"));
  const worst = verdicts.reduce((a, b) => (VERDICT_SEVERITY.indexOf(b) > VERDICT_SEVERITY.indexOf(a) ? b : a));
  assert(VERDICT_SEVERITY.includes(worst), `the checks verdict must be a ranked grade, got ${JSON.stringify(worst)}`);
  return worst;
}

function gradeJudge(skill: string, id: string, runDir: string, criteria: string) {
  assert(id && existsSync(runDir), `judging names a scenario and reads an existing run directory, got id=${JSON.stringify(id)} runDir=${runDir}`);
  if (!existsSync(JUDGE) || criteria === NOTHING_TO_JUDGE) return NOT_AVAILABLE;
  const { status, stdout, stderr } = spawnSync("node", [JUDGE, skill, id, runDir], { cwd: ROOT, encoding: "utf8" });
  writeFileSync(join(runDir, "judge.json"), stdout || stderr);
  const verdict = JUDGE_VERDICTS[String(status)] ?? GRADER_ERROR;
  assert(KNOWN_GRADES.has(verdict), `the judge verdict must be a known grade, got ${JSON.stringify(verdict)}`);
  return verdict;
}

const NO_SUCH_PROCESS = "ESRCH";
const liveGroups = new Set<number>();
const signalGroup = (pid: number, name: NodeJS.Signals) => {
  assert(Number.isInteger(pid) && pid > 0, `a process group id is a positive integer; ${-pid} would signal our own group, got ${pid}`);
  assert(name === SIGNAL_TERM || name === SIGNAL_KILL, `only ${SIGNAL_TERM} and ${SIGNAL_KILL} are sent to a group, got ${name}`);
  try {
    process.kill(-pid, name);
  } catch (error) {
    const failure = error as NodeJS.ErrnoException;
    if (failure.code !== NO_SUCH_PROCESS) console.error(`could not signal process group ${pid}: ${failure.message}`);
  }
};
for (const name of ["SIGINT", "SIGTERM"]) {
  process.on(name, () => {
    for (const pid of liveGroups) signalGroup(pid, SIGNAL_TERM);
    process.exit(EXIT_HARNESS_FAILURE);
  });
}

const runClaude = (args: string[], { cwd, env, transcriptPath, stderrPath }: ClaudeRun) => {
  assert(existsSync(cwd), `claude runs in a directory that exists, got ${cwd}`);
  assert(transcriptPath !== stderrPath, `the transcript and stderr need separate files, both are ${transcriptPath}`);
  return new Promise<{ timedOut: boolean }>((resolve) => {
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
      const { pid } = child;
      if (pid === undefined) return;
      signalGroup(pid, SIGNAL_TERM);
      setTimeout(() => signalGroup(pid, SIGNAL_KILL), KILL_GRACE_MS).unref();
    }, RUN_TIMEOUT_SECONDS * MS_PER_SECOND);
    let finished = false;
    for (const event of ["close", "error"]) {
      child.on(event, (reason) => {
        if (event === "error") writeFileSync(stderrPath, String(reason));
        if (finished) return;
        finished = true;
        liveGroups.delete(Number(child.pid));
        clearTimeout(timer);
        closeSync(out);
        closeSync(err);
        resolve({ timedOut });
      });
    }
  });
};

const stageFixture = ({ skill, row, runDir }: { skill: string; row: EvalRow; runDir: string }) => {
  const fixture = join(FIXTURES_DIR, skill, row.id);
  assert(fixture.startsWith(FIXTURES_DIR + sep), `a fixture must stay under ${FIXTURES_DIR}, got ${fixture}`);
  assert(existsSync(runDir), `a fixture is staged into a run directory that exists, got ${runDir}`);
  const hasFixture = existsSync(fixture);
  const setup = join(fixture, FIXTURE_SETUP);
  const allowedToolsFile = join(fixture, FIXTURE_ALLOWED_TOOLS);
  if (!hasFixture) return { hasFixture, allowedToolsFile, setupFailed: false };
  cpSync(fixture, runDir, {
    recursive: true,
    filter: (source: string) => source !== setup && source !== allowedToolsFile,
  });
  if (!existsSync(setup)) return { hasFixture, allowedToolsFile, setupFailed: false };
  const built = spawnSync("bash", [setup, fixture], {
    cwd: runDir,
    encoding: "utf8",
  });
  writeFileSync(`${runDir}.setup.log`, `${built.stdout ?? ""}${built.stderr ?? ""}`);
  return { hasFixture, allowedToolsFile, setupFailed: built.status !== 0 };
};

const claudeArgs = ({ arm, prompt, snapshot, tempDir, extraRules, budgetUsd, model }: ClaudeArgs) => {
  assert(ARMS.includes(arm), `an arm is one of ${ARMS.join(", ")}, got ${JSON.stringify(arm)}`);
  assert(prompt, `claude needs a prompt, got ${JSON.stringify(prompt)}`);
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
    ...(budgetUsd ? ["--max-budget-usd", String(budgetUsd)] : []),
    ...(model ? ["--model", model] : []),
  ];
  assert(args[1] === prompt, `the prompt must follow -p, got ${JSON.stringify(args[1])}`);
  assert(arm === ARM_SKILL || !args.includes("--plugin-dir"), `the ${arm} arm must not load the plugin, got ${JSON.stringify(args)}`);
  return args;
};

async function runOne({ skill, evals, arm, row, n, out, snapshot, budgetUsd, model }: RunJob): Promise<RunRow> {
  assert(ARMS.includes(arm), `an arm is one of ${ARMS.join(", ")}, got ${JSON.stringify(arm)}`);
  assert(Number.isInteger(n) && n >= 1, `a run number is a positive integer, got ${n}`);
  assert(budgetUsd === null || budgetUsd > 0, `a run budget is positive or unset, got ${budgetUsd}`);
  const runDir = join(out, skill, row.id, `${arm}-${n}`);
  const base: RunRow = {
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
  const extraRules = existsSync(allowedToolsFile) ? readFileSync(allowedToolsFile, "utf8").split(LINE_BREAK).filter((line) => line.trim()) : [];

  const persona = readFileSync(join(runDir, "persona.md"), "utf8").trimEnd();
  const template = arm === ARM_BASELINE ? evals.baselineTemplate : evals.skillTemplate;
  assert(template, `the ${arm} arm of ${skill} needs an agent template, got ${JSON.stringify(template)}`);
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

const gradeRun = ({ base, skill, arm, row, runDir, prompt, timedOut, secs }: GradeRun): RunRow => {
  assert(base.id === row.id && base.arm === arm && base.skill === skill, `the base row must describe the run being graded, got ${JSON.stringify(base)} for ${skill} ${row.id} ${arm}`);
  assert(existsSync(join(runDir, "transcript.jsonl")), `grading reads the transcript of ${runDir}, which is missing`);
  const transcript = readFileSync(join(runDir, "transcript.jsonl"), "utf8");
  const { flags, result } = inspectRun({ transcript, arm, skill, timedOut });
  writeFileSync(join(runDir, "prompt.txt"), prompt);
  writeFileSync(join(runDir, "output.md"), result?.result ? `${result.result}\n` : "");
  const notes = flags.filter((flag: string) => flag.startsWith(DENIED_NOTE));
  const failures = flags.filter((flag: string) => !notes.includes(flag));
  const harness = [...(failures.length ? failures : [HARNESS_OK]), ...notes].join(",");
  return {
    ...base,
    harness,
    failed: failures.length > 0,
    checks: gradeChecks(skill, row.id, runDir),
    judge: gradeJudge(skill, row.id, runDir, row.pass),
    cost: (result?.total_cost_usd ?? 0).toFixed(2),
    costUsd: result?.total_cost_usd ?? 0,
    secs,
  };
};

export function smokeScenarioIds(markdown: string, rowIds: string[]) {
  assert(rowIds.length > 0, `a smoke run needs at least one scenario to choose from, got ${rowIds.length}`);
  assert(new Set(rowIds).size === rowIds.length, `scenario ids must be unique, got ${JSON.stringify(rowIds)}`);
  const known = new Set(rowIds);
  const coverage = new Map<string, Set<number>>(rowIds.map((id) => [id, new Set<number>()]));
  parseChecks(markdown).checks.forEach((check, index) => {
    for (const expect of check.expects) {
      for (const id of expect.ids ?? []) if (known.has(id)) coverage.get(id)!.add(index);
    }
  });
  const uncovered = new Set([...coverage.values()].flatMap((checks) => [...checks]));
  const chosen = new Set<string>();
  while (uncovered.size) {
    let best = "";
    let bestGain = 0;
    for (const [id, checks] of coverage) {
      const gain = [...checks].filter((index) => uncovered.has(index)).length;
      if (gain > bestGain) {
        best = id;
        bestGain = gain;
      }
    }
    chosen.add(best);
    for (const index of coverage.get(best)!) uncovered.delete(index);
  }
  const smoke = chosen.size ? rowIds.filter((id) => chosen.has(id)) : rowIds.slice(0, 1);
  assert(smoke.length > 0 && smoke.every((id) => known.has(id)), `a smoke run picks known scenarios, got ${JSON.stringify(smoke)} from ${JSON.stringify(rowIds)}`);
  return smoke;
}

const passed = (row: GradedRun) => !row.failed && PASSING_GRADES.has(row.checks) && PASSING_GRADES.has(row.judge); // zanity: ignore[assertion-density] -- no-invariant: grades are validated against KNOWN_GRADES where gradeJudge produces them and an unknown grade already counts as not passed

export function scenarioVerdicts({ ids, results, unlaunchedIds, rerunFailures }: { ids: string[]; results: GradedRun[]; unlaunchedIds: Set<string>; rerunFailures: boolean }): Verdicts {
  assert(new Set(ids).size === ids.length, `scenario ids must be unique, got ${JSON.stringify(ids)}`);
  assert(unlaunchedIds instanceof Set, `unlaunched ids must be a Set, got ${Object.prototype.toString.call(unlaunchedIds)}`);
  const verdicts = Object.fromEntries(
    ids.map((id) => {
      const runs = results.filter((row) => row.id === id).sort((a, b) => a.run - b.run);
      let verdict: string;
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
  assert(Object.keys(verdicts).length === ids.length, `every scenario gets one verdict, got ${JSON.stringify(verdicts)} for ${JSON.stringify(ids)}`);
  assert(Object.values(verdicts).every((verdict) => VERDICTS.includes(verdict)), `a verdict is one of ${VERDICTS.join(", ")}, got ${JSON.stringify(verdicts)}`);
  return verdicts;
}

const selectScenarios = (options: ParsedOptions, evals: ParsedEvals, arm: Arm, markdown: string) => {
  assert(ARMS.includes(arm), `an arm is one of ${ARMS.join(", ")}, got ${JSON.stringify(arm)}`);
  if (!evals.rows.length) usage(`${options.skill} lists no scenario rows under ## Test Scenarios.`);
  if (arm === ARM_BASELINE && !evals.baselineTemplate) usage(`${options.skill} has no ### Baseline Agent template.`);
  if (arm === ARM_SKILL && !evals.skillTemplate) usage(`${options.skill} has no ### Skill Agent template.`);
  const template = arm === ARM_BASELINE ? evals.baselineTemplate : evals.skillTemplate;
  if (!template!.includes(PROMPT_PLACEHOLDER)) usage(`The ${arm} agent template of ${options.skill} must carry ${PROMPT_PLACEHOLDER}, or the prompt is dropped.`);
  const allIds = evals.rows.map((row) => row.id);
  const unusableIds = allIds.filter((id) => UNUSABLE_ID.test(id));
  if (unusableIds.length) usage(`Scenario ids must be non-blank and free of path separators, tabs and newlines, got ${JSON.stringify(unusableIds)}; rename them in the table.`);
  const repeatedIds = [...new Set(allIds.filter((id, index) => allIds.indexOf(id) !== index))];
  if (repeatedIds.length) usage(`Scenario ids must be unique, got ${JSON.stringify(repeatedIds)} more than once; rename the repeats.`);
  const unknown = options.ids.filter((id) => !evals.rows.some((row) => row.id === id));
  if (unknown.length) usage(`No such scenario in ${options.skill}: ${unknown.join(", ")}`);
  const wanted = new Set(options.smoke ? smokeScenarioIds(markdown, allIds) : options.ids.length ? options.ids : allIds);
  const selected = evals.rows.filter((row) => wanted.has(row.id));
  const malformed = selected.filter((row) => row.cells !== ROW_CELLS);
  if (malformed.length) usage(`Rows without ${ROW_CELLS} cells: ${malformed.map((row) => row.id).join(", ")}`);
  const blankPrompts = selected.filter((row) => !row.prompt?.trim());
  if (blankPrompts.length) usage(`Rows with a blank Prompt cell: ${blankPrompts.map((row) => row.id).join(", ")}; fill the cell.`);
  assert(selected.length > 0, `no scenario selected from ${JSON.stringify(allIds)} with ${JSON.stringify(options.ids)}`);
  return selected;
};

const runQueue = async (items: RunJob[], jobs: number, ledger: Ledger) => {
  assert(Number.isInteger(jobs) && jobs >= 1, `a queue needs at least one job, got ${jobs}`);
  assert(ledger.spent >= 0 && ledger.limit > 0, `a ledger starts unspent under a positive limit, got ${JSON.stringify(ledger)}`);
  const queue = [...items];
  const results: RunRow[] = [];
  await Promise.all(
    Array.from({ length: Math.min(jobs, queue.length) }, async () => {
      while (queue.length && ledger.spent < ledger.limit) {
        const result = await runOne(queue.shift()!);
        ledger.spent += result.costUsd;
        results.push(result);
      }
    }),
  );
  assert(results.length + queue.length === items.length, `every item is run or left unlaunched, got ${results.length} run and ${queue.length} unlaunched of ${items.length}`);
  return { results, unlaunched: queue };
};

const report = ({ options, out, results, verdicts }: { options: ParsedOptions; out: string; results: RunRow[]; verdicts: Verdicts }) => {
  assert(existsSync(out), `the report is written into an output directory that exists, got ${out}`);
  assert(results.every((row) => Object.hasOwn(verdicts, row.id)), `every run needs a verdict for its scenario, got ${JSON.stringify(verdicts)} for ${JSON.stringify(results.map((row) => row.id))}`);
  writeFileSync(join(out, "summary.tsv"), summaryTsv(results));
  const cells = [SUMMARY_COLUMNS, ...results.map((row: Record<string, unknown>) => SUMMARY_COLUMNS.map((column) => String(row[column])))];
  const widths = SUMMARY_COLUMNS.map((_, i) => Math.max(...cells.map((r) => r[i].length)));
  const lines = cells.map((r) =>
    r
      .map((cell, i) => cell.padEnd(widths[i]))
      .join("  ")
      .trimEnd(),
  );
  console.log(lines.join("\n"));
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
  assert(existsSync(SKILLS_DIR), `skills are read from ${SKILLS_DIR}; run from the repository root`);
  const options = parseArgs(process.argv.slice(2));
  const evalsPath = join(SKILLS_DIR, options.skill, "evals.md");
  const markdown = existsSync(evalsPath) ? readFileSync(evalsPath, "utf8") : "";
  if (!markdown.trim()) usage(`No such skill with evals, or its evals.md is empty: ${options.skill}`);
  const evals = parseEvals(markdown);
  const arm: Arm = options.baseline ? ARM_BASELINE : ARM_SKILL;
  const selected = selectScenarios(options, evals, arm, markdown);

  const out = options.out ?? join(tmpdir(), `gated-delivery-evals-${options.skill}-${Date.now()}`);
  const snapshot = join(out, "plugin");
  mkdirSync(out, { recursive: true });
  if (arm === ARM_SKILL) {
    cpSync(PLUGIN_DIR, snapshot, {
      recursive: true,
      filter: (source: string) => basename(source) !== "evals.md",
    });
  }

  const ledger: Ledger = { spent: 0, limit: options.totalBudgetUsd ?? Number.POSITIVE_INFINITY };
  const plan = (rows: EvalRow[], count: number, firstRun: number) => {
    assert(Number.isInteger(count) && count >= 1, `a plan repeats each row at least once, got ${count}`);
    assert(Number.isInteger(firstRun) && firstRun >= 1, `run numbers start at 1 or later, got ${firstRun}`);
    const items = rows.flatMap((row) =>
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
    assert(items.length === rows.length * count, `a plan holds ${count} runs per row, got ${items.length} items for ${rows.length} rows`);
    return items;
  };
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
  results.sort((a, b) => rank.get(a.id)! - rank.get(b.id)! || a.run - b.run);
  const verdicts = scenarioVerdicts({
    ids: selected.map((row) => row.id),
    results,
    unlaunchedIds: new Set(unlaunched.map((item) => item.row.id)),
    rerunFailures: options.rerunFailures,
  });
  assert(Object.keys(verdicts).length === selected.length, `every selected scenario needs a verdict, got ${JSON.stringify(verdicts)}`);
  writeFileSync(join(out, VERDICTS_FILE), JSON.stringify({ verdicts, totalCostUsd: ledger.spent, runs: results.length }));

  return report({ options, out, results, verdicts });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const timeoutSetting = process.env.GATED_DELIVERY_RUN_TIMEOUT_SECONDS;
  if (timeoutSetting && !(Number.isFinite(Number(timeoutSetting)) && Number(timeoutSetting) > 0)) usage(`GATED_DELIVERY_RUN_TIMEOUT_SECONDS needs a positive number of seconds, got "${timeoutSetting}"; fix or unset it.`);
  try {
    process.exitCode = await main();
  } catch (error) {
    console.error(`harness error, not an eval failure: ${(error as Error | undefined)?.stack ?? error}`);
    for (const pid of liveGroups) signalGroup(pid, SIGNAL_TERM);
    process.exit(EXIT_INTERNAL_ERROR);
  }
}
