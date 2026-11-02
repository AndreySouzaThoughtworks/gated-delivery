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
const SHA256_HEX = /^[0-9a-f]{64}$/;
const FLAG_AND_VALUE = 2;

const USAGE = [
  "usage: changed-skills.mjs [skill…] [--full] [--budget-usd N] [--total-budget-usd N] [--model M] [--jobs N]",
  '       changed-skills.mjs --waive <skill> --reason "<text>"',
].join("\n");
const WAIVER_KEY = "waived";
const VALUE_FLAGS = ["--budget-usd", "--total-budget-usd", "--model", "--jobs"];

const isHashedSkillFile = (pathInsideSkill) => {
  assert(pathInsideSkill !== "", `isHashedSkillFile got ${JSON.stringify(pathInsideSkill)}; expected a non-empty file path relative to the skill folder`);
  assert(!isAbsolute(pathInsideSkill), `isHashedSkillFile got absolute path ${pathInsideSkill}; expected a path relative to the skill folder`);
  if (pathInsideSkill === EVALS_FILE) return false;
  return !(pathInsideSkill.startsWith(SCRIPTS_PREFIX) && TEST_FILE.test(pathInsideSkill));
};

const filesUnder = (dir) => {
  assert(dir !== "", `filesUnder got ${JSON.stringify(dir)}; expected a path, since an empty one reads from the current directory`);
  const files = existsSync(dir) ? readdirSync(dir, { recursive: true }).filter((name) => statSync(join(dir, name)).isFile()) : [];
  assert(files.every((name) => !isAbsolute(name)), `filesUnder(${dir}) returned an absolute path; expected names relative to the directory`);
  return files;
};

const agentsNamedBy = (root, skill) => {
  assert(root !== "", `agentsNamedBy got ${JSON.stringify(root)}; expected the repository root path`);
  assert(!skill.includes("/"), `agentsNamedBy got skill ${JSON.stringify(skill)}; expected a bare skill folder name`);
  const skillText = readFileSync(join(root, SKILLS_PREFIX, skill, SKILL_FILE), "utf8");
  const agents = filesUnder(join(root, AGENTS_PREFIX))
    .filter((name) => name.endsWith(".md"))
    .filter((name) => new RegExp(`(?<![\\w-])${name.slice(0, -".md".length)}(?![\\w-])`).test(skillText))
    .map((name) => `${AGENTS_PREFIX}/${name}`);
  assert(agents.every((agent) => agent.startsWith(`${AGENTS_PREFIX}/`)), `agentsNamedBy(${skill}) returned a path outside ${AGENTS_PREFIX}; expected only agent files`);
  return agents;
};

const hashedFilesOf = (root, skill) => {
  assert(root !== "", `hashedFilesOf got ${JSON.stringify(root)}; expected the repository root path`);
  assert(!skill.includes("/"), `hashedFilesOf got skill ${JSON.stringify(skill)}; expected a bare skill folder name`);
  const own = filesUnder(join(root, SKILLS_PREFIX, skill))
    .map((name) => name.split("\\").join("/"))
    .filter(isHashedSkillFile)
    .map((name) => `${SKILLS_PREFIX}/${skill}/${name}`);
  const files = [...own, ...agentsNamedBy(root, skill)].sort();
  assert(new Set(files).size === files.length, `hashedFilesOf(${skill}) lists a file twice; expected each file hashed once`);
  assert(!files.includes(`${SKILLS_PREFIX}/${skill}/${EVALS_FILE}`), `hashedFilesOf(${skill}) includes ${EVALS_FILE}; expected it excluded so recording evals does not stale the stamp`);
  return files;
};

export const skillHash = (root, skill) => {
  assert(root !== "", `skillHash got ${JSON.stringify(root)}; expected the repository root path`);
  assert(!skill.includes("/"), `skillHash got skill ${JSON.stringify(skill)}; expected a bare skill folder name`);
  const digest = createHash("sha256");
  for (const path of hashedFilesOf(root, skill)) {
    digest.update(`${path}\0`);
    digest.update(readFileSync(join(root, path)));
    digest.update("\0");
  }
  const hash = digest.digest("hex");
  assert(SHA256_HEX.test(hash), `skillHash(${skill}) produced ${hash}; expected 64 lowercase hex characters`);
  return hash;
};

