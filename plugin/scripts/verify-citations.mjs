#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const EXIT_VERIFIED = 0;
const EXIT_VIOLATIONS = 1;
const EXIT_USAGE = 2;
const STDIN_FD = 0;
const ENCODING = "utf8";
const ONE_BASED_OFFSET = 1;
const PARENT_SEGMENT = "..";
const LINE_BREAK = /\r?\n/;
const TRAILING_LINE_BREAK = /\r?\n$/;
const NOT_FOUND_CODE = "ENOENT";
const POSITIVE_INTEGER = /^[1-9]\d*$/;
const FINDING = /^- (.+?):(\S*) :: (.*)$/;
const NONE_FOUND = /^- none found :: .*$/;
const USAGE = "usage: verify-citations.mjs [--root <dir>] [<scout-output-file>]; reads stdin when no file is given";

/** @typedef {{ path: string, line: string, quote: string }} Finding */

/**
 * @param {string} root
 * @param {string} target
 * @returns {boolean}
 */
export const isInside = (root, target) => {
  assert(isAbsolute(root), `the root must be absolute, got ${root}`);
  assert(isAbsolute(target), `the target must be absolute, got ${target}`);
  const fromRoot = relative(root, target);
  return fromRoot === "" || (fromRoot !== PARENT_SEGMENT && !fromRoot.startsWith(`${PARENT_SEGMENT}${sep}`) && !isAbsolute(fromRoot));
};

/**
 * @param {string} realRoot
 * @param {Finding} finding
 * @returns {string | null}
 */
export const violationFor = (realRoot, { path, line, quote }) => {
  assert(isAbsolute(realRoot), `the root must be absolute, got ${realRoot}`);
  assert(realpathSync(realRoot) === realRoot, `the root must be its own realpath, got ${realRoot}`);
  const target = resolve(realRoot, path);
  if (!isInside(realRoot, target)) return `path "${path}" resolves to ${target}, outside the root ${realRoot}`;
  const cited = quote.trim();
  if (cited === "") return `quote for ${path}:${line} is empty`;
  if (!POSITIVE_INTEGER.test(line)) return `line "${line}" of ${path} is not a positive integer`;
  let real;
  try {
    real = realpathSync(target);
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code !== NOT_FOUND_CODE) throw error;
    return `file ${path} does not exist under ${realRoot}`;
  }
  if (!isInside(realRoot, real)) return `path "${path}" is a symlink to ${real}, outside the root ${realRoot}`;
  if (!statSync(real).isFile()) return `${path} is not a regular file`;
  const lines = readFileSync(real, ENCODING).replace(TRAILING_LINE_BREAK, "").split(LINE_BREAK);
  const lineNumber = Number(line);
  if (lineNumber > lines.length) return `line ${lineNumber} is past the end of ${path}, which has ${lines.length} lines`;
  const actual = lines[lineNumber - ONE_BASED_OFFSET].trim();
  if (actual !== cited) return `quote ${JSON.stringify(cited)} is not line ${lineNumber} of ${path}, which reads ${JSON.stringify(actual)}`;
  return null;
};

/**
 * @param {string} text
 * @param {string} root
 * @returns {string[]}
 */
export const verifyText = (text, root) => {
  assert(typeof text === "string", `the scout output must be text, got ${typeof text}`);
  assert(existsSync(root) && statSync(root).isDirectory(), `the root must be an existing directory, got ${root}`);
  const realRoot = realpathSync(root);
  const violations = [];
  for (const [index, input] of text.replace(TRAILING_LINE_BREAK, "").split(LINE_BREAK).entries()) {
    if (NONE_FOUND.test(input)) continue;
    const found = input.match(FINDING);
    const reason = found ? violationFor(realRoot, { path: found[1], line: found[2], quote: found[3] }) : `not a finding line, got ${JSON.stringify(input)}`;
    if (reason !== null) violations.push(`${index + ONE_BASED_OFFSET}: ${reason}`);
  }
  return violations;
};

/**
 * @param {string[]} argv
 * @returns {number}
 */
const main = (argv) => {
  try {
    const { values, positionals } = parseArgs({ args: argv, options: { root: { type: "string" } }, allowPositionals: true });
    assert(positionals.length <= 1, `expected at most one input file, got ${positionals.length}`);
    assert(values.root !== "", `--root needs a directory, got ${JSON.stringify(values.root)}`);
    const violations = verifyText(readFileSync(positionals[0] ?? STDIN_FD, ENCODING), values.root ?? process.cwd());
    for (const violation of violations) console.log(violation);
    return violations.length === 0 ? EXIT_VERIFIED : EXIT_VIOLATIONS;
  } catch (error) {
    console.error(`verify-citations: ${error instanceof Error ? error.message : String(error)}\n${USAGE}`);
    return EXIT_USAGE;
  }
};

const entryPoint = process.argv[1];
if (entryPoint !== undefined && import.meta.url === pathToFileURL(realpathSync(entryPoint)).href) process.exitCode = main(process.argv.slice(2));
