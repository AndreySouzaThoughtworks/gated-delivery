#!/usr/bin/env node

import assert from "node:assert";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";

const SKILLS_PREFIX = "plugin/skills";
const AGENTS_PREFIX = "plugin/agents";
const RESULTS_DIR = "evals/results";
const EVALS_FILE = "evals.md";
const SKILL_FILE = "SKILL.md";
const SCRIPTS_PREFIX = "scripts/";
const TEST_FILE = /\.test\.[^/]+$/;
const SKILL_PATH = new RegExp(`^${SKILLS_PREFIX}/([^/]+)/(.+)$`);
const AGENT_PATH = new RegExp(`^${AGENTS_PREFIX}/([^/]+)\\.md$`);
const LINE_BREAK = /\r?\n/;
const DEFAULT_BASE_REF = "origin/main";
export const BASE_REF_ENV = "GATED_DELIVERY_BASE_REF";
const CLAUDE_BIN = process.env.GATED_DELIVERY_CLAUDE_BIN || "claude";

const EXIT_PASSED = 0;
const EXIT_FAILED = 1;
const EXIT_USAGE = 2;
const EXIT_NOTHING_RUN = 3;
const EXIT_HARNESS_ERROR = 4;
const SKILL_NAME = /^[^./\\][^/\\]*$/;

const TIER_SMOKE = "smoke";
const TIER_FULL = "full";
const TIERS = [TIER_SMOKE, TIER_FULL];
const SMOKE_BUDGET_USD = "2";
const SMOKE_TOTAL_BUDGET_USD = "20";
const PASSING_VERDICTS = new Set(["pass", "flaky"]);
const VERDICT_FLAKY = "flaky";
const PROBE_ARGS = ["-p", "reply with the word ok", "--setting-sources", "", "--output-format", "json", "--max-budget-usd", "0.05"];
const PROBE_TIMEOUT_MS = 120000;
const PROBE_DETAIL_CHARS = 200;
const CREDENTIAL_HINT = "runs ignore the user settings source, so set a working ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN (claude setup-token)";
const VERDICTS_FILE = "verdicts.json";
const RUNNER = join("scripts", "eval", "run-scenarios.ts");

const USAGE = [
  "usage: changed-skills.ts [skill…] [--full] [--budget-usd N] [--total-budget-usd N] [--model M] [--jobs N]",
  '       changed-skills.ts --waive <skill> --reason "<text>"',
  "exit codes: 0 passed, waived or nothing to run, 1 evals failed, 2 usage error, 3 claude cannot run so no eval ran, 4 harness error (an internal check or file operation failed)",
].join("\n");
const WAIVER_KEY = "waived";
const STATUS_WAIVED = "waived";
const VALUE_FLAGS = ["--budget-usd", "--total-budget-usd", "--model", "--jobs"];

type Report = { verdicts: Record<string, string>; totalCostUsd?: number };
type Outcome = { skill: string; hash: string; passed: false; report?: undefined } | { skill: string; hash: string; passed: boolean; report: Report };
type Options = { skills: string[]; full: boolean; passthrough: string[]; waive: string | null; reason: string | null; error: string | null };

const isHashedSkillFile = (pathInsideSkill: string) => {
  assert(pathInsideSkill !== "", `isHashedSkillFile needs a path inside a skill, got ${JSON.stringify(pathInsideSkill)}`);
  assert(!isAbsolute(pathInsideSkill), `isHashedSkillFile needs a path relative to the skill folder, got ${pathInsideSkill}`);
  if (pathInsideSkill === EVALS_FILE) return false;
  return !(pathInsideSkill.startsWith(SCRIPTS_PREFIX) && TEST_FILE.test(pathInsideSkill));
};

const filesUnder = (dir: string) => {
  assert(dir !== "", `filesUnder needs a directory, got ${JSON.stringify(dir)}; an empty one would list the working directory`);
  const files = existsSync(dir) ? readdirSync(dir, { recursive: true, encoding: "utf8" }).filter((name) => statSync(join(dir, name)).isFile()) : [];
  const absoluteNames = files.filter((name) => isAbsolute(name));
  assert(absoluteNames.length === 0, `filesUnder(${dir}) returned absolute names (${absoluteNames.join(", ")}); expected names relative to that directory`);
  return files;
};

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
  assert(SKILL_NAME.test(skill), `skillHash needs a skill folder name, got ${JSON.stringify(skill)}`);
  const own = filesUnder(join(root, SKILLS_PREFIX, skill))
    .map((name) => name.split("\\").join("/"))
    .filter(isHashedSkillFile)
    .map((name) => `${SKILLS_PREFIX}/${skill}/${name}`);
  const files = [...new Set([...own, ...agentsNamedBy(root, skill)])].sort();
  assert(files.length > 0, `skill ${skill} has no files under ${join(root, SKILLS_PREFIX, skill)}; a hash of nothing would match any other empty skill`);
  const digest = createHash("sha256");
  for (const path of files) {
    digest.update(`${path}\0`);
    digest.update(readFileSync(join(root, path)));
    digest.update("\0");
  }
  const hash = digest.digest("hex");
  return hash;
};

