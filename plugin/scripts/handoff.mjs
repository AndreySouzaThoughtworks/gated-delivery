#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const EXIT_OK = 0;
const EXIT_FAILED = 1;
const EXIT_USAGE = 2;
const EXIT_UNMERGEABLE = 3;
const ENCODING = "utf8";
const PARSE_ARGS_CODE_PREFIX = "ERR_PARSE_ARGS";
const SECTION_PREFIX = "## ";
const ENTRY_PREFIX = "### ";
const FENCE = "```";
const RESUME_HEADING = /^## Resume — .+$/;
const CARRY_FORWARD_HEADING = "## Carry forward";
const OUTCOME_HEADING = "## Outcome";
const SLICE_NUMBER = /^\d+$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z$/;
const UPDATED_LINE = /^- Updated: (\S+)$/m;
const CLOSED_LINE = /^- Closed: /m;
const FOLDED_PREFIX = "Folded into handoff.md: ";
const PER_SLICE_FILE = /^handoff-s\d+\.md$/;
const HANDOFF_FILE = "handoff.md";
const FRONTMATTER = /^---\n([\s\S]*?)\n---(\n|$)/;
const STATUS_LINE = /^status:.*$/m;
const SHIPPED_STATUS = "status: Shipped";
const NOT_OPENED = "not opened";
const NEWLINE = "\n";
const PARAGRAPH_BREAK = "\n\n";
const LEADING_BLANK_LINES = /^(\s*\n)+/;
const CLOSED_PREFIX = "- Closed: ";
const LINE_BREAK = /\r?\n/;
const LINE_BREAK_ANYWHERE = /[\r\n]/;
const TIMESTAMP_LENGTH = "YYYY-MM-DDTHH:MM".length;
const NOT_FOUND = -1;
const REQUIRED_RESUME_OPTIONS = ["file", "actor", "rollout-slice", "branch", "base-ref", "base-sha", "last-verified", "next"];
const USAGE = [
  "usage: handoff.mjs write-resume --file <handoff.md> --actor <name> [--slice <n>] --rollout-slice <text> --branch <branch> --base-ref <ref> --base-sha <sha> [--pr <url>] --last-verified <text> --next <text>",
  "       handoff.mjs merge --ours <file> --theirs <file> --out <file>",
  "       handoff.mjs close --dir <ticket directory> --outcome-file <file> --spec <spec.md>",
].join("\n");

/** @typedef {{ heading: string, body: string }} Part */
/** @typedef {{ head: string, parts: Part[] }} Sections */

export class Unmergeable extends Error {}

/**
 * @param {Date} date
 * @returns {string}
 */
export const formatTimestamp = (date) => {
  assert(date instanceof Date, `the timestamp source must be a Date, got ${typeof date}`);
  assert(Number.isFinite(date.getTime()), "the timestamp source must be a valid date");
  return `${date.toISOString().slice(0, TIMESTAMP_LENGTH)}Z`;
};

/**
 * @param {string} text
 * @param {string} prefix
 * @returns {Sections}
 */
export const splitSections = (text, prefix) => {
  assert(typeof text === "string", `the text to split must be a string, got ${typeof text}`);
  assert(prefix === SECTION_PREFIX || prefix === ENTRY_PREFIX, `the heading prefix must be ${JSON.stringify(SECTION_PREFIX)} or ${JSON.stringify(ENTRY_PREFIX)}, got ${JSON.stringify(prefix)}`);
  /** @type {string[]} */
  const headLines = [];
  /** @type {{ heading: string, lines: string[] }[]} */
  const found = [];
  let fenced = false;
  for (const line of text.split(LINE_BREAK)) {
    if (line.startsWith(FENCE)) fenced = !fenced;
    if (!fenced && line.startsWith(prefix)) found.push({ heading: line.trimEnd(), lines: [] });
    else (found.length === 0 ? headLines : found[found.length - 1].lines).push(line);
  }
  return {
    head: headLines.join(NEWLINE).trimEnd(),
    parts: found.map(({ heading, lines }) => ({ heading, body: lines.join(NEWLINE).replace(LEADING_BLANK_LINES, "").trimEnd() })),
  };
};

