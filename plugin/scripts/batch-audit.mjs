#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const EXIT_CLEAN = 0;
const EXIT_VIOLATIONS = 1;
const EXIT_USAGE = 2;
const ENCODING = "utf8";
const GIT_BUFFER_BYTES = 256 * 1024 * 1024;
const GIT_OPTIONS = { encoding: ENCODING, maxBuffer: GIT_BUFFER_BYTES };
const FIELD_SEPARATOR = "\x1f";
const RECORD_SEPARATOR = "\x1e";
const LOG_FORMAT = `%H${FIELD_SEPARATOR}%s${FIELD_SEPARATOR}%b${RECORD_SEPARATOR}`;
const RANGE_MARKER = "..";
const POSITIVE_INTEGER = /^[1-9]\d*$/;
const CONVENTIONAL_SUBJECT = /^(?:feat|fix|refactor|test|docs|chore|perf|style|build|ci|revert)(?:\([^)\s]+\))?!?: \S/;
const AC_TOKEN = /\bAC\[?\d+\]?\b/;
const NEW_FILE_HEADER = /^\+\+\+ b\/(.+)$/;
const ADDED_LINE = /^\+(?!\+\+ )(.*)$/;
const CODE_FILE = /\.(?:[cm]?[jt]sx?|py)$/;
const PYTHON_FILE = /\.py$/;
const SCRIPT_COMMENT = /^\s*(?:\/\/|\/\*|\*)/;
const PYTHON_COMMENT = /^\s*#/;
const SCRIPT_TEST_TITLE = /\b(?:it|test|describe)(?:\.\w+)*\(\s*(['"`])((?:\\.|(?!\1).)*)\1/;
const PYTHON_TEST_NAME = /^\s*(?:async\s+)?def\s+(test\w*)/;
const REGEX_SPECIALS = /[.*+?^${}()|[\]\\]/g;
const USAGE = "usage: batch-audit.mjs <batch-base>..HEAD --ticket <id> --acs <n> [--complete] [--slug <spec-slug>] [--repo <dir>]";

const RULE_SUBJECT_NOT_CONVENTIONAL = "subject-not-conventional";
const RULE_AC_IN_COMMIT_TEXT = "ac-number-in-commit-text";
const RULE_SLUG_IN_COMMIT_TEXT = "spec-slug-in-commit-text";
const RULE_REFERENCE_IN_TEST_TITLE = "reference-in-test-title";
const RULE_REFERENCE_IN_COMMENT = "reference-in-comment";
const RULE_FEWER_COMMITS_THAN_ACS = "fewer-commits-than-acs";

/** @typedef {{ file: string, text: string }} AddedLine */
/** @typedef {{ sha: string, subject: string, body: string, added: AddedLine[] }} Commit */
/** @typedef {{ ticket: string, slug?: string }} Forbidden */

/**
 * @param {string} diff
 * @returns {AddedLine[]}
 */
export const addedLines = (diff) => { // zanity: ignore[assertion-density] -- single-invariant: the text-type check is the only input precondition, and the parse below only matches and slices
  assert(typeof diff === "string", `a diff must be text, got ${typeof diff}`);
  /** @type {AddedLine[]} */
  const added = [];
  let file = "";
  for (const line of diff.split("\n")) {
    const header = line.match(NEW_FILE_HEADER);
    if (header) file = header[1];
    else if (line.startsWith("+++ ")) file = "";
    const text = line.match(ADDED_LINE)?.[1];
    if (text !== undefined && file !== "") added.push({ file, text });
  }
  return added;
};

/**
 * @param {Commit} commit
 * @param {Forbidden} forbidden
 * @returns {string[]}
 */
export const commitViolations = ({ subject, body, added }, { ticket, slug }) => {
  assert(typeof subject === "string" && typeof body === "string", `a commit needs a text subject and body, got ${typeof subject} and ${typeof body}`);
  assert(Array.isArray(added), `a commit needs its added lines as a list, got ${typeof added}`);
  const [ticketLiteral, slugLiteral] = [ticket, slug ?? ""].map((literal) => literal.replace(REGEX_SPECIALS, "\\$&"));
  const cited = new RegExp([AC_TOKEN.source, `\\b${ticketLiteral}\\b`, ...(slug ? [slugLiteral] : [])].join("|"));
  const found = [];
  if (!CONVENTIONAL_SUBJECT.test(subject)) found.push(`${RULE_SUBJECT_NOT_CONVENTIONAL}: ${JSON.stringify(subject)}`);
  const text = `${subject}\n${body}`;
  const acToken = text.match(AC_TOKEN)?.[0];
  if (acToken) found.push(`${RULE_AC_IN_COMMIT_TEXT}: ${acToken}`);
  if (slug && text.includes(slug)) found.push(`${RULE_SLUG_IN_COMMIT_TEXT}: ${slug}`);
  for (const { file, text: line } of added.filter(({ file: path }) => CODE_FILE.test(path))) {
    const isPython = PYTHON_FILE.test(file);
    const title = isPython ? line.match(PYTHON_TEST_NAME)?.[1].replaceAll("_", " ") : line.match(SCRIPT_TEST_TITLE)?.[2];
    const isComment = (isPython ? PYTHON_COMMENT : SCRIPT_COMMENT).test(line);
    if (title !== undefined && cited.test(title)) found.push(`${RULE_REFERENCE_IN_TEST_TITLE}: ${file}: ${title}`);
    if (isComment && cited.test(line)) found.push(`${RULE_REFERENCE_IN_COMMENT}: ${file}: ${line.trim()}`);
  }
  return found;
};

/**
 * @param {string} range
 * @param {{ ticket: string, acs: number, complete: boolean, slug?: string, repo: string }} options
 * @returns {{ commits: number, violations: { commit: string, rule: string }[] }}
 */
export const auditRange = (range, { ticket, acs, complete, slug, repo }) => {
  assert(range.includes(RANGE_MARKER), `the range must look like <batch-base>..HEAD, got ${JSON.stringify(range)}`);
  assert(Number.isInteger(acs) && acs > 0, `--acs must be a positive integer, got ${acs}`);
  const commits = execFileSync("git", ["-C", repo, "log", "--no-merges", "--reverse", `--format=${LOG_FORMAT}`, range], GIT_OPTIONS)
    .split(RECORD_SEPARATOR)
    .map((record) => record.trim())
    .filter((record) => record !== "")
    .map((record) => record.split(FIELD_SEPARATOR));
  const violations = commits.flatMap(([sha, subject, body]) => {
    const added = addedLines(execFileSync("git", ["-C", repo, "show", "--no-color", "--no-ext-diff", "--format=", "--unified=0", sha], GIT_OPTIONS));
    return commitViolations({ sha, subject, body: body.trim(), added }, { ticket, slug }).map((rule) => ({ commit: sha, rule }));
  });
  if (complete && commits.length < acs) violations.push({ commit: range, rule: `${RULE_FEWER_COMMITS_THAN_ACS}: ${commits.length} commits for ${acs} ACs` });
  return { commits: commits.length, violations };
};

/**
 * @param {string[]} argv
 * @returns {number}
 */
const main = (argv) => {
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      options: { ticket: { type: "string" }, acs: { type: "string" }, complete: { type: "boolean" }, slug: { type: "string" }, repo: { type: "string" } },
      allowPositionals: true,
    });
    assert(positionals.length === 1, `expected one <batch-base>..HEAD range, got ${positionals.length} arguments`);
    assert(values.ticket && POSITIVE_INTEGER.test(values.acs ?? ""), `--ticket and a positive --acs are required, got ${JSON.stringify(values.ticket)} and ${JSON.stringify(values.acs)}`);
    const result = auditRange(positionals[0], { ticket: values.ticket, acs: Number(values.acs), complete: values.complete === true, slug: values.slug, repo: values.repo ?? process.cwd() });
    console.log(JSON.stringify(result));
    return result.violations.length === 0 ? EXIT_CLEAN : EXIT_VIOLATIONS;
  } catch (error) {
    console.error(`batch-audit: ${error instanceof Error ? error.message : String(error)}\n${USAGE}`);
    return EXIT_USAGE;
  }
};

const entryPoint = process.argv[1];
if (entryPoint !== undefined && import.meta.url === pathToFileURL(realpathSync(entryPoint)).href) process.exitCode = main(process.argv.slice(2));