const git = (root, args) => {
  assert(root !== "", `git got ${JSON.stringify(root)}; expected the repository path to run in`);
  assert(args.length > 0, `git got ${JSON.stringify(args)}; expected at least one subcommand argument`);
  return execFileSync("git", args, { cwd: root, encoding: "utf8" });
};

const lines = (text) => {
  const found = text.split(LINE_BREAK).filter(Boolean);
  assert(found.every((line) => !line.includes("\n")), "lines returned an entry holding a line break; expected one entry per line");
  assert(found.every((line) => line !== ""), "lines returned an empty entry; expected blank lines dropped");
  return found;
};

const changedPaths = (root, baseRef) => {
  assert(root !== "", `changedPaths got ${JSON.stringify(root)}; expected the repository root path`);
  assert(baseRef !== "", `changedPaths got ${JSON.stringify(baseRef)}; expected a ref such as origin/main`);
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

export const changedSkills = (root, baseRef) => {
  assert(root !== "", `changedSkills got ${JSON.stringify(root)}; expected the repository root path`);
  assert(baseRef !== "", `changedSkills got ${JSON.stringify(baseRef)}; expected a ref such as origin/main`);
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
  assert(changed.every((skill, index) => index === 0 || changed[index - 1] < skill), `changedSkills returned ${JSON.stringify(changed)}; expected a sorted list without repeats`);
  assert(changed.every((skill) => existsSync(join(root, SKILLS_PREFIX, skill, SKILL_FILE))), `changedSkills returned a folder with no ${SKILL_FILE}; expected only real skills`);
  return changed;
};

const stampPath = (root, skill) => {
  assert(skill !== "", `stampPath got ${JSON.stringify(skill)}; expected a skill folder name`);
  assert(root !== "", `stampPath got ${JSON.stringify(root)}; expected the repository root path`);
  const path = join(root, RESULTS_DIR, `${skill}.json`);
  assert(dirname(path) === join(root, RESULTS_DIR), `stampPath(${JSON.stringify(skill)}) resolved to ${path}; expected a file directly inside ${RESULTS_DIR}`);
  return path;
};

const readStamp = (root, skill) => {
  assert(root !== "", `readStamp got ${JSON.stringify(root)}; expected the repository root path`);
  assert(!skill.includes("/"), `readStamp got skill ${JSON.stringify(skill)}; expected a bare skill folder name`);
  return JSON.parse(readFileSync(stampPath(root, skill), "utf8"));
};

export const waiverReason = (root, skill) => {
  assert(root !== "", `waiverReason got ${JSON.stringify(root)}; expected the repository root path`);
  assert(!skill.includes("/"), `waiverReason got skill ${JSON.stringify(skill)}; expected a bare skill folder name`);
  return readStamp(root, skill).waived;
};

export const stampStatus = (root, skill) => {
  assert(root !== "", `stampStatus got ${JSON.stringify(root)}; expected the repository root path`);
  assert(!skill.includes("/"), `stampStatus got skill ${JSON.stringify(skill)}; expected a bare skill folder name`);
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
  assert(options.skills.every((skill) => !skill.startsWith("--")), "parseArgs kept a flag as a skill name; expected only bare skill names in skills");
  assert(options.passthrough.length % FLAG_AND_VALUE === 0, `parseArgs left ${options.passthrough.length} passthrough entries; expected flag and value pairs`);
  return options;
};

const modelFlags = (passthrough) => {
  assert(passthrough.length % FLAG_AND_VALUE === 0, `modelFlags got ${passthrough.length} passthrough entries; expected flag and value pairs`);
  const at = passthrough.indexOf("--model");
  const model = at === -1 ? process.env.GATED_DELIVERY_RUN_MODEL : passthrough[at + 1];
  const flags = model ? ["--model", model] : [];
  assert(flags.every((flag) => flag !== ""), "modelFlags returned an empty flag value; expected --model followed by a model name, or nothing");
  return flags;
};

const EMPTY_PROBE_DETAIL = "claude reported an error and gave no detail";

const probeProblem = (passthrough) => {
  assert(passthrough.length % FLAG_AND_VALUE === 0, `probeProblem got ${passthrough.length} passthrough entries; expected flag and value pairs`);
  const scratch = mkdtempSync(join(tmpdir(), "gated-delivery-probe-"));
  let problem = null;
  try {
    const probe = spawnSync(CLAUDE_BIN, [...PROBE_ARGS, ...modelFlags(passthrough)], {
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
    if (reply?.is_error) problem = String(reply.result) || EMPTY_PROBE_DETAIL;
    else if (probe.error) problem = probe.error.message;
    else if (probe.status !== 0 || reply === null) problem = probe.stdout || probe.stderr || `exit ${probe.status}`;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  assert(problem === null || problem !== "", `probeProblem returned ${JSON.stringify(problem)}; expected null or the reason claude cannot run`);
  return problem;
};

const smokeDefaults = (passthrough) => {
  assert(passthrough.length % FLAG_AND_VALUE === 0, `smokeDefaults got ${passthrough.length} passthrough entries; expected flag and value pairs`);
  const defaults = [
    ["--budget-usd", SMOKE_BUDGET_USD],
    ["--total-budget-usd", SMOKE_TOTAL_BUDGET_USD],
  ];
  const flags = defaults.filter(([flag]) => !passthrough.includes(flag)).flat();
  assert(flags.length % FLAG_AND_VALUE === 0, `smokeDefaults returned ${flags.length} entries; expected flag and value pairs`);
  return flags;
};

const runSkill = (root, skill, options) => {
  assert(!skill.includes("/"), `runSkill got skill ${JSON.stringify(skill)}; expected a bare skill folder name`);
  assert(options.waive === null, `runSkill ran while waiving ${options.waive}; expected a waiver to write a stamp without running evals`);
  const out = mkdtempSync(join(tmpdir(), `gated-delivery-changed-${skill}-`));
  const tierFlags = options.full ? [] : ["--smoke", "--rerun-failures", ...smokeDefaults(options.passthrough)];
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
  assert(TIERS.includes(tier), `writeStamp got tier ${tier}; expected one of ${TIERS.join(", ")}`);
  assert(Object.keys(report.verdicts).length > 0, `writeStamp(${skill}) got a report with no verdicts; expected at least one scenario, since an empty stamp vouches for nothing`);
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

const waiveProblem = (options, root) => {
  assert(root !== "", `waiveProblem got ${JSON.stringify(root)}; expected the repository root path`);
  assert(options.error === undefined, `waiveProblem got a parse error (${options.error}); expected parseArgs errors reported before this check`);
  if (options.waive === null) return options.reason === null ? null : "--reason belongs to --waive";
  if (options.skills.length || options.full || options.passthrough.length) return "--waive takes no other skills or flags";
  if (!options.reason?.trim()) return "--waive needs a non-blank --reason";
  if (!existsSync(join(root, SKILLS_PREFIX, options.waive, SKILL_FILE))) return `no such skill: ${options.waive}`;
  return null;
};

const writeWaiver = (root, skill, reason) => {
  assert(Boolean(reason?.trim()), `writeWaiver(${skill}) got a blank reason; expected the reason a waiver is accepted for`);
  assert(!skill.includes("/"), `writeWaiver got skill ${JSON.stringify(skill)}; expected a bare skill folder name`);
  const path = stampPath(root, skill);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ hash: skillHash(root, skill), [WAIVER_KEY]: reason, ranAt: new Date().toISOString() }, null, 2)}\n`);
  const status = stampStatus(root, skill);
  assert(status === "waived", `writeWaiver(${skill}) left a stamp reading ${status}; expected waived`);
};

const reportOutcome = (root, outcome, tier) => {
  assert(TIERS.includes(tier), `reportOutcome got tier ${tier}; expected one of ${TIERS.join(", ")}`);
  assert(!outcome.passed || outcome.report !== undefined, `reportOutcome(${outcome.skill}) got a pass with no report; expected a report to stamp`);
  for (const [id, verdict] of Object.entries(outcome.report?.verdicts ?? {})) {
    if (verdict === VERDICT_FLAKY) console.log(`FLAKY ${outcome.skill} ${id}: failed once, passed on rerun`);
  }
  if (outcome.passed) writeStamp(root, outcome, tier);
  console.log(`${outcome.passed ? "PASSED" : "FAILED"} ${outcome.skill} (${tier})`);
};

const main = (argv, root = process.cwd()) => {
  assert(existsSync(root), `main got root ${JSON.stringify(root)}; expected an existing repository folder`);
  const options = parseArgs(argv);
  const problem = options.error ?? waiveProblem(options, root);
  if (problem) {
    console.error(`${problem}\n${USAGE}`);
    return EXIT_USAGE;
  }
  if (options.waive !== null) {
    assert(options.reason !== null, `main reached the waiver for ${options.waive} without a reason; expected waiveProblem to reject that`);
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
  process.exitCode = main(process.argv.slice(2));
}