/**
 * @param {Sections} sections
 * @returns {string}
 */
export const renderSections = ({ head, parts }) => {
  assert(typeof head === "string", `the head must be a string, got ${typeof head}`);
  assert(parts.every((part) => part.heading.startsWith("##")), "every part needs a markdown heading");
  const blocks = parts.map(({ heading, body }) => (body === "" ? heading : `${heading}${PARAGRAPH_BREAK}${body}`));
  return [head, ...blocks].filter((block) => block !== "").join(PARAGRAPH_BREAK);
};

/**
 * @param {Part[]} parts
 * @param {Part} incoming
 * @returns {Part[]}
 */
export const placeResume = (parts, incoming) => {
  assert(RESUME_HEADING.test(incoming.heading), `${JSON.stringify(incoming.heading)} is not a Resume heading`);
  assert(Array.isArray(parts), `the parts must be a list, got ${typeof parts}`);
  const existing = parts.findIndex((part) => part.heading === incoming.heading);
  if (existing !== NOT_FOUND) return parts.map((part, index) => (index === existing ? incoming : part));
  const lastResume = parts.map((part) => RESUME_HEADING.test(part.heading)).lastIndexOf(true);
  const carryForward = parts.findIndex((part) => part.heading === CARRY_FORWARD_HEADING);
  let position = parts.length;
  if (lastResume !== NOT_FOUND) position = lastResume + 1;
  else if (carryForward !== NOT_FOUND) position = carryForward;
  return [...parts.slice(0, position), incoming, ...parts.slice(position)];
};

/**
 * @param {Part} own
 * @param {Part} other
 * @returns {Part}
 */
export const laterResume = (own, other) => {
  assert(RESUME_HEADING.test(own.heading), `${JSON.stringify(own.heading)} is not a Resume heading`);
  assert(own.heading === other.heading, `only one actor's own block resolves by Updated, got ${own.heading} and ${other.heading}`);
  const [ownStamp, otherStamp] = [own, other].map((part) => part.body.match(UPDATED_LINE)?.[1] ?? "");
  if (!TIMESTAMP.test(ownStamp) || !TIMESTAMP.test(otherStamp)) throw new Unmergeable(`${own.heading} needs a valid "Updated:" line in both files to pick the later one`);
  if (ownStamp === otherStamp) throw new Unmergeable(`${own.heading} differs between the files but both say Updated: ${ownStamp}`);
  return ownStamp > otherStamp ? own : other;
};

/**
 * @param {string} ours
 * @param {string} theirs
 * @returns {string}
 */
export const mergeCarryForward = (ours, theirs) => {
  assert(typeof ours === "string", `ours must be a string, got ${typeof ours}`);
  assert(typeof theirs === "string", `theirs must be a string, got ${typeof theirs}`);
  const own = splitSections(ours, ENTRY_PREFIX);
  const other = splitSections(theirs, ENTRY_PREFIX);
  if (own.head !== other.head) throw new Unmergeable(`the text under ${CARRY_FORWARD_HEADING} before its first entry differs`);
  const unseen = other.parts.filter((entry) => !own.parts.some((seen) => seen.heading === entry.heading && seen.body === entry.body));
  return renderSections({ head: own.head, parts: [...own.parts, ...unseen] });
};

/**
 * @param {string} ours
 * @param {string} theirs
 * @returns {string}
 */