const git = (root: string, args: string[]) => {
  assert(existsSync(root), `git needs an existing repository directory, got ${root}`);
  assert(args.length > 0, `git needs a subcommand, got no arguments in ${root}`);
  return execFileSync("git", args, { cwd: root, encoding: "utf8" });
};

const lines = (text: string) => text.split(LINE_BREAK).filter(Boolean); // zanity: ignore[assertion-density] -- text is git command output and the result is one split-and-filter whose only possible failures are the splitter's own guarantees

export const changedPaths = (root: string, baseRef: string) => {
  const mergeBase = git(root, ["merge-base", baseRef, "HEAD"]).trim();
  assert(mergeBase !== "", `no merge base between ${baseRef} and HEAD; expected a commit, since an empty one diffs from the wrong point`);
  const paths = new Set([
    ...lines(git(root, ["diff", "--name-only", `${mergeBase}..HEAD`])),
    ...lines(git(root, ["diff", "--name-only", "HEAD"])),
    ...lines(git(root, ["ls-files", "--others", "--exclude-standard"])),
  ]);
  const absolutePaths = [...paths].filter((path) => isAbsolute(path));
  assert(absolutePaths.length === 0, `changedPaths returned ${absolutePaths.length} absolute paths (${absolutePaths.join(", ")}); expected paths relative to the repository root`);
  return paths;
};

