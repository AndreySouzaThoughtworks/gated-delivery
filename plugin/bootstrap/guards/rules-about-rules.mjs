#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const EXIT_OK = 0;
const EXIT_VIOLATION = 1;
const EXIT_USAGE = 2;
const USAGE = "usage: node rules-about-rules.mjs --repo <dir>";
const REPO_OPTION = "--repo";
const ALLOWLIST_PATH = ".guardrails/allowed.json";
const ZANITY_CONFIG = "zanity.toml";
const OVERWATCH_CONFIG = ".overwatch.json";
const WORKFLOWS_DIR = ".github/workflows";
const WORKFLOW_FILE = /\.ya?ml$/;
const TOP_LEVEL = "";
const PARENT_SEGMENT = "..";
const DOT_SEGMENTS = [".", PARENT_SEGMENT];
const BYTE_ORDER_MARK = "\uFEFF";
const QUOTED_ITEM = /"([^"]*)"/g;
const LIST_FILLER = /[\s,]/g;
const TOML_TABLE_HEADER = /^\[([^\]]+)\]\s*$/m;
const TOML_COMMENT = /#.*$/gm;
const SELECT_ALL = /^select\s*=\s*\["all"\]/m;
const DISABLE_LIST = /^\s*disable\s*=\s*\[([^\]]*)\]/gm;
const EXCLUDE_LIST = /^exclude\s*=\s*\[([^\]]*)\]/m;
const PATHS_KEY = /^\s*paths\b/m;
const USES_LINE = /^\s*(?:-\s*)?uses:\s*["']?([^\s"'#]+)/;
const PINNED_ACTION = /^[^@\s]+@[0-9a-f]{40}$/;
const PINNED_DOCKER_IMAGE = /^docker:\/\/\S+@sha256:[0-9a-f]{64}$/;
const LOCAL_ACTION_PREFIX = "./";
const JOBS_HEADER = /^jobs:\s*$/;
const TOP_LEVEL_KEY = /^\S/;
const JOB_ID = /^ {2}([\w-]+):\s*$/;
const JOB_NAME = /^ {4}name:\s*["']?([^"'#]*?)["']?\s*(?:#.*)?$/;
const MANIFEST_PATH = ".guardrails/guards.sha256";
const GUARDS_DIR = "guards";
const MANIFEST_LINE = /^([0-9a-f]{64}) {2}(guards\/[^\s/]+)$/;
const SCRIPT_FILE = /\.mjs$/;

class UsageError extends Error {}

/**
 * @typedef {{ disables: Record<string, string[]>, excludes: string[], requiredJobs: string[] }} Allowlist
 * @typedef {{ hash: string, path: string }} ManifestEntry
 */

/**
 * @param {string[]} argv
 * @returns {string}
 */
const parseArgs = (argv) => {
  assert(argv.length === 2 && argv[0] === REPO_OPTION && !argv[1].startsWith("--"), USAGE);
  assert(argv[1].length > 0, `${REPO_OPTION} must name a directory, got "${argv[1]}"; pass the repository root`);
  return argv[1];
};

/**
 * @param {string} repo
 * @param {string} relativePath
 * @param {string} what
 */
const readText = (repo, relativePath, what) => { // zanity: ignore[assertion-density] -- io-wrapper: reads one file and maps any read failure to a usage error, so it has no precondition of its own to assert
  const resolved = resolve(repo, relativePath);
  try {
    return readFileSync(resolved, "utf8");
  } catch (error) {
    throw new UsageError(`cannot read ${what} at ${resolved} (${error instanceof Error && "code" in error ? error.code : String(error)})`);
  }
};

/**
 * @param {unknown} value
 * @param {string} label
 * @returns {string[]}
 */
const stringList = (value, label) => {
  assert(Array.isArray(value) && value.every((item) => typeof item === "string" && item.length > 0), `${ALLOWLIST_PATH}: ${label} must be a list of non-empty strings`);
  assert(value.every((item) => item === item.trim()), `${ALLOWLIST_PATH}: ${label} must not hold items with stray whitespace, got ${JSON.stringify(value)}`);
  assert(new Set(value).size === value.length, `${ALLOWLIST_PATH}: ${label} must not repeat an item, got ${JSON.stringify(value)}`);
  return value;
};

/**
 * @param {string} repo
 * @returns {Allowlist}
 */
const loadAllowlist = (repo) => {
  const path = join(repo, ALLOWLIST_PATH);
  if (!existsSync(path)) return { disables: {}, excludes: [], requiredJobs: [] };
  let document;
  try {
    document = JSON.parse(readText(repo, ALLOWLIST_PATH, "the allowlist"));
  } catch (error) {
    if (error instanceof UsageError) throw error;
    throw new UsageError(`${ALLOWLIST_PATH} is not valid JSON (${error instanceof Error ? error.message : String(error)})`);
  }
  assert(typeof document === "object" && document !== null && !Array.isArray(document), `${ALLOWLIST_PATH} must hold a JSON object, got ${Array.isArray(document) ? "an array" : JSON.stringify(document)}`);
  const disables = document.zanityDisables ?? {};
  assert(typeof disables === "object" && !Array.isArray(disables), `${ALLOWLIST_PATH}: zanityDisables must map a table name to a list of rules`);
  const allowlist = {
    disables: Object.fromEntries(Object.entries(disables).map(([table, rules]) => [table, stringList(rules, `zanityDisables["${table}"]`)])),
    excludes: stringList(document?.zanityExcludes ?? [], "zanityExcludes"),
    requiredJobs: stringList(document?.requiredCiJobs ?? [], "requiredCiJobs"),
  };
  return allowlist;
};

/**
 * @param {string} list
 */
const quotedItems = (list) => {
  const items = Array.from(list.matchAll(QUOTED_ITEM), (match) => match[1]);
  const unquoted = list.replaceAll(QUOTED_ITEM, "").replaceAll(LIST_FILLER, "");
  assert(unquoted.length === 0, `${ZANITY_CONFIG} lists must hold only double-quoted strings, got ${list.trim()}; quote each item with double quotes`);
  assert(!items.includes(""), `${ZANITY_CONFIG} lists must not hold blank items, got ${JSON.stringify(items)}; remove the empty string`);
  return items;
};

/**
 * @param {string} text
 * @param {Allowlist} allowlist
 */
const zanityProblems = (text, allowlist) => { // zanity: ignore[assertion-density] -- single-invariant: the byte order mark is its only input precondition, and every other rule breach is a finding returned to the caller
  assert(!text.startsWith(BYTE_ORDER_MARK), `${ZANITY_CONFIG} must not start with a byte order mark, which hides its first line from the guard; re-save it without one`);
  const config = text.replace(TOML_COMMENT, "");
  const found = [];
  if (!SELECT_ALL.test(config)) found.push(`${ZANITY_CONFIG} must keep select = ["all"] under [rules]. Hint: restore it and fix the findings in code.`);
  const [topLevel, ...headersAndBodies] = config.split(TOML_TABLE_HEADER);
  const tables = [{ header: TOP_LEVEL, body: topLevel }];
  for (let i = 0; i < headersAndBodies.length; i += 2) tables.push({ header: headersAndBodies[i].trim(), body: headersAndBodies[i + 1] });
  for (const { header, body } of tables) {
    const scopesPaths = header === "paths" || header.startsWith("paths.");
    const allowed = allowlist.disables[header];
    const disabled = [...body.matchAll(DISABLE_LIST)].flatMap(([, list]) => quotedItems(list));
    const notAllowed = disabled.filter((rule) => !(allowed ?? []).includes(rule));
    if (scopesPaths && allowed === undefined) {
      found.push(`${ZANITY_CONFIG} scopes rules off in [${header}], which ${ALLOWLIST_PATH} does not allow. Hint: fix the findings in code, or have the code owners add the table to zanityDisables.`);
    } else if (!scopesPaths && PATHS_KEY.test(body)) {
      found.push(`${ZANITY_CONFIG} sets a paths key outside a [paths...] table. Hint: write path scoping as its own allowlisted [paths."<glob>"] table.`);
    } else if (notAllowed.length > 0) {
      const label = header === TOP_LEVEL ? "top level" : `[${header}]`;
      found.push(`${ZANITY_CONFIG} disables ${notAllowed.join(", ")} under ${label}, which ${ALLOWLIST_PATH} does not allow. Hint: fix the findings in code instead.`);
    }
  }
  const excluded = quotedItems(config.match(EXCLUDE_LIST)?.[1] ?? "");
  for (const path of excluded.filter((item) => !allowlist.excludes.includes(item))) {
    found.push(`${ZANITY_CONFIG} excludes ${path}, which hides it from every check and is not in ${ALLOWLIST_PATH}. Hint: fix the findings in code instead.`);
  }
  return found;
};

/**
 * @param {string} workflowText
 */
const jobNames = (workflowText) => {
  const ids = [];
  const displayNames = [];
  let insideJobs = false;
  for (const line of workflowText.split("\n")) {
    if (JOBS_HEADER.test(line)) insideJobs = true;
    else if (TOP_LEVEL_KEY.test(line)) insideJobs = false;
    if (!insideJobs) continue;
    const id = line.match(JOB_ID)?.[1];
    if (id) ids.push(id);
    const name = ids.length > 0 && line.match(JOB_NAME)?.[1];
    if (name) displayNames.push(name);
  }
  assert(displayNames.length <= ids.length, `a job has at most one name, but ${displayNames.length} names were found for ${ids.length} jobs: ${JSON.stringify(displayNames)}`);
  assert([...ids, ...displayNames].every((name) => name === name.trim() && name.length > 0), `job names must be non-blank and trimmed, got ${JSON.stringify([...ids, ...displayNames])}`);
  return [...ids, ...displayNames];
};

/**
 * @param {string} repo
 * @param {string[]} requiredJobs
 */
const workflowProblems = (repo, requiredJobs) => { // zanity: ignore[assertion-density] -- single-invariant: every workflow problem is a finding returned to the caller, and the only input it can distrust is checked in jobNames
  const directory = join(repo, WORKFLOWS_DIR);
  const files = existsSync(directory) ? readdirSync(directory).filter((file) => WORKFLOW_FILE.test(file)).sort() : [];
  const found = [];
  const present = new Set();
  for (const file of files) {
    const text = readText(repo, `${WORKFLOWS_DIR}/${file}`, `workflow ${file}`);
    jobNames(text).forEach((name) => present.add(name));
    for (const line of text.split("\n")) {
      const action = line.match(USES_LINE)?.[1];
      if (action === undefined || action.startsWith(LOCAL_ACTION_PREFIX)) continue;
      if (!PINNED_ACTION.test(action) && !PINNED_DOCKER_IMAGE.test(action)) {
        found.push(`${WORKFLOWS_DIR}/${file} uses ${action}, which is not pinned to a full 40-character commit SHA. Hint: replace the tag with the commit SHA and keep the version in a trailing comment.`);
      }
    }
  }
  for (const job of requiredJobs.filter((name) => !present.has(name))) {
    found.push(`required CI job "${job}" is not defined in ${WORKFLOWS_DIR}. Hint: restore the job; it is listed under requiredCiJobs in ${ALLOWLIST_PATH}.`);
  }
  return found;
};

/**
 * @param {string} repo
 */
const manifestProblems = (repo) => {
  if (!existsSync(join(repo, GUARDS_DIR))) return [];
  if (!existsSync(join(repo, MANIFEST_PATH))) {
    return [`${GUARDS_DIR}/ exists but ${MANIFEST_PATH} is missing. Hint: restore the manifest from the main branch, or run the bootstrap command again.`];
  }
  const entries = readText(repo, MANIFEST_PATH, "the guard manifest")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => {
      const match = MANIFEST_LINE.exec(line);
      assert(match !== null, `${MANIFEST_PATH}: "${line}" must read "<sha256>  ${GUARDS_DIR}/<file>". Hint: regenerate the manifest with the bootstrap command.`);
      return { hash: match[1], path: match[2] };
    });
  assert(entries.every(({ path }) => !DOT_SEGMENTS.includes(path.slice(GUARDS_DIR.length + 1))), `${MANIFEST_PATH} must list files, not directory references, got ${JSON.stringify(entries.map(({ path }) => path))}`);
  assert(new Set(entries.map(({ path }) => path)).size === entries.length, `${MANIFEST_PATH} lists a file twice, got ${JSON.stringify(entries.map(({ path }) => path))}`);
  const listed = new Set(entries.map(({ path }) => path));
  const unlisted = readdirSync(join(repo, GUARDS_DIR))
    .filter((file) => SCRIPT_FILE.test(file) && !listed.has(`${GUARDS_DIR}/${file}`))
    .map((file) => `${GUARDS_DIR}/${file} is not listed in ${MANIFEST_PATH}. Hint: remove it, or add its hash with: shasum -a 256 ${GUARDS_DIR}/${file}`);
  const changed = entries.flatMap(({ hash, path }) => {
    if (!existsSync(join(repo, path))) return [`${path} is listed in ${MANIFEST_PATH} but missing. Hint: restore it from the main branch.`];
    if (createHash("sha256").update(readFileSync(resolve(repo, path))).digest("hex") === hash) return [];
    return [`${path} differs from ${MANIFEST_PATH}. Hint: restore the file, or if a reviewer approved the change, update the manifest in the same pull request with: shasum -a 256 ${GUARDS_DIR}/*.mjs`];
  });
  return [...unlisted, ...changed];
};

const main = () => { // zanity: ignore[assertion-density] -- entry-point: CLI main wires the checks together and prints, and its one input-dependent invariant is asserted inside
  try {
    const repo = parseArgs(process.argv.slice(2));
    const allowlist = loadAllowlist(repo);
    const problems = [
      ...(existsSync(join(repo, ZANITY_CONFIG)) ? zanityProblems(readText(repo, ZANITY_CONFIG, "the zanity config"), allowlist) : [`${ZANITY_CONFIG} is missing. Hint: zanity is a required check, so the repo must configure it.`]),
      ...workflowProblems(repo, allowlist.requiredJobs),
    ];
    if (existsSync(join(repo, OVERWATCH_CONFIG))) {
      let config;
      try {
        config = JSON.parse(readText(repo, OVERWATCH_CONFIG, "the overwatch config"));
      } catch (error) {
        if (error instanceof UsageError) throw error;
        throw new UsageError(`${OVERWATCH_CONFIG} is not valid JSON (${error instanceof Error ? error.message : String(error)})`);
      }
      if (config?.enabled === false) problems.push(`${OVERWATCH_CONFIG} sets "enabled": false, which turns the watchers off. Hint: remove the key and fix what the watchers report.`);
    }
    problems.push(...manifestProblems(repo));
    assert(problems.every((problem) => !problem.includes("\n")), `each problem must be one line, got ${JSON.stringify(problems)}`);
    if (problems.length === 0) {
      console.log("rules-about-rules: OK");
      process.exitCode = EXIT_OK;
      return;
    }
    console.error(problems.join("\n"));
    process.exitCode = EXIT_VIOLATION;
  } catch (error) {
    if (!(error instanceof UsageError || error instanceof assert.AssertionError)) throw error;
    console.error(error.message);
    process.exitCode = EXIT_USAGE;
  }
};

main();
