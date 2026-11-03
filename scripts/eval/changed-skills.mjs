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
const RUNNER = join("scripts", "eval", "run-scenarios.mjs");

const USAGE = [
  "usage: changed-skills.mjs [skill…] [--full] [--budget-usd N] [--total-budget-usd N] [--model M] [--jobs N]",
  '       changed-skills.mjs --waive <skill> --reason "<text>"',
  "exit codes: 0 passed, waived or nothing to run, 1 evals failed, 2 usage error, 3 claude cannot run so no eval ran, 4 harness error (an internal check or file operation failed)",
].join("\n");
const WAIVER_KEY = "waived";
const VALUE_FLAGS = ["--budget-usd", "--total-budget-usd", "--model", "--jobs"];

const isHashedSkillFile = (pathInsideSkill) => {
  if (pathInsideSkill === EVALS_FILE) return false;
  return !(pathInsideSkill.startsWith(SCRIPTS_PREFIX) && TEST_FILE.test(pathInsideSkill));
};

const filesUnder = (dir) => {
  const files = existsSync(dir) ? readdirSync(dir, { recursive: true }).filter((name) => statSync(join(dir, name)).isFile()) : [];
  return files;
};

const agentsNamedBy = (root, skill) => {
  const skillText = readFileSync(join(root, SKILLS_PREFIX, skill, SKILL_FILE), "utf8");
  const agents = filesUnder(join(root, AGENTS_PREFIX))
    .filter((name) => name.endsWith(".md"))
    .filter((name) => new RegExp(`(?<![\\w-])${name.slice(0, -".md".length)}(?![\\w-])`).test(skillText))
    .map((name) => `${AGENTS_PREFIX}/${name}`);
  return agents;
};

export const skillHash = (root, skill) => {
  const own = filesUnder(join(root, SKILLS_PREFIX, skill))
    .map((name) => name.split("\\").join("/"))
    .filter(isHashedSkillFile)
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

const git = (root, args) => {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" });
};

const lines = (text) => text.split(LINE_BREAK).filter(Boolean); // zanity: ignore[assertion-density] -- text is git command output and the result is one split-and-filter whose only possible failures are the splitter's own guarantees

export const changedPaths = (root, baseRef) => {
  const mergeBase = git(root, ["merge-base", baseRef, "HEAD"]).trim();
  assert(mergeBase !== "", `no merge base between ${baseRef} and HEAD; expected a commit, since an empty one diffs from the wrong point`);
  const paths = new Set([
    ...lines(git(root, ["diff", "--name-only", `${mergeBase}..HEAD`])),
    ...lines(git(root, ["diff", "--name-only", "HEAD"])),
    ...lines(git(root, ["ls-files", "--others", "--exclude-standard"])),
  ]);
  assert([...paths].every((path) => !isAbsolute(path)), "changedPaths returned an absolute path; expected paths relative to the repository root");
  return paths;
};

export const fileAtBase = (root, baseRef, path) => {
  assert(baseRef !== "", `fileAtBase needs a base ref, got ${JSON.stringify(baseRef)}; expected a branch or commit name`);
  assert(!isAbsolute(path), `fileAtBase needs a path relative to the repository root, got ${path}`);
  const mergeBase = git(root, ["merge-base", baseRef, "HEAD"]).trim();
  assert(mergeBase !== "", `no merge base between ${baseRef} and HEAD; expected a commit, since an empty one reads from the wrong point`);
  const shown = spawnSync("git", ["show", `${mergeBase}:${path}`], { cwd: root, encoding: "utf8" });
  return shown.status === 0 ? shown.stdout : null;
};

export const changedSkills = (root, baseRef) => {
  const skills = filesUnder(join(root, SKILLS_PREFIX))
    .map((name) => name.split(/[\\/]/)[0])
    .filter((name, index, all) => all.indexOf(name) === index)
    .filter((name) => existsSync(join(root, SKILLS_PREFIX, name, SKILL_FILE)));
  const touched = new Set();
  for (const path of changedPaths(root, baseRef)) {
    const inSkill = path.match(SKILL_PATH);
    if (inSkill && isHashedSkillFile(inSkill[2])) touched.add(inSkill[1]);
    const agent = path.match(AGENT_PATH);
    if (agent) for (const skill of skills) if (agentsNamedBy(root, skill).includes(path)) touched.add(skill);
  }
  const changed = skills.filter((skill) => touched.has(skill)).sort();
  return changed;
};

const stampPath = (root, skill) => {
  const path = join(root, RESULTS_DIR, `${skill}.json`);
  return path;
};

const readStamp = (root, skill) => {
  return JSON.parse(readFileSync(stampPath(root, skill), "utf8"));
};

export const waiverReason = (root, skill) => {
  return readStamp(root, skill).waived;
};

export const stampStatus = (root, skill) => {
  if (!existsSync(stampPath(root, skill))) return "missing";
  const stamp = readStamp(root, skill);
  const waiver = stamp[WAIVER_KEY];
  if (Object.hasOwn(stamp, WAIVER_KEY) && (typeof waiver !== "string" || waiver.trim() === "")) return "blank-waiver";
  if (stamp.hash !== skillHash(root, skill)) return "stale";
  return Object.hasOwn(stamp, WAIVER_KEY) ? "waived" : "ok";
};

const parseArgs = (argv) => {
  const options = { skills: [], full: false, passthrough: [], waive: null, reason: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--full") options.full = true;
    else if (arg === "--waive" && argv[i + 1] !== undefined) options.waive = argv[++i];
    else if (arg === "--reason" && argv[i + 1] !== undefined) options.reason = argv[++i];
    else if (VALUE_FLAGS.includes(arg) && argv[i + 1] !== undefined) options.passthrough.push(arg, argv[++i]);
    else if (!arg.startsWith("--")) options.skills.push(arg);
    else return { error: `Unknown or incomplete argument: ${arg}` };
  }
  return options;
};

const EMPTY_PROBE_DETAIL = "claude reported an error and gave no detail";

const probeProblem = (passthrough) => {
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
  return problem;
};

const runSkill = (root, skill, options) => {
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
  const report = JSON.parse(readFileSync(verdictsPath, "utf8"));
  const verdicts = Object.values(report.verdicts);
  return {
    skill,
    hash,
    report,
    passed: status === 0 && verdicts.length > 0 && verdicts.every((verdict) => PASSING_VERDICTS.has(verdict)),
  };
};

const writeStamp = (root, { skill, hash, report }, tier) => {
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

const optionsProblem = (options, root) => {
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

const writeWaiver = (root, skill, reason) => {
  const path = stampPath(root, skill);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ hash: skillHash(root, skill), [WAIVER_KEY]: reason, ranAt: new Date().toISOString() }, null, 2)}\n`);
  const status = stampStatus(root, skill);
};

const reportOutcome = (root, outcome, tier) => {
  for (const [id, verdict] of Object.entries(outcome.report?.verdicts ?? {})) {
    if (verdict === VERDICT_FLAKY) console.log(`FLAKY ${outcome.skill} ${id}: failed once, passed on rerun`);
  }
  if (outcome.passed) writeStamp(root, outcome, tier);
  console.log(`${outcome.passed ? "PASSED" : "FAILED"} ${outcome.skill} (${tier})`);
};

const main = (argv, root = process.cwd()) => {
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
