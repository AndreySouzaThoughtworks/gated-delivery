import assert from "node:assert";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { detect } from "./detect.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const pins = JSON.parse(readFileSync(join(HERE, "pins.json"), "utf8"));

/**
 * @typedef {ReturnType<typeof detect>} Facts
 * @typedef {{ group: string, path: string, content: string }} PlannedFile
 * @typedef {{ group: string, argv: string[], onlyIfFindings?: boolean }} PlannedCommand
 * @typedef {{ root: string, facts: Facts, changes: PlannedFile[], conflicts: PlannedFile[], commands: PlannedCommand[], diff: string }} Plan
 * @typedef {{ file: string, content: string }} GuardSource
 * @typedef {{ groups?: string[], workflowName?: string, guardsDir?: string }} PlanOptions
 * @typedef {PlanOptions & { repo: string, groups: string[], apply: boolean }} CliOptions
 */

export const GROUPS = ["config", "guards", "ci"];
const GUARD_FILES = ["ratchet.mjs", "rules-about-rules.mjs"];
const CLIENT_GUARDS_DIR = "guards";
const GUARD_MANIFEST_PATH = ".guardrails/guards.sha256";
const WORKFLOWS_DIR = join(".github", "workflows");
const DEFAULT_WORKFLOW_NAME = "guardrails.yml";
const ZANITY_TOML = "zanity.toml";
const ZANITY_BASELINE = "zanity-baseline.json";
const ZANITY_STRICT_ARGS = "--fail-on warning --strict";
const ZANITY_PLAIN_ARGS = `check . ${ZANITY_STRICT_ARGS}`;
const ZANITY_BASELINE_ARGS = `check . --baseline ${ZANITY_BASELINE} --new-only --agent ${ZANITY_STRICT_ARGS}`;
const PROTECTED_BRANCHES = ["main", "master"];
const FORBIDDEN_EXIT = 2;
const OVERWATCH_INSTALL_LINE = "/plugin install overwatch --marketplace benomahony/overwatch";
const FULL_SHA = /^[0-9a-f]{40}$/;
const USES_LINE = /^\s*-?\s*uses:\s*(\S+)/gm;
const UNFILLED_PLACEHOLDER = /\{\{[A-Z_]+\}\}/;
const LOCAL_ACTION_PREFIX = "./";
const FACTS_NOTE_PREFIX = "facts: ";

export class Refusal extends Error {}

/**
 * @param {string} root
 * @param {string} candidate
 */
export const resolveInside = (root, candidate) => {
  assert(typeof root === "string" && root.length > 0, `root must be a non-empty path, got ${JSON.stringify(root)}`);
  assert(typeof candidate === "string" && candidate.length > 0, `candidate must be a non-empty path, got ${JSON.stringify(candidate)}`);
  const rootReal = realpathSync(root);
  const target = resolve(rootReal, candidate);
  let existing = target;
  while (!existsSync(existing)) existing = dirname(existing);
  const existingReal = realpathSync(existing);
  const inside = existingReal === rootReal || existingReal.startsWith(rootReal + sep);
  if (!inside) throw new Refusal(`refusing to touch ${candidate}: it resolves outside the repo ${rootReal}. Use a path inside the repo.`);
  return target;
};

/**
 * @param {string} workflowText
 */
export const unpinnedActions = (workflowText) => {
  assert(typeof workflowText === "string" && workflowText.length > 0, `workflow text must be non-empty, got ${workflowText?.length}`);
  const refs = [...workflowText.matchAll(USES_LINE)].map((match) => match[1]).filter((ref) => !ref.startsWith(LOCAL_ACTION_PREFIX));
  assert(refs.length > 0, `a workflow must use at least one action, got ${refs.length}`);
  return refs.filter((ref) => !FULL_SHA.test(ref.split("@")[1] ?? ""));
};

/**
 * @param {string} zanityArgs
 */
const renderWorkflow = (zanityArgs) => {
  const template = readFileSync(join(HERE, "templates", "guardrails.yml"), "utf8");
  const text = template.replace("{{ZANITY_VERSION}}", pins.zanityVersion).replace("{{ZANITY_ARGS}}", zanityArgs);
  const unpinned = unpinnedActions(text);
  assert(unpinned.length === 0, `every action must be pinned to a full SHA, got ${JSON.stringify(unpinned)}; fix the template`);
  assert(!UNFILLED_PLACEHOLDER.test(text), `every placeholder must be filled, got ${text.match(UNFILLED_PLACEHOLDER)?.[0]}`);
  return text;
};

