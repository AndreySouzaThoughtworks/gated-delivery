#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, extname, isAbsolute, relative, resolve } from "node:path";

const EXIT_OK = 0;
const EXIT_VIOLATION = 1;
const EXIT_USAGE = 2;
const USAGE = "usage: node ratchet.mjs --baseline <file> --base-ref <ref>";
const HOW_TO_FIX = "fix the finding in code; do not run --update-baseline to add findings";
const REPORTED_KEY_LIMIT = 5;
const LEGITIMATE_MOVE = "A legitimate move or rename keeps the same findings under the same file name without its extension and the same function names; changing a function name, or adding a second finding of the same kind to a file, counts as new";
const OPTION_PREFIX = "--";
const PARENT_SEGMENT = "..";
/** @type {import("node:child_process").ExecFileSyncOptionsWithStringEncoding} */
const GIT_IO = { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] };
const KNOWN_OPTIONS = ["--baseline", "--base-ref"];

class UsageError extends Error {}

/**
 * @typedef {{ baseline: string, baseRef: string }} RatchetOptions
 * @typedef {{ path: string, rule: string, message: string }} Finding
 * @typedef {{ code: number, message: string }} RatchetOutcome
 */

/**
 * @param {string[]} argv
 * @returns {RatchetOptions}
 */
const parseArgs = (argv) => {
  /** @type {Record<string, string>} */
  const options = {};
  for (let i = 0; i < argv.length; i += 2) {
    const name = argv[i];
    const value = argv[i + 1];
    if (!KNOWN_OPTIONS.includes(name) || value === undefined || value.startsWith(OPTION_PREFIX)) throw new UsageError(USAGE);
    options[name.slice(OPTION_PREFIX.length)] = value;
  }
  if (!options.baseline || !options["base-ref"]) throw new UsageError(USAGE);
  return { baseline: options.baseline, baseRef: options["base-ref"] };
};

const KEY_SEPARATOR = " | ";
/** @type {(keyof Finding)[]} */
const FINDING_FIELDS = ["path", "rule", "message"];

/**
 * @param {string} text
 * @param {string} source
 */
const findingCounts = (text, source) => {
  /** @type {{ findings?: Finding[] } | null} */
  let document;
  try {
    document = JSON.parse(text);
  } catch (error) {
    throw new UsageError(`${source} is not valid JSON (${error instanceof Error ? error.message : String(error)}); regenerate it with zanity check . --baseline <file> --capture-baseline`);
  }
  if (!Array.isArray(document?.findings) || !document.findings.every((finding) => FINDING_FIELDS.every((field) => typeof finding?.[field] === "string"))) {
    throw new UsageError(`${source} is not a zanity baseline: it needs a findings array whose entries each have ${FINDING_FIELDS.join(", ")}`);
  }
  const counts = new Map();
  for (const { path, rule, message } of document.findings) {
    const key = [rule, message, basename(path, extname(path))].join(KEY_SEPARATOR);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
  assert(total === document.findings.length, `${source}: counted ${total} findings but the file lists ${document.findings.length}`);
  assert(counts.size > 0 || total === 0, `${source}: ${total} findings produced no keys`);
  return { counts, total };
};

/**
 * @param {string} baseRef
 * @param {string} file
 */
const baselineAtRef = (baseRef, file) => {
  try {
    execFileSync("git", ["rev-parse", "--verify", "--quiet", `${baseRef}^{commit}`], GIT_IO);
  } catch {
    throw new UsageError(`base ref ${baseRef} does not exist in this repository; fetch it (git fetch origin ${baseRef}) or pass another ref`);
  }
  try {
    execFileSync("git", ["cat-file", "-e", `${baseRef}:./${file}`], GIT_IO);
  } catch {
    return undefined;
  }
  const text = execFileSync("git", ["show", `${baseRef}:./${file}`], GIT_IO);
  assert(text.length > 0, `${file} at ${baseRef} is empty, expected a zanity baseline document`);
  assert(text.trimStart().startsWith("{"), `${file} at ${baseRef} must hold a JSON object, got ${JSON.stringify(text.slice(0, 20))}`);
  return text;
};

/** @param {string} file */
const readHead = (file) => {
  const resolved = resolve(file);
  const fromCwd = relative(process.cwd(), resolved);
  assert(!isAbsolute(fromCwd) && !fromCwd.startsWith(PARENT_SEGMENT), `${file} resolves to ${resolved}, outside ${process.cwd()}; pass a path inside the repository`);
  try {
    return readFileSync(resolved, "utf8");
  } catch (error) {
    throw new UsageError(`cannot read ${file} (${error instanceof Error && "code" in error ? error.code : String(error)}); the baseline must exist at HEAD, or be deleted together with the --new-only flag`);
  }
};

/**
 * @param {RatchetOptions} options
 * @returns {RatchetOutcome}
 */
const check = ({ baseline, baseRef }) => {
  const head = findingCounts(readHead(baseline), baseline);
  const baseText = baselineAtRef(baseRef, baseline);
  if (baseText === undefined) return { code: EXIT_OK, message: `${baseline} is new relative to ${baseRef}: accepted with ${head.total} findings` };
  const base = findingCounts(baseText, `${baseline} at ${baseRef}`);
  const problems = [];
  if (head.total > base.total) problems.push(`${baseline} grew from ${base.total} to ${head.total} findings`);
  const grown = [...head.counts].filter(([key, count]) => count > (base.counts.get(key) ?? 0));
  if (grown.length > 0) {
    const shown = grown.slice(0, REPORTED_KEY_LIMIT).map(([key, count]) => `${key} (${base.counts.get(key) ?? 0} at ${baseRef}, ${count} now)`).join("; ");
    problems.push(`${grown.length} findings are new or counted more often than at ${baseRef}, by rule | message | file name without extension: ${shown}${grown.length > REPORTED_KEY_LIMIT ? "; ..." : ""}`);
  }
  if (problems.length > 0) return { code: EXIT_VIOLATION, message: `${problems.join("; ")}. Hint: ${HOW_TO_FIX}. ${LEGITIMATE_MOVE}.` };
  return { code: EXIT_OK, message: `${baseline} holds ${head.total} findings, down from or equal to ${base.total} at ${baseRef}: ok` };
};

const main = () => {
  try {
    const { code, message } = check(parseArgs(process.argv.slice(2)));
    (code === EXIT_OK ? console.log : console.error)(message);
    process.exitCode = code;
  } catch (error) {
    if (!(error instanceof UsageError || error instanceof assert.AssertionError)) throw error;
    console.error(error.message);
    process.exitCode = EXIT_USAGE;
  }
};

main();
