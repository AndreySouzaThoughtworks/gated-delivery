#!/usr/bin/env node

import assert from "node:assert";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import { RULES_DIRECTORY, inventoryProblems } from "../audit/rule-inventory.ts";
import type { Inventory } from "../audit/rule-inventory.ts";

const SKILLS_PREFIX = "plugin/skills";
const AGENTS_PREFIX = "plugin/agents";
const RESULTS_DIR = "evals/results";
const SKILL_FILE = "SKILL.md";
const UNHASHED_SKILL_FILE = /^(?:evals\.md|scripts\/.*\.test\.[^/]+)$/;
const SKILL_PATH = new RegExp(`^${SKILLS_PREFIX}/([^/]+)/(.+)$`);
const AGENT_PATH = new RegExp(`^${AGENTS_PREFIX}/([^/]+)\\.md$`);
const LINE_BREAK = /\r?\n/;
const DEFAULT_BASE_REF = "origin/main";
export const BASE_REF_ENV = "GATED_DELIVERY_BASE_REF";
const CONFIGURED_BASE_REF = process.env[BASE_REF_ENV] || DEFAULT_BASE_REF;
const CLAUDE_BIN = process.env.GATED_DELIVERY_CLAUDE_BIN || "claude";

const EXIT_PASSED = 0;
const EXIT_FAILED = 1;
const EXIT_USAGE = 2;
const EXIT_NOTHING_RUN = 3;
const EXIT_HARNESS_ERROR = 4;
const SKILL_NAME = /^[^./\\][^/\\]*$/;

const TIER_SMOKE = "smoke";
const TIER_FULL = "full";
const SMOKE_BUDGET_USD = "2";
const SMOKE_TOTAL_BUDGET_USD = "20";
const PASSING_VERDICTS = new Set(["pass", "flaky"]);
const VERDICT_FLAKY = "flaky";
const PROBE_ARGS = ["-p", "reply with the word ok", "--setting-sources", "", "--output-format", "json", "--max-budget-usd", "0.05"];
const PROBE_TIMEOUT_MS = 120000;
const PROBE_DETAIL_CHARS = 200;
const CREDENTIAL_HINT = "claude is not authenticated for these flags: log in with claude auth login, or set a working ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN (claude setup-token)";
const VERDICTS_FILE = "verdicts.json";
const RUNNER = join("scripts", "eval", "run-scenarios.ts");

const USAGE = [
  "usage: changed-skills.ts [skill…] [--full] [--budget-usd N] [--total-budget-usd N] [--model M] [--jobs N]",
  '       changed-skills.ts --waive <skill> --reason "<text>"',
  "       changed-skills.ts --static <skill>   (no model run: records that the skill's scripts and deterministic checks pass)",
  "exit codes: 0 passed, waived, statically stamped or nothing to run, 1 evals or a static check failed, 2 usage error, 3 claude cannot run so no eval ran, 4 harness error (an internal check or file operation failed)",
].join("\n");
const WAIVER_KEY = "waived";
const STATUS_WAIVED = "waived";
const STATIC_KEY = "static";
const STATUS_STATIC = "static";
const RESULT_PASS = "pass";
const RESULT_FAIL = "fail";
const RESULT_NONE = "none";
const SCRIPTS_DIR = "scripts";
const RUN_CHECKS = join("scripts", "eval", "run-checks.ts");
const CHECK_LINT = "lint";
const CHECK_SCRIPT_TESTS = "script-tests";
const CHECK_RULE_ANCHORS = "rule-anchors";
const JSON_EXTENSION = ".json";
const NODE_TEST = ["node", "--test"];
export const SKILL_SCRIPT_TESTS: Record<string, string[][]> = {
  deskcheck: [[...NODE_TEST, "scripts/audit/deskcheck-lint.test.ts"]],
  "issue-writing": [[...NODE_TEST, "scripts/audit/guardrail-scan.test.ts"]],
  "prose-writing": [[...NODE_TEST, "scripts/audit/prose-scan.test.ts", "scripts/audit/consistency-prose-tics.test.ts"]],
  slice: [[...NODE_TEST, "scripts/resolve-verify-cmd.test.ts"], ["bash", "tests/slice-scripts.test.sh"]],
  spec: [[...NODE_TEST, "scripts/audit/spec-lint.test.ts"]],
};
const VALUE_FLAGS = ["--budget-usd", "--total-budget-usd", "--model", "--jobs"];

