#!/usr/bin/env node
// The tracker guardrail scan from plugin/skills/issue-writing/SKILL.md ("Guardrail scan before any write"),
// as a script that always reads the named file. Usage: node scripts/audit/guardrail-scan.mjs <file> [--term <regex>]...
// Prints "<file>:<line>: <arm>" per hit (never the matched text, which may be the secret) and exits 1 on any hit.
// Exit 2 on bad usage. Each --term is one more case-insensitive regex arm, like the skill's Extra guardrail term.

import assert from "node:assert";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

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

export const scanText = (text, extraTerms = []) => {
  const arms = [...ARMS, ...extraTerms.map((term) => [`extra guardrail term ${term}`, term])].map(([name, pattern]) => [name, new RegExp(pattern, "i")]);
  const hits = text.split("\n").flatMap((line, index) => arms.filter(([, pattern]) => pattern.test(line)).map(([name]) => ({ line: index + 1, arm: name })));
  assert(arms.length === ARMS.length + extraTerms.length, `every extra term must add exactly one arm, got ${arms.length} arms for ${ARMS.length} built-in and ${extraTerms.length} extra`);
  assert(hits.every((hit) => hit.line >= 1 && hit.line <= text.split("\n").length), `every hit must name a line inside the ${text.split("\n").length}-line text, got ${JSON.stringify(hits.find((hit) => hit.line < 1))}`);
  return hits;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [file, ...rest] = process.argv.slice(2);
  const extraTerms = rest.filter((_, i) => rest[i - 1] === TERM_FLAG);
  if (!file || file === TERM_FLAG || rest.length !== extraTerms.length * 2) {
    process.stderr.write(`usage: node scripts/audit/guardrail-scan.mjs <file> [${TERM_FLAG} <regex>]...\n`);
    process.exit(EXIT_USAGE);
  }
  const hits = scanText(readFileSync(file, "utf8"), extraTerms);
  for (const { line, arm } of hits) process.stdout.write(`${file}:${line}: ${arm}\n`);
  process.exit(hits.length > 0 ? EXIT_HITS : 0);
}
