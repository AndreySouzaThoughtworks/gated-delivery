import assert from "node:assert";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { detect } from "./detect.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const pins = JSON.parse(readFileSync(join(HERE, "pins.json"), "utf8"));

export const GROUPS = ["config", "guards", "ci"];
const GUARD_FILES = ["ratchet.mjs", "rules-about-rules.mjs"];
const CLIENT_GUARDS_DIR = "guards";
const GUARD_MANIFEST_PATH = ".guardrails/guards.sha256";
const MANIFEST_LINE = /^[0-9a-f]{64} {2}guards\/\S+$/;
const WORKFLOWS_DIR = join(".github", "workflows");
const DEFAULT_WORKFLOW_NAME = "guardrails.yml";
const ZANITY_TOML = "zanity.toml";
const ZANITY_BASELINE = "zanity-baseline.json";
const ZANITY_STRICT_ARGS = "--fail-on warning --strict";
const ZANITY_PLAIN_ARGS = `check . ${ZANITY_STRICT_ARGS}`;
const ZANITY_BASELINE_ARGS = `check . --baseline ${ZANITY_BASELINE} --new-only ${ZANITY_STRICT_ARGS}`;
const PROTECTED_BRANCHES = ["main", "master"];
const FORBIDDEN_EXIT = 2;
const OVERWATCH_INSTALL_LINE = "/plugin install overwatch --marketplace benomahony/overwatch";
const FULL_SHA = /^[0-9a-f]{40}$/;
const USES_LINE = /^\s*-?\s*uses:\s*(\S+)/gm;
const UNFILLED_PLACEHOLDER = /\{\{[A-Z_]+\}\}/;
const LOCAL_ACTION_PREFIX = "./";

export class Refusal extends Error {}

export const resolveInside = (root, candidate) => {
  const rootReal = realpathSync(root);
  assert(rootReal.length > 0, `repo root must resolve to a path, got "${rootReal}"`);
  const target = resolve(rootReal, candidate);
  let existing = target;
  while (!existsSync(existing)) existing = dirname(existing);
  const existingReal = realpathSync(existing);
  const inside = existingReal === rootReal || existingReal.startsWith(rootReal + sep);
  if (!inside) throw new Refusal(`refusing to touch ${candidate}: it resolves outside the repo ${rootReal}. Use a path inside the repo.`);
  assert(relative(rootReal, target).split(sep)[0] !== "..", `${candidate} must stay under ${rootReal}, got ${target}`);
  return target;
};

export const unpinnedActions = (workflowText) => {
  assert(typeof workflowText === "string" && workflowText.length > 0, `workflow text must be non-empty, got ${workflowText?.length}`);
  const refs = [...workflowText.matchAll(USES_LINE)].map((match) => match[1]).filter((ref) => !ref.startsWith(LOCAL_ACTION_PREFIX));
  assert(refs.length > 0, `a workflow must use at least one action, got ${refs.length}`);
  return refs.filter((ref) => !FULL_SHA.test(ref.split("@")[1] ?? ""));
};

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

const runZanity = (root, args) => {
  assert(args.length > 0, `zanity needs arguments, got ${JSON.stringify(args)}`);
  const result = spawnSync(ZANITY_BINARY, args, { cwd: root, encoding: "utf8" });
  assert(result.status !== null || result.error, `zanity ${args.join(" ")} must exit or fail to start, got signal ${result.signal}`);
  return result;
};

const guardSources = (guardsDir) => {
  const missing = GUARD_FILES.filter((file) => !existsSync(join(guardsDir, file)));
  if (missing.length > 0) throw new Refusal(`guard scripts missing from ${guardsDir}: ${missing.join(", ")}. Restore plugin/bootstrap/guards/ or pass --guards-dir.`);
  const sources = GUARD_FILES.map((file) => ({ file, content: readFileSync(join(guardsDir, file), "utf8") }));
  assert(sources.length === GUARD_FILES.length, `one source per guard expected ${GUARD_FILES.length}, got ${sources.length}`);
  assert(sources.every(({ content }) => content.length > 0), `guard scripts must not be empty, got empty ${sources.filter(({ content }) => content.length === 0).map(({ file }) => file)}`);
  return sources;
};

