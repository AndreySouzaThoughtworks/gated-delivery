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
    assert(KNOWN_OPTIONS.includes(name) && value !== undefined && !value.startsWith(OPTION_PREFIX), USAGE);
    options[name.slice(OPTION_PREFIX.length)] = value;
  }
  assert(options.baseline && options["base-ref"], USAGE);
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
    throw new UsageError(`${source} is not valid JSON (${error instanceof Error ? error.message : String(error)}); regenerate it with the tool that wrote it, for example zanity check . --baseline <file> --capture-baseline`);
  }
  assert(Array.isArray(document?.findings), `${source} is not a findings baseline: it needs a findings array`);
  assert(
    document.findings.every((finding) => FINDING_FIELDS.every((field) => typeof finding?.[field] === "string")),
    `${source} is not a findings baseline: every entry needs ${FINDING_FIELDS.join(", ")}`,
  );
  const counts = new Map();
  for (const { path, rule, message } of document.findings) {
    const key = [rule, message, basename(path, extname(path))].join(KEY_SEPARATOR);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return { counts, total: document.findings.length };
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
  assert(text.length > 0, `${file} at ${baseRef} is empty, expected a baseline document`);
  assert(text.trimStart().startsWith("{"), `${file} at ${baseRef} must hold a JSON object, got ${JSON.stringify(text.slice(0, 20))}`);
  return text;
};

/** @param {string} file */
const readHead = (file) => {
  const resolved = resolve(file);
  const fromCwd = relative(process.cwd(), resolved);
  assert(!isAbsolute(fromCwd) && !fromCwd.startsWith(PARENT_SEGMENT), `${file} resolves to ${resolved}, outside ${process.cwd()}; pass a path inside the repository`);
  /** @type {string} */
  let text;
  try {
    text = readFileSync(resolved, "utf8");
  } catch (error) {
    throw new UsageError(`cannot read ${file} (${error instanceof Error && "code" in error ? error.code : String(error)}); the baseline must exist at HEAD, or be deleted together with the --new-only flag`);
  }
  assert(text.length > 0, `${file} is empty, expected a baseline document`);
  return text;
};

const main = () => { // zanity: ignore[assertion-density] -- entry-point: CLI main only wires parsing, reading and printing, and every failure it can meet is asserted and proven in the functions it calls
  try {
    const { baseline, baseRef } = parseArgs(process.argv.slice(2));
    const head = findingCounts(readHead(baseline), baseline);
    const baseText = baselineAtRef(baseRef, baseline);
    let outcome = { code: EXIT_OK, message: `${baseline} is new relative to ${baseRef}: accepted with ${head.total} findings` };
    if (baseText !== undefined) {
      const base = findingCounts(baseText, `${baseline} at ${baseRef}`);
      const problems = [];
      if (head.total > base.total) problems.push(`${baseline} grew from ${base.total} to ${head.total} findings`);
      const grown = [...head.counts].filter(([key, count]) => count > (base.counts.get(key) ?? 0));
      if (grown.length > 0) {
        const shown = grown.slice(0, REPORTED_KEY_LIMIT).map(([key, count]) => `${key} (${base.counts.get(key) ?? 0} at ${baseRef}, ${count} now)`).join("; ");
        problems.push(`${grown.length} findings are new or counted more often than at ${baseRef}, by rule | message | file name without extension: ${shown}${grown.length > REPORTED_KEY_LIMIT ? "; ..." : ""}`);
      }
      outcome = problems.length > 0
        ? { code: EXIT_VIOLATION, message: `${problems.join("; ")}. Hint: ${HOW_TO_FIX}. ${LEGITIMATE_MOVE}.` }
        : { code: EXIT_OK, message: `${baseline} holds ${head.total} findings, down from or equal to ${base.total} at ${baseRef}: ok` };
    }
    (outcome.code === EXIT_OK ? console.log : console.error)(outcome.message);
    process.exitCode = outcome.code;
  } catch (error) {
    if (!(error instanceof UsageError || error instanceof assert.AssertionError)) throw error;
    console.error(error.message);
    process.exitCode = EXIT_USAGE;
  }
};

main();
