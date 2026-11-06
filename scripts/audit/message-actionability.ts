#!/usr/bin/env node
import assert from "node:assert";
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { BASE_REF_ENV } from "../eval/changed-skills.ts";
import { BASELINE_FILE, baselineText, countMessages, findingsOf } from "./message-actionability/baseline.ts";
import { baselineProblems, scannedSources } from "./message-actionability/check.ts";

const EXIT_PROBLEMS = 1;

const { values } = parseArgs({ options: { repo: { type: "string", default: process.cwd() }, "update-baseline": { type: "boolean" } } });
const root = resolve(values.repo);
const sources = scannedSources(root);
assert(sources.length > 0, `${root} holds no scanned source file; pass --repo with the repository root.`);
const findings = findingsOf(sources);
const summary = `${findings.length} of ${countMessages(sources)} failure messages are not actionable`;

if (values["update-baseline"]) {
  writeFileSync(join(root, BASELINE_FILE), baselineText(findings));
  console.log(`wrote ${BASELINE_FILE}: ${summary}`);
} else {
  const problems = baselineProblems(root, process.env[BASE_REF_ENV] || null);
  for (const problem of problems) console.error(problem);
  console.log(`${summary}; ${BASELINE_FILE} ${problems.length === 0 ? "matches them" : "does not match them"}`);
  process.exitCode = problems.length === 0 ? 0 : EXIT_PROBLEMS;
}
