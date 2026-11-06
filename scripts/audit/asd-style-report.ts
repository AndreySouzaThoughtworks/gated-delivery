#!/usr/bin/env node
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { MAX_SENTENCE_WORDS, MIN_SHORT_SENTENCE_PERCENT, asdStyleProblems, shareOf, styleDocuments } from "./asd-style.ts";

const EXIT_PROBLEMS = 1;
const PERCENT_COLUMN_WIDTH = 3;

const { values } = parseArgs({ options: { repo: { type: "string", default: process.cwd() } } });
const documents = styleDocuments(resolve(values.repo));

for (const document of documents) {
  const { file, short, total, percent } = shareOf(document);
  console.log(`${String(percent).padStart(PERCENT_COLUMN_WIDTH)}%  ${short}/${total} sentences within ${MAX_SENTENCE_WORDS} words  ${file}`);
}
const problems = asdStyleProblems(documents);
for (const problem of problems) console.error(problem);
console.log(`${problems.length === 0 ? "every" : "not every"} document reaches ${MIN_SHORT_SENTENCE_PERCENT}%`);
process.exitCode = problems.length === 0 ? 0 : EXIT_PROBLEMS;
