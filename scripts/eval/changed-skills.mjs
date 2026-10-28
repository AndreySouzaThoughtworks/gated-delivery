#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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
const BASE_REF_ENV = "GATED_DELIVERY_BASE_REF";
const CLAUDE_BIN = process.env.GATED_DELIVERY_CLAUDE_BIN || "claude";

const EXIT_PASSED = 0;
const EXIT_FAILED = 1;
const EXIT_USAGE = 2;
const EXIT_NOTHING_RUN = 3;

const TIER_SMOKE = "smoke";
const TIER_FULL = "full";
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
].join("\n");
const WAIVER_KEY = "waived";
const VALUE_FLAGS = ["--budget-usd", "--total-budget-usd", "--model", "--jobs"];

const isHashedSkillFile = (pathInsideSkill) => {
  if (pathInsideSkill === EVALS_FILE) return false;
  return !(pathInsideSkill.startsWith(SCRIPTS_PREFIX) && TEST_FILE.test(pathInsideSkill));
};

const filesUnder = (dir) =>
  existsSync(dir) ? readdirSync(dir, { recursive: true }).filter((name) => statSync(join(dir, name)).isFile()) : [];

const agentsNamedBy = (root, skill) => {
  const skillText = readFileSync(join(root, SKILLS_PREFIX, skill, SKILL_FILE), "utf8");
  return filesUnder(join(root, AGENTS_PREFIX))
    .filter((name) => name.endsWith(".md"))
    .filter((name) => new RegExp(`(?<![\\w-])${name.slice(0, -".md".length)}(?![\\w-])`).test(skillText))
    .map((name) => `${AGENTS_PREFIX}/${name}`);
};

const hashedFilesOf = (root, skill) => {
  const own = filesUnder(join(root, SKILLS_PREFIX, skill))
    .map((name) => name.split("\\").join("/"))
    .filter(isHashedSkillFile)
    .map((name) => `${SKILLS_PREFIX}/${skill}/${name}`);
  return [...own, ...agentsNamedBy(root, skill)].sort();
};

export const skillHash = (root, skill) => {
  const digest = createHash("sha256");
  for (const path of hashedFilesOf(root, skill)) {
    digest.update(`${path}\0`);
    digest.update(readFileSync(join(root, path)));
    digest.update("\0");
  }
  return digest.digest("hex");
};

const git = (root, args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
const lines = (text) => text.split(LINE_BREAK).filter(Boolean);

const changedPaths = (root, baseRef) => {
  const mergeBase = git(root, ["merge-base", baseRef, "HEAD"]).trim();
  return new Set([
    ...lines(git(root, ["diff", "--name-only", `${mergeBase}..HEAD`])),
    ...lines(git(root, ["diff", "--name-only", "HEAD"])),
    ...lines(git(root, ["ls-files", "--others", "--exclude-standard"])),
  ]);
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
  return skills.filter((skill) => touched.has(skill)).sort();
};

const stampPath = (root, skill) => join(root, RESULTS_DIR, `${skill}.json`);

const readStamp = (root, skill) => JSON.parse(readFileSync(stampPath(root, skill), "utf8"));

const isBlank = (value) => typeof value !== "string" || value.trim() === "";

export const waiverReason = (root, skill) => readStamp(root, skill).waived;

export const stampStatus = (root, skill) => {
  if (!existsSync(stampPath(root, skill))) return "missing";
  const stamp = readStamp(root, skill);
  if (Object.hasOwn(stamp, WAIVER_KEY) && isBlank(stamp[WAIVER_KEY])) return "blank-waiver";
  if (stamp.hash !== skillHash(root, skill)) return "stale";
  return Object.hasOwn(stamp, WAIVER_KEY) ? "waived" : "ok";
};

export const baseRefFromEnv = () => process.env[BASE_REF_ENV] || null;

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

const modelFlags = (passthrough) => {
  const at = passthrough.indexOf("--model");
  const model = at === -1 ? process.env.GATED_DELIVERY_RUN_MODEL : passthrough[at + 1];
  return model ? ["--model", model] : [];
};

const probeProblem = (passthrough) => {
  const scratch = mkdtempSync(join(tmpdir(), "gated-delivery-probe-"));
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
    if (reply?.is_error) return String(reply.result);
    if (probe.error) return probe.error.message;
    if (probe.status !== 0 || reply === null) return probe.stdout || probe.stderr || `exit ${probe.status}`;
    return null;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
};

const smokeDefaults = (passthrough) => {
  const defaults = [
    ["--budget-usd", SMOKE_BUDGET_USD],
    ["--total-budget-usd", SMOKE_TOTAL_BUDGET_USD],
  ];
  return defaults.filter(([flag]) => !passthrough.includes(flag)).flat();
};

const runSkill = (root, skill, options) => {
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
  if (options.waive === null) return options.reason === null ? null : "--reason belongs to --waive";
  if (options.skills.length || options.full || options.passthrough.length) return "--waive takes no other skills or flags";
  if (isBlank(options.reason)) return "--waive needs a non-blank --reason";
  if (!existsSync(join(root, SKILLS_PREFIX, options.waive, SKILL_FILE))) return `no such skill: ${options.waive}`;
  return null;
};

const writeWaiver = (root, skill, reason) => {
  const path = stampPath(root, skill);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ hash: skillHash(root, skill), [WAIVER_KEY]: reason, ranAt: new Date().toISOString() }, null, 2)}\n`);
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
  const problem = options.error ?? waiveProblem(options, root);
  if (problem) {
    console.error(`${problem}\n${USAGE}`);
    return EXIT_USAGE;
  }
  if (options.waive !== null) {
    writeWaiver(root, options.waive, options.reason);
    console.log(`WAIVED ${options.waive}: ${options.reason}`);
    return EXIT_PASSED;
  }
  const skills = options.skills.length ? options.skills : changedSkills(root, baseRefFromEnv() || DEFAULT_BASE_REF);
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