const manifestContent = (sources) => {
  const lines = sources.map(({ file, content }) => `${createHash("sha256").update(content).digest("hex")}  ${CLIENT_GUARDS_DIR}/${file}`);
  assert(lines.length === sources.length, `one manifest line per guard expected ${sources.length}, got ${lines.length}`);
  assert(lines.every((line) => MANIFEST_LINE.test(line)), `every manifest line must read "<sha256>  guards/<file>", got ${JSON.stringify(lines.find((line) => !MANIFEST_LINE.test(line)))}`);
  return `${lines.join("\n")}\n`;
};

const additionDiff = (path, content) => {
  const lines = content.replace(/\n$/, "").split("\n");
  assert(lines.length > 0, `a new file must have at least one line, got ${lines.length} for ${path}`);
  assert(path.length > 0 && !path.startsWith("/"), `diff path must be repo-relative, got "${path}"`);
  return [`--- /dev/null`, `+++ b/${path}`, `@@ -0,0 +1,${lines.length} @@`, ...lines.map((line) => `+${line}`), ""].join("\n");
};

const workflowVariant = (root, facts) => {
  const baselinePresent = facts.guardrails.zanityBaseline;
  const knownClean = !baselinePresent && facts.guardrails.zanityToml && runZanity(root, ZANITY_VERSION_ARGS).status === 0 && runZanity(root, ZANITY_CLEAN_ARGS).status === 0;
  const variant = knownClean ? ZANITY_PLAIN_ARGS : ZANITY_BASELINE_ARGS;
  assert(!knownClean || !baselinePresent, `plain args are only for repos with no baseline, got baseline ${baselinePresent}`);
  assert(baselinePresent ? variant.includes("--new-only") : true, `a repo with a baseline must compare with --new-only, got ${variant}`);
  return variant;
};

export const buildPlan = (repo, options = {}) => {
  const root = realpathSync(resolve(repo));
  const facts = detect(root);
  if (facts.otherCi.length > 0 && facts.githubWorkflows.length === 0) {
    throw new Refusal(`found ${facts.otherCi.join(", ")} and no GitHub Actions. Bootstrap supports GitHub only; nothing was planned.`);
  }
  const workflowName = options.workflowName ?? DEFAULT_WORKFLOW_NAME;
  const guardsDir = options.guardsDir ?? join(HERE, "guards");
  const sources = guardSources(guardsDir);
  const wanted = [
    ...sources.map(({ file, content }) => ({ group: "guards", path: join(CLIENT_GUARDS_DIR, file), content })),
    { group: "guards", path: GUARD_MANIFEST_PATH, content: manifestContent(sources) },
    { group: "ci", path: join(WORKFLOWS_DIR, workflowName), content: renderWorkflow(workflowVariant(root, facts)) },
  ];
  const changes = [];
  const conflicts = [];
  for (const item of wanted) {
    const target = resolveInside(root, item.path);
    if (!existsSync(target)) changes.push(item);
    else if (readFileSync(target, "utf8") !== item.content) conflicts.push(item);
  }
  const commands = [];
  if (!facts.guardrails.zanityToml) commands.push({ group: "config", argv: ["init"] });
  if (!facts.guardrails.zanityBaseline) commands.push({ group: "config", argv: ["check", ".", "--baseline", ZANITY_BASELINE, "--capture-baseline", "--strict"], onlyIfFindings: true });
  assert(changes.every((change) => GROUPS.includes(change.group)), `every change needs a known group, got ${JSON.stringify(changes.map((c) => c.group))}`);
  assert(conflicts.every((conflict) => existsSync(join(root, conflict.path))), `a conflict means the file exists, got ${JSON.stringify(conflicts.map((c) => c.path))}`);
  return { root, facts, changes, conflicts, commands, diff: changes.map((change) => additionDiff(change.path, change.content)).join("") };
};