type Report = { verdicts: Record<string, string>; totalCostUsd?: number };
type Outcome = { skill: string; hash: string; passed: false; report?: undefined } | { skill: string; hash: string; passed: boolean; report: Report };
type Options = { skills: string[]; full: boolean; passthrough: string[]; waive: string | null; reason: string | null; staticSkill: string | null; error: string | null };
type CheckResult = { result: typeof RESULT_PASS | typeof RESULT_FAIL | typeof RESULT_NONE; detail: string };
export type StaticCheck = { name: string; run: (root: string, skill: string) => CheckResult };

const lintCheck = (root: string, skill: string): CheckResult => {
  assert(SKILL_NAME.test(skill), `lintCheck needs a skill folder name, got ${JSON.stringify(skill)}`);
  const run = spawnSync("node", [RUN_CHECKS, "--lint", skill], { cwd: root, encoding: "utf8" });
  assert(run.error === undefined, `lintCheck could not start ${RUN_CHECKS}: ${run.error?.message}`);
  return { result: run.status === 0 ? RESULT_PASS : RESULT_FAIL, detail: `${run.stdout}${run.stderr}`.trim() };
};

const scriptTestsCheck = (root: string, skill: string): CheckResult => {
  assert(SKILL_NAME.test(skill), `scriptTestsCheck needs a skill folder name, got ${JSON.stringify(skill)}`);
  assert(existsSync(root), `scriptTestsCheck needs an existing repository directory, got ${root}`);
  if (!existsSync(join(root, SKILLS_PREFIX, skill, SCRIPTS_DIR))) return { result: RESULT_NONE, detail: "the skill has no scripts" };
  const commands = SKILL_SCRIPT_TESTS[skill] ?? [];
  if (!commands.length) return { result: RESULT_FAIL, detail: `${skill} has scripts but no entry in SKILL_SCRIPT_TESTS; map the tests that cover them` };
  for (const [program, ...args] of commands) {
    const run = spawnSync(program, args, { cwd: root, encoding: "utf8" });
    if (run.status !== 0) return { result: RESULT_FAIL, detail: `${[program, ...args].join(" ")} exited ${run.status}\n${run.stdout}${run.stderr}`.trim() };
  }
  return { result: RESULT_PASS, detail: commands.map((command) => command.join(" ")).join("; ") };
};

const ruleAnchorsCheck = (root: string, skill: string): CheckResult => {
  assert(SKILL_NAME.test(skill), `ruleAnchorsCheck needs a skill folder name, got ${JSON.stringify(skill)}`);
  assert(existsSync(root), `ruleAnchorsCheck needs an existing repository directory, got ${root}`);
  const directory = join(root, RULES_DIRECTORY);
  const skillFile = `${SKILLS_PREFIX}/${skill}/${SKILL_FILE}`;
  const names = existsSync(directory) ? readdirSync(directory).filter((name) => name.endsWith(JSON_EXTENSION)).sort() : [];
  const problems: string[] = [];
  let inventories = 0;
  for (const name of names) {
    const label = `${RULES_DIRECTORY}/${name}`;
    try {
      const inventory: Inventory = JSON.parse(readFileSync(join(directory, name), "utf8"));
      if (inventory.file !== skillFile) continue;
      inventories += 1;
      problems.push(...inventoryProblems(root, label, inventory));
    } catch (failure) {
      problems.push(`${label} is not a usable inventory: ${failure instanceof Error ? failure.message : failure}`);
    }
  }
  if (problems.length > 0) return { result: RESULT_FAIL, detail: problems.join("\n") };
  return inventories === 0 ? { result: RESULT_NONE, detail: "the skill has no rule inventory" } : { result: RESULT_PASS, detail: `${inventories} rule inventory, every anchor present` };
};