export const mergeSections = (ours, theirs) => {
  assert(typeof ours === "string", `ours must be a string, got ${typeof ours}`);
  assert(typeof theirs === "string", `theirs must be a string, got ${typeof theirs}`);
  const base = splitSections(ours, SECTION_PREFIX);
  const incoming = splitSections(theirs, SECTION_PREFIX);
  if (base.head !== incoming.head) throw new Unmergeable("the text before the first section differs");
  let parts = base.parts;
  for (const part of incoming.parts) {
    const own = parts.find((candidate) => candidate.heading === part.heading);
    const isResume = RESUME_HEADING.test(part.heading);
    if (part.heading === CARRY_FORWARD_HEADING) {
      parts = own ? parts.map((candidate) => (candidate === own ? { heading: own.heading, body: mergeCarryForward(own.body, part.body) } : candidate)) : [...parts, part];
    } else if (own && own.body === part.body) {
      continue;
    } else if (!isResume) {
      throw new Unmergeable(`${part.heading} ${own ? "differs between the files" : "exists in only one file"}; only Resume blocks and Carry forward entries merge`);
    } else {
      parts = placeResume(parts, own ? laterResume(own, part) : part);
    }
  }
  return renderSections({ head: base.head, parts });
};

/**
 * @param {string} actor
 * @param {string | undefined} slice
 * @returns {string}
 */
export const resumeHeading = (actor, slice) => {
  assert(actor.trim() !== "" && !LINE_BREAK_ANYWHERE.test(actor), `the actor must be one non-empty line, got ${JSON.stringify(actor)}`);
  assert(slice === undefined || SLICE_NUMBER.test(slice), `the slice must be a number, got ${JSON.stringify(slice)}`);
  return `${SECTION_PREFIX}Resume — ${actor}${slice === undefined ? "" : ` — s${slice}`}`;
};

/**
 * @param {string[]} argv
 * @returns {Record<string, unknown>}
 */
const writeResume = (argv) => {
  const { values } = parseArgs({
    args: argv,
    options: Object.fromEntries([...REQUIRED_RESUME_OPTIONS, "slice", "pr"].map((name) => [name, { type: "string" }])),
  });
  const given = Object.fromEntries(Object.entries(values).map(([name, value]) => [name, String(value)]));
  for (const name of REQUIRED_RESUME_OPTIONS) assert(given[name]?.trim(), `--${name} is required`);
  for (const [name, value] of Object.entries(given)) assert(!LINE_BREAK_ANYWHERE.test(value), `--${name} must be one line`);
  const updated = formatTimestamp(new Date());
  const heading = resumeHeading(given.actor, given.slice);
  const body = [
    `- Updated: ${updated}`,
    `- Slice: ${given["rollout-slice"]}`,
    `- Branch: ${given.branch}`,
    `- Base: ${given["base-ref"]} at ${given["base-sha"]}`,
    `- PR: ${given.pr ?? NOT_OPENED}`,
    `- Last verified: ${given["last-verified"]}`,
    `- Next: ${given.next}`,
  ].join(NEWLINE);
  const file = given.file;
  const sections = splitSections(existsSync(file) ? readFileSync(file, ENCODING) : "", SECTION_PREFIX);
  writeFileSync(file, `${renderSections({ head: sections.head, parts: placeResume(sections.parts, { heading, body }) })}${NEWLINE}`);
  return { file, heading, updated };
};

/**
 * @param {string[]} argv
 * @returns {Record<string, unknown>}
 */
const merge = (argv) => {
  const { values } = parseArgs({ args: argv, options: { ours: { type: "string" }, theirs: { type: "string" }, out: { type: "string" } } });
  const { ours, theirs, out } = values;
  assert(ours && theirs && out, "--ours, --theirs and --out are all required");
  assert(existsSync(ours) && existsSync(theirs), `both input files must exist, got ${ours} and ${theirs}`);
  writeFileSync(out, `${mergeSections(readFileSync(ours, ENCODING), readFileSync(theirs, ENCODING))}${NEWLINE}`);
  return { out };
};

/**
 * @param {string[]} argv
 * @returns {Record<string, unknown>}
 */