const assertSafeBranch = (root) => {
  const result = spawnSync("git", ["-C", root, "symbolic-ref", "--short", "HEAD"], { encoding: "utf8" });
  const branch = result.stdout.trim();
  if (result.status !== 0) throw new Refusal(`${root} is not a git repo on a branch. Run git init, or check out a branch, then retry.`);
  if (PROTECTED_BRANCHES.includes(branch)) throw new Refusal(`on ${branch}: apply works only on a branch. Run: git switch -c bootstrap/guardrails`);
  assert(branch.length > 0, `a branch name must not be empty, got "${branch}"`);
  assert(!PROTECTED_BRANCHES.includes(branch), `apply must run off ${PROTECTED_BRANCHES.join("/")}, got ${branch}`);
  return branch;
};

export const applyPlan = (repo, options) => {
  const groups = options.groups ?? [];
  const unknown = groups.filter((group) => !GROUPS.includes(group));
  if (groups.length === 0 || unknown.length > 0) throw new Refusal(`--apply needs --group for each confirmed group (${GROUPS.join(", ")}), got ${groups.join(",") || "none"}. Ask the user per group, then pass it.`);
  const root = realpathSync(resolve(repo));
  assertSafeBranch(root);
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
  assert(written.every((path) => existsSync(join(root, path))), `every written file must exist, got ${JSON.stringify(written)}`);
  assert(new Set(written).size === written.length, `a file must be written once, got ${JSON.stringify(written)}`);
  return written;
};

const VALUE_FLAGS = { "--repo": "repo", "--group": "groups", "--workflow-name": "workflowName", "--guards-dir": "guardsDir" };

const parseArgs = (argv) => {
  const options = { repo: ".", groups: [], apply: false };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--apply") options.apply = true;
    if (!(flag in VALUE_FLAGS)) continue;
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Refusal(`${flag} needs a value. Example: ${flag} <value>`);
    if (flag === "--group") options.groups.push(value);
    else options[VALUE_FLAGS[flag]] = value;
    index += 1;
  }
  assert(options.groups.every((group) => group.length > 0), `groups must be names, got ${JSON.stringify(options.groups)}`);
  assert(options.repo.length > 0, `repo must be a path, got "${options.repo}"`);
  return options;
};

const reportNotes = ({ facts, conflicts, commands }) => {
  const { githubWorkflows, unsupportedLanguages, testRunners } = facts;
  const notes = [];
  if (githubWorkflows.length > 0) notes.push(`existing CI left untouched: ${githubWorkflows.join(", ")}. Check the new workflow does not duplicate a job.`);
  for (const conflict of conflicts) notes.push(`CONFLICT ${conflict.path} exists with different content and is never overwritten. Review it by hand or pass --workflow-name.`);
  for (const command of commands) notes.push(`would run: zanity ${command.argv.join(" ")}${command.onlyIfFindings ? " (only if findings exist)" : ""}`);
  if (unsupportedLanguages.length > 0) notes.push(`languages outside the MVP, no native lint planned: ${unsupportedLanguages.join(", ")}`);
  notes.push(`overwatch (not installed by this command): ${OVERWATCH_INSTALL_LINE}`);  notes.push(`facts: ${JSON.stringify({ languages: facts.languages, packageManagers: facts.packageManagers, testRunners: testRunners.map((runner) => runner.name), linters: facts.linters })}`);
  assert(notes.some((note) => note.startsWith("facts:")), `a plan always reports facts, got ${notes.length} notes`);
  assert(notes.length >= conflicts.length + commands.length, `every conflict and command needs a note, got ${notes.length} for ${conflicts.length + commands.length}`);
  return notes;
};

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const plan = buildPlan(options.repo, options);
    process.stdout.write(plan.diff);
    for (const note of reportNotes(plan)) console.error(note);
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