const INSTALLED_ZANITY = join(homedir(), ".local", "bin", "zanity");
const ZANITY_BINARY = process.env.ZANITY_BIN ?? (existsSync(INSTALLED_ZANITY) ? INSTALLED_ZANITY : "zanity");
const ZANITY_VERSION_ARGS = ["--version"];
const ZANITY_CLEAN_ARGS = ["check", ".", ...ZANITY_STRICT_ARGS.split(" ")];

/**
 * @param {string} root
 * @param {string[]} args
 */
const runZanity = (root, args) => { // zanity: ignore[assertion-density] -- io-wrapper: one spawnSync whose only real postcondition is exit or spawn failure and a second assertion would only restate it
  const result = spawnSync(ZANITY_BINARY, args, { cwd: root, encoding: "utf8" });
  assert(result.status !== null || result.error, `zanity ${args.join(" ")} must exit or fail to start, got signal ${result.signal}`);
  return result;
};

/**
 * @param {string} guardsDir
 * @returns {GuardSource[]}
 */
const guardSources = (guardsDir) => {
  assert(typeof guardsDir === "string" && guardsDir.length > 0, `guardsDir must be a non-empty path, got ${JSON.stringify(guardsDir)}`);
  const missing = GUARD_FILES.filter((file) => !existsSync(join(guardsDir, file)));
  if (missing.length > 0) throw new Refusal(`guard scripts missing from ${guardsDir}: ${missing.join(", ")}. Restore plugin/bootstrap/guards/ or pass --guards-dir.`);
  const sources = GUARD_FILES.map((file) => ({ file, content: readFileSync(join(guardsDir, file), "utf8") }));
  assert(sources.every(({ content }) => content.length > 0), `guard scripts must not be empty, got empty ${sources.filter(({ content }) => content.length === 0).map(({ file }) => file)}`);
  return sources;
};

/**
 * @param {string} repo
 * @param {PlanOptions} [options]
 * @returns {Plan}
 */
export const buildPlan = (repo, options = {}) => {
  assert(typeof repo === "string" && repo.length > 0, `repo must be a non-empty path, got ${JSON.stringify(repo)}`);
  assert(typeof options === "object" && options !== null, `options must be an object, got ${JSON.stringify(options)}`);
  const root = realpathSync(resolve(repo));
  const facts = detect(root);
  if (facts.otherCi.length > 0 && facts.githubWorkflows.length === 0) {
    throw new Refusal(`found ${facts.otherCi.join(", ")} and no GitHub Actions. Bootstrap supports GitHub only; nothing was planned.`);
  }
  const workflowName = options.workflowName ?? DEFAULT_WORKFLOW_NAME;
  const guardsDir = options.guardsDir ?? join(HERE, "guards");
  const sources = guardSources(guardsDir);
  const manifestLines = sources.map(({ file, content }) => `${createHash("sha256").update(content).digest("hex")}  ${CLIENT_GUARDS_DIR}/${file}`);
  const knownClean = !facts.guardrails.zanityBaseline && facts.guardrails.zanityToml && [ZANITY_VERSION_ARGS, ZANITY_CLEAN_ARGS].every((args) => runZanity(root, args).status === 0);
  const zanityArgs = knownClean ? ZANITY_PLAIN_ARGS : ZANITY_BASELINE_ARGS;
  const wanted = [
    ...sources.map(({ file, content }) => ({ group: "guards", path: join(CLIENT_GUARDS_DIR, file), content })),
    { group: "guards", path: GUARD_MANIFEST_PATH, content: `${manifestLines.join("\n")}\n` },
    { group: "ci", path: join(WORKFLOWS_DIR, workflowName), content: renderWorkflow(zanityArgs) },
  ];
  /** @type {PlannedFile[]} */
  const changes = [];
  /** @type {PlannedFile[]} */
  const conflicts = [];
  for (const item of wanted) {
    const target = resolveInside(root, item.path);
    if (!existsSync(target)) changes.push(item);
    else if (readFileSync(target, "utf8") !== item.content) conflicts.push(item);
  }
  /** @type {PlannedCommand[]} */
  const commands = [];
  if (!facts.guardrails.zanityToml) commands.push({ group: "config", argv: ["init"] });
  if (!facts.guardrails.zanityBaseline) commands.push({ group: "config", argv: ["check", ".", "--baseline", ZANITY_BASELINE, "--capture-baseline", "--strict"], onlyIfFindings: true });
  assert(new Set(wanted.map(({ path }) => path)).size === wanted.length, `planned files must be distinct, got ${JSON.stringify(wanted.map(({ path }) => path))}; pass another --workflow-name`);
  const diff = changes
    .map(({ path, content }) => {
      const lines = content.replace(/\n$/, "").split("\n");
      return [`--- /dev/null`, `+++ b/${path}`, `@@ -0,0 +1,${lines.length} @@`, ...lines.map((line) => `+${line}`), ""].join("\n");
    })
    .join("");
  return { root, facts, changes, conflicts, commands, diff };
};