export const fileAtBase = (root: string, baseRef: string, path: string) => {
  assert(baseRef !== "", `fileAtBase needs a base ref, got ${JSON.stringify(baseRef)}; expected a branch or commit name`);
  assert(!isAbsolute(path), `fileAtBase needs a path relative to the repository root, got ${path}`);
  const mergeBase = git(root, ["merge-base", baseRef, "HEAD"]).trim();
  assert(mergeBase !== "", `no merge base between ${baseRef} and HEAD; expected a commit, since an empty one reads from the wrong point`);
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
    if (inSkill && isHashedSkillFile(inSkill[2])) touched.add(inSkill[1]);
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

export const stampStatus = (root: string, skill: string) => {
  assert(root !== "", `stampStatus needs the repository root, got ${JSON.stringify(root)}`);
  assert(SKILL_NAME.test(skill), `stampStatus needs a skill folder name, got ${JSON.stringify(skill)}`);
  if (!existsSync(stampPath(root, skill))) return "missing";
  const stamp = readStamp(root, skill);
  const waiver = stamp[WAIVER_KEY];
  if (Object.hasOwn(stamp, WAIVER_KEY) && (typeof waiver !== "string" || waiver.trim() === "")) return "blank-waiver";
  if (stamp.hash !== skillHash(root, skill)) return "stale";
  return Object.hasOwn(stamp, WAIVER_KEY) ? STATUS_WAIVED : "ok";
};

const parseArgs = (argv: string[]): Options => {
  assert(Array.isArray(argv), `parseArgs needs the argument list, got ${typeof argv}`);
  assert(argv.every((arg) => typeof arg === "string"), `parseArgs needs string arguments, got ${JSON.stringify(argv)}`);
  const options: Options = { skills: [], full: false, passthrough: [], waive: null, reason: null, error: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--full") options.full = true;
    else if (arg === "--waive" && argv[i + 1] !== undefined) options.waive = argv[++i];
    else if (arg === "--reason" && argv[i + 1] !== undefined) options.reason = argv[++i];
    else if (VALUE_FLAGS.includes(arg) && argv[i + 1] !== undefined) options.passthrough.push(arg, argv[++i]);
    else if (!arg.startsWith("--")) options.skills.push(arg);
    else return { ...options, error: `Unknown or incomplete argument: ${arg}` };
  }
  return options;
};

const EMPTY_PROBE_DETAIL = "claude reported an error and gave no detail";

const probeProblem = (passthrough: string[]) => {
  assert(Array.isArray(passthrough), `probeProblem needs the passthrough flag list, got ${typeof passthrough}`);
  const modelAt = passthrough.indexOf("--model");
  assert(modelAt === -1 || passthrough[modelAt + 1] !== undefined, `--model is the last of ${JSON.stringify(passthrough)}; expected a model name after it`);
  const scratch = mkdtempSync(join(tmpdir(), "gated-delivery-probe-"));
  let problem = null;
  try {
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

const runSkill = (root: string, skill: string, options: Options): Outcome => {
  assert(SKILL_NAME.test(skill), `runSkill needs a skill folder name, got ${JSON.stringify(skill)}`);
  assert(existsSync(join(root, SKILLS_PREFIX, skill, SKILL_FILE)), `runSkill: no ${SKILL_FILE} for skill ${skill} under ${root}`);
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

const writeStamp = (root: string, { skill, hash, report }: { skill: string; hash: string; report: Report }, tier: string) => {
  assert(TIERS.includes(tier), `writeStamp needs a tier from ${TIERS.join(", ")}, got ${JSON.stringify(tier)}`);
  assert(Object.keys(report.verdicts).length > 0, `writeStamp for ${skill} has no scenario verdicts; a stamp with none would vouch for nothing`);
  const path = stampPath(root, skill);
  mkdirSync(dirname(path), { recursive: true });
  const stamp = {
    hash,
    tier,
    scenarios: Object.keys(report.verdicts),
    verdicts: report.verdicts,
    totalCostUsd: report.totalCostUsd,
    ranAt: new Date().toISOString(),
  };
  writeFileSync(path, `${JSON.stringify(stamp, null, 2)}\n`);
};

const optionsProblem = (options: Options, root: string) => {
  assert(options.error === null, `optionsProblem got a parse error (${options.error}); report that instead of validating the options`);
  assert(root !== "", `optionsProblem needs the repository root, got ${JSON.stringify(root)}`);
  if (options.waive === null && options.reason !== null) return "--reason belongs to --waive";
  if (options.waive !== null) {
    if (options.skills.length || options.full || options.passthrough.length) return "--waive takes no other skills or flags";
    if (!options.reason?.trim()) return "--waive needs a non-blank --reason";
  }
  for (const skill of options.waive === null ? options.skills : [options.waive]) {
    if (!SKILL_NAME.test(skill)) return `not a skill name: ${skill}; pass the folder name under ${SKILLS_PREFIX}, not a path`;
    if (!existsSync(join(root, SKILLS_PREFIX, skill, SKILL_FILE))) return `no such skill: ${skill}`;
  }
  return null;
};

const writeWaiver = (root: string, skill: string, reason: string | null) => {
  assert(reason !== null && reason.trim() !== "", `writeWaiver for ${skill} needs a non-blank reason, got ${JSON.stringify(reason)}`);
  const path = stampPath(root, skill);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ hash: skillHash(root, skill), [WAIVER_KEY]: reason, ranAt: new Date().toISOString() }, null, 2)}\n`);
  const status = stampStatus(root, skill);
  assert(status === STATUS_WAIVED, `wrote a waiver for ${skill} but its stamp reads ${status}; expected ${STATUS_WAIVED}`);
};

const reportOutcome = (root: string, outcome: Outcome, tier: string) => {
  assert(TIERS.includes(tier), `reportOutcome needs a tier from ${TIERS.join(", ")}, got ${JSON.stringify(tier)}`);
  assert(!outcome.passed || outcome.report !== undefined, `outcome for ${outcome.skill} passed without a report; there is nothing to stamp`);
  for (const [id, verdict] of Object.entries(outcome.report?.verdicts ?? {})) {
    if (verdict === VERDICT_FLAKY) console.log(`FLAKY ${outcome.skill} ${id}: failed once, passed on rerun`);
  }
  if (outcome.report !== undefined && outcome.passed) writeStamp(root, outcome, tier);
  console.log(`${outcome.passed ? "PASSED" : "FAILED"} ${outcome.skill} (${tier})`);
};

const main = (argv: string[], root = process.cwd()) => {
  assert(Array.isArray(argv), `main needs the argument list, got ${typeof argv}`);
  assert(root !== "", `main needs the repository root, got ${JSON.stringify(root)}`);
  const options = parseArgs(argv);
  const problem = options.error ?? optionsProblem(options, root);
  if (problem) {
    console.error(`${problem}\n${USAGE}`);
    return EXIT_USAGE;
  }
  if (options.waive !== null) {
    writeWaiver(root, options.waive, options.reason);
    console.log(`WAIVED ${options.waive}: ${options.reason}`);
    return EXIT_PASSED;
  }
  const skills = options.skills.length ? options.skills : changedSkills(root, process.env[BASE_REF_ENV] || DEFAULT_BASE_REF);
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
  outcomes.forEach((outcome) => reportOutcome(root, outcome, tier));
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