const close = (argv) => {
  const { values } = parseArgs({ args: argv, options: { dir: { type: "string" }, "outcome-file": { type: "string" }, spec: { type: "string" } } });
  const { dir, "outcome-file": outcomeFile, spec } = values;
  assert(dir && outcomeFile && spec, "--dir, --outcome-file and --spec are all required");
  const handoffPath = join(dir, HANDOFF_FILE);
  assert(existsSync(handoffPath), `${handoffPath} does not exist; there is no handoff to close`);
  const outcome = readFileSync(outcomeFile, ENCODING).trim();
  assert(outcome !== "", `${outcomeFile} is empty; the outcome is written by the model before closing`);
  const specText = readFileSync(spec, ENCODING);
  const frontmatter = specText.match(FRONTMATTER);
  assert(frontmatter && STATUS_LINE.test(frontmatter[1]), `${spec} needs frontmatter with a status: line`);
  const closedAt = formatTimestamp(new Date());
  const pending = readdirSync(dir).filter((name) => PER_SLICE_FILE.test(name)).sort()
    .map((name) => ({ path: join(dir, name), text: readFileSync(join(dir, name), ENCODING) }))
    .filter(({ text }) => !text.startsWith(FOLDED_PREFIX));
  const original = readFileSync(handoffPath, ENCODING);
  const { head: originalHead } = splitSections(original, SECTION_PREFIX);
  const folded = pending.reduce((merged, { text }) => {
    const carried = splitSections(text, SECTION_PREFIX).parts.filter((part) => RESUME_HEADING.test(part.heading) || part.heading === CARRY_FORWARD_HEADING);
    return mergeSections(merged, renderSections({ head: originalHead, parts: carried }));
  }, original);
  const { head, parts } = splitSections(folded, SECTION_PREFIX);
  const stamped = parts
    .filter((part) => part.heading !== OUTCOME_HEADING)
    .map((part) => (RESUME_HEADING.test(part.heading) && !CLOSED_LINE.test(part.body) ? { heading: part.heading, body: `${part.body}${NEWLINE}${CLOSED_PREFIX}${closedAt}` } : part));
  writeFileSync(handoffPath, `${renderSections({ head, parts: [{ heading: OUTCOME_HEADING, body: outcome }, ...stamped] })}${NEWLINE}`);
  for (const { path, text } of pending) writeFileSync(path, `${FOLDED_PREFIX}${closedAt}${PARAGRAPH_BREAK}${text}`);
  writeFileSync(spec, specText.replace(frontmatter[0], frontmatter[0].replace(STATUS_LINE, SHIPPED_STATUS)));
  return { handoff: handoffPath, folded: pending.map(({ path }) => path), closedAt, spec };
};

const COMMANDS = new Map([["write-resume", writeResume], ["merge", merge], ["close", close]]);

/**
 * @param {string[]} argv
 * @returns {number}
 */
const main = (argv) => { // zanity: ignore[assertion-density] -- entry-point: CLI main dispatches a subcommand and maps its errors to exit codes, and its one input-dependent invariant is asserted inline
  try {
    const [name, ...rest] = argv;
    const command = COMMANDS.get(String(name));
    assert(command, `unknown subcommand ${JSON.stringify(name)}`);
    console.log(JSON.stringify(command(rest)));
    return EXIT_OK;
  } catch (error) {
    if (error instanceof Unmergeable) {
      console.error(`handoff: STOP and ask the user: ${error.message}`);
      return EXIT_UNMERGEABLE;
    }
    const isUsage = error instanceof assert.AssertionError || String(/** @type {NodeJS.ErrnoException} */ (error).code).startsWith(PARSE_ARGS_CODE_PREFIX);
    console.error(`handoff: ${error instanceof Error ? error.message : String(error)}${isUsage ? `\n${USAGE}` : ""}`);
    return isUsage ? EXIT_USAGE : EXIT_FAILED;
  }
};

const entryPoint = process.argv[1];
if (entryPoint !== undefined && import.meta.url === pathToFileURL(realpathSync(entryPoint)).href) process.exitCode = main(process.argv.slice(2));