/**
 * @param {string} repo
 * @param {PlanOptions} options
 */
export const applyPlan = (repo, options) => {
  assert(typeof repo === "string" && repo.length > 0, `repo must be a non-empty path, got ${JSON.stringify(repo)}`);
  assert(typeof options === "object" && options !== null, `options must be an object, got ${JSON.stringify(options)}`);
  const groups = options.groups ?? [];
  const unknown = groups.filter((group) => !GROUPS.includes(group));
  if (groups.length === 0 || unknown.length > 0) throw new Refusal(`--apply needs --group for each confirmed group (${GROUPS.join(", ")}), got ${groups.join(",") || "none"}. Ask the user per group, then pass it.`);
  const root = realpathSync(resolve(repo));
  const head = spawnSync("git", ["-C", root, "symbolic-ref", "--short", "HEAD"], { encoding: "utf8" });
  if (head.status !== 0) throw new Refusal(`${root} is not a git repo on a branch. Run git init, or check out a branch, then retry.`);
  const branch = head.stdout.trim();
  if (PROTECTED_BRANCHES.includes(branch)) throw new Refusal(`on ${branch}: apply works only on a branch. Run: git switch -c bootstrap/guardrails`);
  const written = [];
  if (groups.includes("config")) {
    if (runZanity(root, ZANITY_VERSION_ARGS).status !== 0) throw new Refusal(`zanity is not installed. Run: node ${join(HERE, "install-zanity.mjs")} --run`);
    for (const command of buildPlan(root, options).commands.filter((c) => c.group === "config")) {
      if (command.onlyIfFindings && runZanity(root, ZANITY_CLEAN_ARGS).status === 0) continue;
      execFileSync(ZANITY_BINARY, command.argv, { cwd: root, stdio: "inherit" });
    }
  }
  for (const change of buildPlan(root, options).changes.filter((c) => groups.includes(c.group))) {
    const target = resolveInside(root, change.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, change.content, { flag: "wx" });
    written.push(change.path);
  }
  return written;
};

const GROUP_FLAG = "--group";
/** @type {Record<string, "repo" | "workflowName" | "guardsDir">} */
const VALUE_FLAGS = { "--repo": "repo", "--workflow-name": "workflowName", "--guards-dir": "guardsDir" };

/**
 * @param {string[]} argv
 * @returns {CliOptions}
 */
const parseArgs = (argv) => {
  /** @type {CliOptions} */
  const options = { repo: ".", groups: [], apply: false };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--apply") options.apply = true;
    if (flag !== GROUP_FLAG && !(flag in VALUE_FLAGS)) continue;
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Refusal(`${flag} needs a value. Example: ${flag} <value>`);
    if (flag === GROUP_FLAG) options.groups.push(value);
    else options[VALUE_FLAGS[flag]] = value;
    index += 1;
  }
  assert(options.groups.every((group) => group.length > 0), `groups must be names, got ${JSON.stringify(options.groups)}`);
  assert(options.repo.length > 0, `repo must be a path, got "${options.repo}"`);
  return options;
};

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const plan = buildPlan(options.repo, options);
    process.stdout.write(plan.diff);
    const { facts, conflicts, commands } = plan;
    const notes = [];
    if (facts.githubWorkflows.length > 0) notes.push(`existing CI left untouched: ${facts.githubWorkflows.join(", ")}. Check the new workflow does not duplicate a job.`);
    for (const conflict of conflicts) notes.push(`CONFLICT ${conflict.path} exists with different content and is never overwritten. Review it by hand or pass --workflow-name.`);
    for (const command of commands) notes.push(`would run: zanity ${command.argv.join(" ")}${command.onlyIfFindings ? " (only if findings exist)" : ""}`);
    if (facts.unsupportedLanguages.length > 0) notes.push(`languages outside the MVP, no native lint planned: ${facts.unsupportedLanguages.join(", ")}`);
    notes.push(`overwatch (not installed by this command): ${OVERWATCH_INSTALL_LINE}`);
    notes.push(`${FACTS_NOTE_PREFIX}${JSON.stringify({ languages: facts.languages, packageManagers: facts.packageManagers, testRunners: facts.testRunners.map((runner) => runner.name), linters: facts.linters })}`);
    for (const note of notes) console.error(note);
    if (options.apply) {
      const written = applyPlan(options.repo, options);
      console.error(written.length === 0 ? "nothing written" : `wrote: ${written.join(", ")}`);
    }
  } catch (error) {
    if (!(error instanceof Refusal)) throw error;
    console.error(`${basename(process.argv[1])}: ${error.message}`);
    process.exit(FORBIDDEN_EXIT);
  }
}