export const STATIC_CHECKS: StaticCheck[] = [
  { name: CHECK_LINT, run: lintCheck },
  { name: CHECK_SCRIPT_TESTS, run: scriptTestsCheck },
  { name: CHECK_RULE_ANCHORS, run: ruleAnchorsCheck },
];

const filesUnder = (dir: string) => (existsSync(dir) ? readdirSync(dir, { recursive: true, encoding: "utf8" }).filter((name) => statSync(join(dir, name)).isFile()) : []); // zanity: ignore[assertion-density] -- no-invariant: the directory comes from a validated root and the result is one listing whose only failures are the filesystems own

const agentsNamedBy = (root: string, skill: string) => {
  assert(SKILL_NAME.test(skill), `agentsNamedBy needs a skill folder name, got ${JSON.stringify(skill)}`);
  const skillText = readFileSync(join(root, SKILLS_PREFIX, skill, SKILL_FILE), "utf8");
  assert(skillText.trim() !== "", `${SKILLS_PREFIX}/${skill}/${SKILL_FILE} is empty; expected the skill text the agent names are matched against`);
  const agents = filesUnder(join(root, AGENTS_PREFIX))
    .filter((name) => name.endsWith(".md"))
    .filter((name) => new RegExp(`(?<![\\w-])${name.slice(0, -".md".length)}(?![\\w-])`).test(skillText))
    .map((name) => `${AGENTS_PREFIX}/${name}`);
  return agents;
};

export const skillHash = (root: string, skill: string) => {
  assert(root !== "", `skillHash needs the repository root, got ${JSON.stringify(root)}`);
  assert(SKILL_NAME.test(skill), `skillHash needs a skill folder name, got ${JSON.stringify(skill)}`);
  const own = filesUnder(join(root, SKILLS_PREFIX, skill))
    .map((name) => name.split("\\").join("/"))
    .filter((name) => !UNHASHED_SKILL_FILE.test(name))
    .map((name) => `${SKILLS_PREFIX}/${skill}/${name}`);
  const files = [...new Set([...own, ...agentsNamedBy(root, skill)])].sort();
  const digest = createHash("sha256");
  for (const path of files) {
    digest.update(`${path}\0`);
    digest.update(readFileSync(join(root, path)));
    digest.update("\0");
  }
  const hash = digest.digest("hex");
  return hash;
};

const lines = (text: string) => text.split(LINE_BREAK).filter(Boolean); // zanity: ignore[assertion-density] -- thin-wrapper: text is git command output and the result is one split-and-filter whose only possible failures are the splitter's own guarantees

