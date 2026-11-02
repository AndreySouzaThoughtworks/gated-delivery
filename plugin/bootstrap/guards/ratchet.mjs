#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

const EXIT_OK = 0;
const EXIT_VIOLATION = 1;
const EXIT_USAGE = 2;
const USAGE = "usage: node ratchet.mjs --baseline <file> --base-ref <ref>";
const HOW_TO_FIX = "fix the finding in code; do not run --update-baseline to add findings";
const REPORTED_ID_LIMIT = 5;
const OPTION_PREFIX = "--";
const PARENT_SEGMENT = "..";
const GIT_IO = { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] };
const KNOWN_OPTIONS = ["--baseline", "--base-ref"];

class UsageError extends Error {}

const parseArgs = (argv) => {
  const options = {};
  for (let i = 0; i < argv.length; i += 2) {
    const name = argv[i];
    const value = argv[i + 1];
    if (!KNOWN_OPTIONS.includes(name) || value === undefined || value.startsWith(OPTION_PREFIX)) throw new UsageError(USAGE);
    options[name.slice(OPTION_PREFIX.length)] = value;
  }
  if (!options.baseline || !options["base-ref"]) throw new UsageError(USAGE);
  assert(options.baseline.length > 0, `--baseline must name a file, got "${options.baseline}"; pass the baseline path`);
  assert(!options["base-ref"].startsWith(OPTION_PREFIX), `--base-ref must be a git ref, got "${options["base-ref"]}"; pass a branch, tag or commit`);
  return { baseline: options.baseline, baseRef: options["base-ref"] };
};

const findingIds = (text, source) => {
  let document;
  try {
    document = JSON.parse(text);
  } catch (error) {
    throw new UsageError(`${source} is not valid JSON (${error.message}); regenerate it with zanity check . --baseline <file> --capture-baseline`);
  }
  if (!Array.isArray(document?.findings) || !document.findings.every((finding) => typeof finding?.id === "string")) {
    throw new UsageError(`${source} is not a zanity baseline: it needs a findings array whose entries each have an id`);
  }
  const ids = document.findings.map((finding) => finding.id);
  if (new Set(ids).size !== ids.length) throw new UsageError(`${source} lists the same finding id twice; regenerate it with zanity`);
  assert(ids.length === document.findings.length, `${source}: ${ids.length} ids read for ${document.findings.length} findings, expected one id per finding`);
  assert(ids.every((id) => id.length > 0), `${source}: every id must be non-empty, got ${JSON.stringify(ids.filter((id) => id.length === 0))}`);
  return new Set(ids);
};

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

const readHead = (file) => {
  const resolved = resolve(file);
  const fromCwd = relative(process.cwd(), resolved);
  assert(!isAbsolute(fromCwd) && !fromCwd.startsWith(PARENT_SEGMENT), `${file} resolves to ${resolved}, outside ${process.cwd()}; pass a path inside the repository`);
  assert(!file.includes("\0"), `${file} must not contain a NUL character`);
  try {
    return readFileSync(resolved, "utf8");
  } catch (error) {
    throw new UsageError(`cannot read ${file} (${error.code}); the baseline must exist at HEAD, or be deleted together with the --new-only flag`);
  }
};

const check = ({ baseline, baseRef }) => {
  const head = findingIds(readHead(baseline), baseline);
  const baseText = baselineAtRef(baseRef, baseline);
  if (baseText === undefined) return { code: EXIT_OK, message: `${baseline} is new relative to ${baseRef}: accepted with ${head.size} findings` };
  const base = findingIds(baseText, `${baseline} at ${baseRef}`);
  const added = [...head].filter((id) => !base.has(id));
  assert(added.every((id) => head.has(id) && !base.has(id)), `added ids must be in HEAD and not in ${baseRef}, got ${JSON.stringify(added)}`);
  assert(head.size - added.length <= base.size, `HEAD keeps ${head.size - added.length} ids that ${baseRef} has, but ${baseRef} only has ${base.size}`);
  const problems = [];
  if (head.size > base.size) problems.push(`${baseline} grew from ${base.size} to ${head.size} findings`);
  if (added.length > 0) {
    const shown = added.slice(0, REPORTED_ID_LIMIT).join(", ");
    problems.push(`${baseline} has ${added.length} finding ids that ${baseRef} does not (${shown}${added.length > REPORTED_ID_LIMIT ? ", ..." : ""})`);
  }
  if (problems.length > 0) return { code: EXIT_VIOLATION, message: `${problems.join("; ")}. Hint: ${HOW_TO_FIX}.` };
  return { code: EXIT_OK, message: `${baseline} holds ${head.size} findings, down from or equal to ${base.size} at ${baseRef}: ok` };
};

const main = () => {
  assert(process.argv.length >= 2, `node must pass the script path in argv, got ${JSON.stringify(process.argv)}`);
  try {
    const { code, message } = check(parseArgs(process.argv.slice(2)));
    assert([EXIT_OK, EXIT_VIOLATION].includes(code), `check must return ${EXIT_OK} or ${EXIT_VIOLATION}, got ${code}`);
    (code === EXIT_OK ? console.log : console.error)(message);
    process.exitCode = code;
  } catch (error) {
    if (!(error instanceof UsageError || error instanceof assert.AssertionError)) throw error;
    console.error(error.message);
    process.exitCode = EXIT_USAGE;
  }
};

main();
