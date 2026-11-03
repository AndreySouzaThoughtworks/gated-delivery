#!/usr/bin/env node
// The tracker guardrail scan from plugin/skills/issue-writing/SKILL.md ("Guardrail scan before any write"),
// as a script that always reads the named file. Usage: node <skill base directory>/scripts/guardrail-scan.mjs <file> [--term <regex>]...
// Prints "<file>:<line>: <arm>" per hit (never the matched text, which may be the secret) and exits 1 on any hit.
// Exit 2 on bad usage. Each --term is one more case-insensitive regex arm, like the skill's Extra guardrail term.

import assert from "node:assert";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** @type {[name: string, pattern: string][]} */
export const ARMS = [
  ["credential given a value", String.raw`(password|passwd|pwd|secret|token|api[_-]?key)["']?\s*[:=]\s*\S`],
  ["bearer token", String.raw`bearer [a-z0-9._~+/-]{8,}`],
  ["payment key", String.raw`sk-(live|test)-[a-z0-9]{6,}`],
  ["AWS access key id", "AKIA"],
  ["private key block", "-----BEGIN"],
  ["local user path", "/Users/"],
  ["connection string with user and password", String.raw`[a-z][a-z0-9+.-]*://[^\s/]*:[^\s@]*@`],
  ["mongodb srv host", String.raw`mongodb\+srv`],
  ["internal host", String.raw`\.internal([^a-z0-9-]|$)`],
  ["IP address", String.raw`(^|[^0-9.])([0-9]{1,3}\.){3}[0-9]{1,3}([^0-9.]|$)`],
  ["email address", String.raw`[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}`],
  ["international phone number", String.raw`\+[0-9][0-9 ().-]{8,}`],
  ["national phone number", String.raw`(^|[^0-9])0[0-9]{2,4}[ .-]?[0-9]{6,8}([^0-9]|$)`],
  ["dashed phone number", String.raw`(^|[^0-9.-])[0-9]{3}[-.][0-9]{3}[-.][0-9]{4}([^0-9.-]|$)`],
];
const TERM_FLAG = "--term";
const EXIT_HITS = 1;
const EXIT_USAGE = 2;

/**
 * @param {string} term
 * @returns {RegExp}
 */
const compileTerm = (term) => {
  assert(typeof term === "string" && term.length > 0, `each ${TERM_FLAG} must be a non-empty regex, which would otherwise match every line, got ${JSON.stringify(term)}`);
  let compiled;
  try {
    compiled = new RegExp(term, "i");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new assert.AssertionError({ message: `each ${TERM_FLAG} must be a valid regex, got ${JSON.stringify(term)}; ${detail}` });
  }
  assert(!compiled.test(""), `each ${TERM_FLAG} must not match an empty line, which would flag every line, got ${JSON.stringify(term)}`);
  return compiled;
};

/**
 * @param {string} text
 * @param {string[]} [extraTerms]
 */
export const scanText = (text, extraTerms = []) => {
  assert(typeof text === "string", `the text to scan must be a string, got ${typeof text}`);
  assert(Array.isArray(extraTerms), `extra terms must be a list, got ${typeof extraTerms}`);
  const arms = [
    ...ARMS.map(([name, pattern]) => ({ name, pattern: new RegExp(pattern, "i") })),
    ...extraTerms.map((term) => ({ name: `extra guardrail term ${term}`, pattern: compileTerm(term) })),
  ];
  return text.split("\n").flatMap((line, index) => arms.filter(({ pattern }) => pattern.test(line)).map(({ name }) => ({ line: index + 1, arm: name })));
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [file, ...rest] = process.argv.slice(2);
  const extraTerms = rest.filter((_, i) => rest[i - 1] === TERM_FLAG);
  if (!file || file === TERM_FLAG || rest.length !== extraTerms.length * 2) {
    process.stderr.write(`usage: node <skill base directory>/scripts/guardrail-scan.mjs <file> [${TERM_FLAG} <regex>]...\n`);
    process.exit(EXIT_USAGE);
  }
  const hits = scanText(readFileSync(file, "utf8"), extraTerms);
  for (const { line, arm } of hits) process.stdout.write(`${file}:${line}: ${arm}\n`);
  process.exit(hits.length > 0 ? EXIT_HITS : 0);
}