export const changedPaths = (root: string, baseRef: string) => {
  assert(existsSync(root), `changedPaths needs an existing repository directory, got ${root}`);
  assert(baseRef !== "", `changedPaths needs a base ref, got ${JSON.stringify(baseRef)}; expected a branch or commit name`);
  const mergeBase = execFileSync("git", ["merge-base", baseRef, "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const listings = [["diff", "--name-only", `${mergeBase}..HEAD`], ["diff", "--name-only", "HEAD"], ["ls-files", "--others", "--exclude-standard"]];
  return new Set(listings.flatMap((args) => lines(execFileSync("git", args, { cwd: root, encoding: "utf8" }))));
};

export const fileAtBase = (root: string, baseRef: string, path: string) => {
  assert(baseRef !== "", `fileAtBase needs a base ref, got ${JSON.stringify(baseRef)}; expected a branch or commit name`);
  assert(!isAbsolute(path), `fileAtBase needs a path relative to the repository root, got ${path}`);
  const mergeBase = execFileSync("git", ["merge-base", baseRef, "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const shown = spawnSync("git", ["show", `${mergeBase}:${path}`], { cwd: root, encoding: "utf8" });
  return shown.status === 0 ? shown.stdout : null;
};

export const changedSkills = (root: string, baseRef: string) => {
  assert(root !== "", `changedSkills needs the repository root, got ${JSON.stringify(root)}`);
  assert(baseRef !== "", `changedSkills needs a base ref, got ${JSON.stringify(baseRef)}; expected a branch or commit name`);
  const skills = filesUnder(join(root, SKILLS_PREFIX))
    .map((name) => name.split(/[\\/]/)[0])
    .filter((name, index, all) => all.indexOf(name) === index)
    .filter((name) => existsSync(join(root, SKILLS_PREFIX, name, SKILL_FILE)));
  const touched = new Set<string>();
  for (const path of changedPaths(root, baseRef)) {
    const inSkill = path.match(SKILL_PATH);
    if (inSkill && !UNHASHED_SKILL_FILE.test(inSkill[2])) touched.add(inSkill[1]);
    const agent = path.match(AGENT_PATH);
    if (agent) for (const skill of skills) if (agentsNamedBy(root, skill).includes(path)) touched.add(skill);
  }
  const changed = skills.filter((skill) => touched.has(skill)).sort();
  return changed;
};

const stampPath = (root: string, skill: string) => {
  assert(root !== "", `stampPath needs the repository root, got ${JSON.stringify(root)}`);
  assert(SKILL_NAME.test(skill), `stampPath needs a skill folder name, got ${JSON.stringify(skill)}; anything else could point outside ${RESULTS_DIR}`);
  const path = join(root, RESULTS_DIR, `${skill}.json`);
  return path;
};

const readStamp = (root: string, skill: string): Record<string, unknown> => {
  const path = stampPath(root, skill);
  assert(existsSync(path), `no stamp for ${skill} at ${path}`);
  const stamp = JSON.parse(readFileSync(path, "utf8"));
  assert(typeof stamp === "object" && stamp !== null && !Array.isArray(stamp), `stamp ${path} holds ${JSON.stringify(stamp)}; expected a JSON object`);
  return stamp;
};

export const waiverReason = (root: string, skill: string) => {
  const stamp = readStamp(root, skill);
  assert(Object.hasOwn(stamp, WAIVER_KEY), `stamp for ${skill} has no ${WAIVER_KEY} entry; expected a waiver`);
  assert(typeof stamp[WAIVER_KEY] === "string", `stamp for ${skill} has ${WAIVER_KEY}=${JSON.stringify(stamp[WAIVER_KEY])}; expected the waiver reason text`);
  return stamp[WAIVER_KEY];
};

const staticStampIsComplete = (record: unknown) => { // zanity: ignore[assertion-density] -- no-invariant: the record is untrusted stamp JSON and every shape of it is answered with false so nothing is left to assert
  const checks = (record as { checks?: unknown } | null)?.checks;
  if (!Array.isArray(checks) || checks.length === 0) return false;
  const passing = checks.filter((check) => check?.result === RESULT_PASS || check?.result === RESULT_NONE).map((check) => check.name);
  return passing.length === checks.length && STATIC_CHECKS.every((registered) => passing.includes(registered.name));
};

export const stampStatus = (root: string, skill: string) => {
  assert(root !== "", `stampStatus needs the repository root, got ${JSON.stringify(root)}`);
  assert(SKILL_NAME.test(skill), `stampStatus needs a skill folder name, got ${JSON.stringify(skill)}`);
  if (!existsSync(stampPath(root, skill))) return "missing";
  const stamp = readStamp(root, skill);
  const waiver = stamp[WAIVER_KEY];
  const waived = Object.hasOwn(stamp, WAIVER_KEY);
  if (waived && Object.hasOwn(stamp, STATIC_KEY)) return "waived-and-static";
  if (waived && (typeof waiver !== "string" || waiver.trim() === "")) return "blank-waiver";
  if (stamp.hash !== skillHash(root, skill)) return "stale";
  if (Object.hasOwn(stamp, STATIC_KEY)) return staticStampIsComplete(stamp[STATIC_KEY]) ? STATUS_STATIC : "static-incomplete";
  return waived ? STATUS_WAIVED : "ok";
};

const optionsProblem = (options: Options, root: string) => { // zanity: ignore[assertion-density] -- no-invariant: every option shape is answered with a usage message so no precondition is left to assert
  if (options.waive === null && options.reason !== null) return "--reason belongs to --waive";
  if (options.waive !== null && options.staticSkill !== null) return "--waive and --static cannot be combined";
  const single = options.waive ?? options.staticSkill;
  const extras = options.skills.length + options.passthrough.length + Number(options.full);
  if (single !== null && extras > 0) return "--waive and --static take no other skills or flags";
  if (options.waive !== null && !options.reason?.trim()) return "--waive needs a non-blank --reason";
  for (const skill of single === null ? options.skills : [single]) {
    if (!SKILL_NAME.test(skill)) return `not a skill name: ${skill}; pass the folder name under ${SKILLS_PREFIX}, not a path`;
    if (!existsSync(join(root, SKILLS_PREFIX, skill, SKILL_FILE))) return `no such skill: ${skill}`;
  }
  return null;
};

const parseArgs = (argv: string[], root: string): Options => { // zanity: ignore[assertion-density] -- no-invariant: every argument shape is handled by returning an error so no precondition is left to assert
  const options: Options = { skills: [], full: false, passthrough: [], waive: null, reason: null, staticSkill: null, error: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--full") options.full = true;
    else if (arg === "--waive" && argv[i + 1] !== undefined) options.waive = argv[++i];
    else if (arg === "--static" && argv[i + 1] !== undefined) options.staticSkill = argv[++i];
    else if (arg === "--reason" && argv[i + 1] !== undefined) options.reason = argv[++i];
    else if (VALUE_FLAGS.includes(arg) && argv[i + 1] !== undefined) options.passthrough.push(arg, argv[++i]);
    else if (!arg.startsWith("--")) options.skills.push(arg);
    else return { ...options, error: `Unknown or incomplete argument: ${arg}` };
  }
  return { ...options, error: optionsProblem(options, root) };
};

const EMPTY_PROBE_DETAIL = "claude reported an error and gave no detail";

const probeProblem = (passthrough: string[]) => { // zanity: ignore[assertion-density] -- io-wrapper: spawns the claude probe and its one postcondition on the problem text is asserted
  const scratch = mkdtempSync(join(tmpdir(), "gated-delivery-probe-"));
  let problem = null;
  try {
    const modelAt = passthrough.indexOf("--model");
    const model = modelAt === -1 ? process.env.GATED_DELIVERY_RUN_MODEL : passthrough[modelAt + 1];
    const modelFlags = model ? ["--model", model] : [];
    const probe = spawnSync(CLAUDE_BIN, [...PROBE_ARGS, ...modelFlags], {
      cwd: scratch,
      encoding: "utf8",
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: PROBE_TIMEOUT_MS,
    });
    let reply = null;
    try {
      reply = JSON.parse(probe.stdout);
    } catch {
      reply = null;
    }
    if (reply?.is_error) problem = reply.result ? String(reply.result) : EMPTY_PROBE_DETAIL;
    else if (probe.error) problem = probe.error.message;
    else if (probe.status !== 0 || reply === null) problem = probe.stdout || probe.stderr || `exit ${probe.status}`;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  assert(problem === null || problem.trim() !== "", `probeProblem built a blank problem ${JSON.stringify(problem)}; expected null or a readable detail`);
  return problem;
};

const runSkill = (root: string, skill: string, options: Options): Outcome => { // zanity: ignore[assertion-density] -- io-wrapper: spawns the scenario runner and its one postcondition on the verdicts file is asserted
  const out = mkdtempSync(join(tmpdir(), `gated-delivery-changed-${skill}-`));
  const smokeDefaults = [
    ["--budget-usd", SMOKE_BUDGET_USD],
    ["--total-budget-usd", SMOKE_TOTAL_BUDGET_USD],
  ].filter(([flag]) => !options.passthrough.includes(flag));
  const tierFlags = options.full ? [] : ["--smoke", "--rerun-failures", ...smokeDefaults.flat()];
  const hash = skillHash(root, skill);
  const { status } = spawnSync("node", [RUNNER, skill, "--out", out, ...tierFlags, ...options.passthrough], {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  });
  const verdictsPath = join(out, VERDICTS_FILE);
  if (!existsSync(verdictsPath)) return { skill, passed: false, hash };
  const report: Report = JSON.parse(readFileSync(verdictsPath, "utf8"));
  assert(typeof report.verdicts === "object" && report.verdicts !== null, `${verdictsPath} has verdicts=${JSON.stringify(report.verdicts)}; expected an object of scenario verdicts`);
  const verdicts = Object.values(report.verdicts);
  return {
    skill,
    hash,
    report,
    passed: status === 0 && verdicts.length > 0 && verdicts.every((verdict) => PASSING_VERDICTS.has(verdict)),
  };
};

export const stampStatically = (root: string, skill: string) => {
  assert(SKILL_NAME.test(skill), `stampStatically needs a skill folder name, got ${JSON.stringify(skill)}`);
  assert(existsSync(root), `stampStatically needs an existing repository directory, got ${root}`);
  const hash = skillHash(root, skill);
  const checks = STATIC_CHECKS.map((check) => ({ name: check.name, ...check.run(root, skill) }));
  for (const check of checks) console.log(`${check.result.toUpperCase()} ${skill} ${check.name}${check.result === RESULT_PASS ? "" : `: ${check.detail}`}`);
  if (checks.some((check) => check.result === RESULT_FAIL)) {
    console.log(`FAILED ${skill} (static): no stamp written`);
    return EXIT_FAILED;
  }
  const path = stampPath(root, skill);
  mkdirSync(dirname(path), { recursive: true });
  const record = { checks: checks.map(({ name, result }) => ({ name, result })), ranAt: new Date().toISOString() };
  writeFileSync(path, `${JSON.stringify({ hash, [STATIC_KEY]: record }, null, 2)}\n`);
  console.log(`STATIC ${skill}: scripts and deterministic checks pass; this does not prove the model follows the skill`);
  return EXIT_PASSED;
};

const main = (argv: string[], root = process.cwd()) => { // zanity: ignore[assertion-density] -- entry-point: CLI entry that orchestrates functions which validate their own inputs
  const options = parseArgs(argv, root);
  if (options.error) {
    console.error(`${options.error}\n${USAGE}`);
    return EXIT_USAGE;
  }
  if (options.staticSkill !== null) return stampStatically(root, options.staticSkill);
  if (options.waive !== null) {
    const path = stampPath(root, options.waive);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify({ hash: skillHash(root, options.waive), [WAIVER_KEY]: options.reason, ranAt: new Date().toISOString() }, null, 2)}\n`);
    console.log(`WAIVED ${options.waive}: ${options.reason}`);
    return EXIT_PASSED;
  }
  const skills = options.skills.length ? options.skills : changedSkills(root, CONFIGURED_BASE_REF);
  if (!skills.length) {
    console.log("No skill changed: nothing to run.");
    return EXIT_PASSED;
  }
  const probeFailure = probeProblem(options.passthrough);
  if (probeFailure !== null) {
    console.log(`SKIPPED: claude cannot run with the eval flags: ${probeFailure.slice(0, PROBE_DETAIL_CHARS)}`);
    console.log(`No eval ran for ${skills.join(", ")}; this is not a pass. Hint: ${CREDENTIAL_HINT}`);
    return EXIT_NOTHING_RUN;
  }
  const tier = options.full ? TIER_FULL : TIER_SMOKE;
  const outcomes = skills.map((skill) => runSkill(root, skill, options));
  outcomes.forEach((outcome) => {
    for (const [id, verdict] of Object.entries(outcome.report?.verdicts ?? {})) {
      if (verdict === VERDICT_FLAKY) console.log(`FLAKY ${outcome.skill} ${id}: failed once, passed on rerun`);
    }
    if (outcome.report !== undefined && outcome.passed) {
      const path = stampPath(root, outcome.skill);
      mkdirSync(dirname(path), { recursive: true });
      const stamp = {
        hash: outcome.hash,
        tier,
        scenarios: Object.keys(outcome.report.verdicts),
        verdicts: outcome.report.verdicts,
        totalCostUsd: outcome.report.totalCostUsd,
        ranAt: new Date().toISOString(),
      };
      writeFileSync(path, `${JSON.stringify(stamp, null, 2)}\n`);
    }
    console.log(`${outcome.passed ? "PASSED" : "FAILED"} ${outcome.skill} (${tier})`);
  });
  return outcomes.every((outcome) => outcome.passed) ? EXIT_PASSED : EXIT_FAILED;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(error);
    process.exitCode = EXIT_HARNESS_ERROR;
  }
}
