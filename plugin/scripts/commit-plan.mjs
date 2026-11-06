#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const EXIT_PLANNED = 0;
const EXIT_NEEDS_TICKET = 1;
const EXIT_USAGE = 2;
const EXIT_BAD_STAGING = 3;
const REFUSAL_EXITS = [EXIT_NEEDS_TICKET, EXIT_USAGE, EXIT_BAD_STAGING];
const ENCODING = "utf8";
const PATHS_SEPARATOR = "--";
const SOURCE_CLIENT = "client";
const SOURCE_PLAIN = "plain";
const SOURCE_PLAIN_UNPROVEN = "plain-unproven";
const PLAIN_TYPES = ["feat", "fix", "chore", "refactor", "docs", "test", "perf", "build", "ci", "style"];
const PLAIN_TYPE = new RegExp(`^(?:${PLAIN_TYPES.join("|")})(?:\\([^)]+\\))?!?$`);
const PLAIN_SUBJECT_TEMPLATE = "<type>: <description>";
const PLAIN_BRANCH_TEMPLATE = "<type>/<short-desc>";
const KEY_PLACEHOLDER = "<KEY>-<N>";
const OPEN_PLACEHOLDER = /<[^>\s]+>/;
const TICKET_KEY = /^[A-Z][A-Z0-9]*-\d+$/;
const TICKET_KEY_IN_BRANCH = /(?<![A-Za-z0-9])[A-Z][A-Z0-9]*-\d+/;
const STAGE_ALL_FLAGS = new Set([".", "./", "-A", "--all", "-u", "--update", ":/"]);
const PATHSPEC_MAGIC_OR_GLOB = /^:|[*?[]/;
const AGENT_SCRATCH = /(^|\/)\.claude(\/|$)/;
const COMMIT_CONVENTION_HEADING = "Commit convention";
const REQUIRED_FLAGS = /** @type {const} */ (["type", "description"]);
const CLAUDE_MD_NAME = "CLAUDE.md";
const ORIGIN_COMMAND = ["config", "--get", "remote.origin.url"];
const BRANCH_COMMAND = ["branch", "--show-current"];
const DEFAULT_LOCAL_NOTES = join(homedir(), ".local", "state", "gated-delivery");
const BODY_FILE_PREFIX = "pr-body-";
const BODY_FILE_SUFFIX = ".md";
const OPTIONS = /** @type {const} */ ({
  "claude-md": { type: "string" },
  origin: { type: "string" },
  branch: { type: "string" },
  type: { type: "string" },
  description: { type: "string" },
  ticket: { type: "string" },
  "local-notes": { type: "string" },
});
const USAGE = `usage: commit-plan.mjs --type <type> --description <text> [--claude-md <file>] [--origin <url>] [--branch <name>] [--ticket <KEY-N>] [--local-notes <dir>] [${PATHS_SEPARATOR} <staged path>...]`;

/**
 * @typedef {{ source: string, subject: string, branchTemplate: string, prBodyFile: string }} CommitPlan
 * @typedef {Error & { exit: number }} Refusal
 */

/**
 * @param {string} message
 * @param {number} exit
 * @returns {Refusal}
 */
export const refusal = (message, exit) => {
  assert(typeof message === "string" && message.length > 0, `a refusal needs a message that says what to fix, got ${JSON.stringify(message)}`);
  assert(REFUSAL_EXITS.includes(exit), `a refusal exits with one of ${REFUSAL_EXITS.join(", ")}, got ${exit}`);
  return Object.assign(new Error(message), { exit });
};

/**
 * @param {string} claudeMd
 * @returns {Record<string, string> | undefined}
 */
export const conventionOf = (claudeMd) => {
  assert(typeof claudeMd === "string", `the CLAUDE.md text must be a string, got ${typeof claudeMd}`);
  const sections = claudeMd.split(/^## /m).filter((part) => part.startsWith(COMMIT_CONVENTION_HEADING));
  assert(sections.length <= 1, `CLAUDE.md holds ${sections.length} "## ${COMMIT_CONVENTION_HEADING}" sections; keep one so the convention is not ambiguous`);
  if (sections.length === 0) return undefined;
  return Object.fromEntries([...sections[0].matchAll(/^- \*\*([^:*]+):\*\*\s*(.+)$/gm)].map(([, key, value]) => [key.trim(), value.trim()]));
};

/**
 * @param {Record<string, string> | undefined} convention
 * @param {string} origin
 * @returns {string}
 */
export const sourceOf = (convention, origin) => {
  assert(typeof origin === "string", `the origin must be a string, got ${typeof origin}; pass --origin <url>`);
  assert(convention === undefined || typeof convention === "object", `the convention must come from conventionOf, got ${typeof convention}`);
  if (convention?.Subject === undefined) return SOURCE_PLAIN;
  const backtickedOrigins = [...(convention["Applies to"] ?? "").matchAll(/`([^`]+)`/g)].map(([, needle]) => needle);
  if (backtickedOrigins.length === 0) return convention["Applies to"] === undefined ? SOURCE_PLAIN : SOURCE_PLAIN_UNPROVEN;
  return backtickedOrigins.some((needle) => origin.includes(needle)) ? SOURCE_CLIENT : SOURCE_PLAIN;
};

/**
 * @param {string[]} paths
 * @returns {string[]}
 */
export const stagingProblems = (paths) => {
  assert(Array.isArray(paths), `the staged paths must be a list, got ${typeof paths}`);
  assert(paths.every((path) => typeof path === "string" && path !== ""), `every staged path must be a non-empty string, got ${JSON.stringify(paths)}`);
  return paths.flatMap((path) => {
    const shown = JSON.stringify(path);
    if (STAGE_ALL_FLAGS.has(path)) return [`${shown} stages everything; name each file of this change by explicit path`];
    if (PATHSPEC_MAGIC_OR_GLOB.test(path)) return [`${shown} is a glob or pathspec magic; name each file by explicit path`];
    if (AGENT_SCRATCH.test(path)) return [`${shown} is agent scratch; leave .claude/ and agent notes out of the commit and drop this path`];
    return [];
  });
};

/**
 * @param {string} branch
 * @param {string} [localNotes]
 * @returns {string}
 */
export const prBodyFile = (branch, localNotes = DEFAULT_LOCAL_NOTES) => {
  assert(typeof branch === "string" && branch !== "", `the branch name must be a non-empty string, got ${JSON.stringify(branch)}`);
  assert(isAbsolute(localNotes), `--local-notes must be an absolute directory, got ${JSON.stringify(localNotes)}; pass the Local notes home from ## Delivery notes`);
  return join(localNotes, `${BODY_FILE_PREFIX}${branch.replaceAll("/", "-")}${BODY_FILE_SUFFIX}`);
};

/**
 * @param {{ claudeMd: string, origin: string, branch: string, type: string, description: string, ticket?: string, localNotes?: string }} input
 * @returns {CommitPlan}
 */
export const plan = ({ claudeMd, origin, branch, type, description, ticket, localNotes }) => {
  assert(typeof description === "string" && description.trim() !== "", `--description must say what the change does, got ${JSON.stringify(description)}`);
  assert(typeof branch === "string", `the branch must be a string, got ${typeof branch}; pass --branch <name>`);
  const convention = conventionOf(claudeMd);
  const source = sourceOf(convention, origin);
  const client = source === SOURCE_CLIENT;
  if (!client && !PLAIN_TYPE.test(type)) throw refusal(`--type ${JSON.stringify(type)} is not plain Conventional Commits; use one of ${PLAIN_TYPES.join(" ")}, optionally with (scope) or !`, EXIT_USAGE);
  if (ticket !== undefined && !TICKET_KEY.test(ticket)) throw refusal(`--ticket ${JSON.stringify(ticket)} is not a ticket key like ABC-123; pass the key the user named`, EXIT_USAGE);
  const subjectTemplate = client ? String(convention?.Subject).replaceAll("`", "") : PLAIN_SUBJECT_TEMPLATE;
  const branchTemplate = client ? (convention?.Branch ?? PLAIN_BRANCH_TEMPLATE).replaceAll("`", "") : PLAIN_BRANCH_TEMPLATE;
  const key = ticket ?? branch.match(TICKET_KEY_IN_BRANCH)?.[0];
  if (subjectTemplate.includes(KEY_PLACEHOLDER) && key === undefined) throw refusal(`branch ${JSON.stringify(branch)} carries no ticket key and the CLAUDE.md Subject template needs one; ask which ticket this belongs to, then rerun with --ticket <KEY-N>`, EXIT_NEEDS_TICKET);
  const subject = subjectTemplate.replace(KEY_PLACEHOLDER, key ?? "").replace("<type>", type).replace("<description>", description);
  const unfilled = client ? subject.match(OPEN_PLACEHOLDER) : null;
  if (unfilled) throw refusal(`the CLAUDE.md Subject template leaves ${unfilled[0]} unfilled; this script fills only <type>, ${KEY_PLACEHOLDER} and <description>, so write the subject by hand from the template`, EXIT_USAGE);
  return { source, subject, branchTemplate, prBodyFile: prBodyFile(branch, localNotes) };
};

/**
 * @param {string} directory
 * @returns {string | undefined}
 */
export const nearestClaudeMd = (directory) => {
  assert(isAbsolute(directory), `the search directory must be absolute, got ${JSON.stringify(directory)}`);
  assert(existsSync(directory), `the search directory must exist, got ${directory}`);
  const candidate = join(directory, CLAUDE_MD_NAME);
  if (existsSync(candidate)) return candidate;
  const parent = dirname(directory);
  return parent === directory ? undefined : nearestClaudeMd(parent);
};

/**
 * @param {string} directory
 * @returns {{ origin: string, branch: string }}
 */
export const checkoutFacts = (directory) => {
  assert(isAbsolute(directory), `the checkout directory must be absolute, got ${JSON.stringify(directory)}`);
  assert(existsSync(directory), `the checkout directory must exist, got ${directory}`);
  const [origin, branch] = [ORIGIN_COMMAND, BRANCH_COMMAND].map((args) => {
    try {
      return execFileSync("git", args, { cwd: directory, encoding: ENCODING, stdio: ["ignore", "pipe", "ignore"] }).trim();
    } catch {
      return "";
    }
  });
  return { origin, branch };
};

/**
 * @param {string[]} argv
 * @returns {number}
 */
export const main = (argv) => {
  assert(Array.isArray(argv), `the arguments must be a list, got ${typeof argv}`);
  assert(argv.every((argument) => typeof argument === "string"), `every argument must be a string, got ${JSON.stringify(argv)}`);
  try {
    const separator = argv.indexOf(PATHS_SEPARATOR);
    const flags = separator === -1 ? argv : argv.slice(0, separator);
    const paths = separator === -1 ? [] : argv.slice(separator + 1);
    const { values } = parseArgs({ args: flags, options: OPTIONS });
    const missing = REQUIRED_FLAGS.filter((name) => !values[name]);
    if (missing.length > 0) throw refusal(`missing --${missing.join(", --")}\n${USAGE}`, EXIT_USAGE);
    const problems = stagingProblems(paths);
    if (problems.length > 0) throw refusal(`bad staging, the commit rule allows explicit paths only:\n${problems.join("\n")}`, EXIT_BAD_STAGING);
    const claudeMdPath = values["claude-md"] ?? nearestClaudeMd(process.cwd());
    const facts = checkoutFacts(process.cwd());
    const branch = values.branch ?? facts.branch;
    if (branch === "") throw refusal(`no current branch (detached HEAD?); pass --branch <name>\n${USAGE}`, EXIT_USAGE);
    const claudeMd = claudeMdPath === undefined ? "" : readFileSync(claudeMdPath, ENCODING);
    console.log(JSON.stringify(plan({ claudeMd, origin: values.origin ?? facts.origin, branch, type: String(values.type), description: String(values.description), ticket: values.ticket, localNotes: values["local-notes"] })));
    return EXIT_PLANNED;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return /** @type {Partial<Refusal>} */ (error).exit ?? EXIT_USAGE;
  }
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main(process.argv.slice(2));
