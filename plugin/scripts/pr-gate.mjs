#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { basename, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const EXIT_CLEAN = 0;
const EXIT_HITS = 1;
const EXIT_USAGE = 2;
const ENCODING = "utf8";
const JSON_INDENT = 2;
const THREAD_PAGE_SIZE = 100;
const FINAL_SLICE = "y";
const NOT_FINAL_SLICE = "n";
const BODY_FILE_PREFIX = "pr-body-";
const BODY_FILE_SUFFIX = ".md";
const POSITIVE_INTEGER = /^[1-9]\d*$/;
const ISSUE_REFERENCE = String.raw`(?:[\w.-]+/[\w.-]+)?#\d+|[A-Za-z][A-Za-z0-9]*-\d+|https?://\S+/issues/\d+`;
const CLOSING_KEYWORD = new RegExp(String.raw`\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?):?\s+(?:${ISSUE_REFERENCE})`, "gi");
export const DEFAULT_TITLE_CONVENTION = String.raw`^(?:feat|fix|docs|chore|test|refactor|build|ci|perf|style|revert)(?:\([^)]+\))?!?: \S`;
const THREADS_QUERY = `query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      reviewThreads(first: ${THREAD_PAGE_SIZE}) {
        pageInfo { hasNextPage }
        nodes { isResolved comments(first: 1) { nodes { url path } } }
      }
    }
  }
}`;
const USAGE = `usage: pr-gate.mjs --body-file <path> --title <text> --final-slice ${FINAL_SLICE}|${NOT_FINAL_SLICE} [--pr <number>] [--title-convention <regex>]`;

/**
 * @typedef {{ url: string | undefined, path: string | undefined }} UnresolvedThread
 * @typedef {{ title: string | null, closingKeywords: string[], unresolvedThreads: UnresolvedThread[], bodyPath: string | null }} GateResult
 */

/**
 * @param {number} pr
 * @returns {UnresolvedThread[]}
 */
export const listUnresolvedThreads = (pr) => {
  assert(Number.isInteger(pr) && pr > 0, `the pull request number "${pr}" must be a positive integer; pass the number from the pull request URL.`);
  const reply = execFileSync("gh", ["api", "graphql", "-F", "owner={owner}", "-F", "repo={repo}", "-F", `number=${pr}`, "-f", `query=${THREADS_QUERY}`], { encoding: ENCODING });
  const threads = JSON.parse(reply)?.data?.repository?.pullRequest?.reviewThreads;
  assert(Array.isArray(threads?.nodes), `the GraphQL reply for pull request "${pr}" has no \`reviewThreads.nodes\`; run \`gh auth status\`, then rerun.`);
  assert(threads.pageInfo?.hasNextPage !== true, `pull request "${pr}" has more than ${THREAD_PAGE_SIZE} review threads, and the gate reads one page; resolve threads below ${THREAD_PAGE_SIZE}, then rerun.`);
  return threads.nodes
    .filter((/** @type {{ isResolved: boolean }} */ thread) => !thread.isResolved)
    .map((/** @type {{ comments: { nodes: UnresolvedThread[] } }} */ thread) => ({ url: thread.comments.nodes[0]?.url, path: thread.comments.nodes[0]?.path }));
};

/**
 * @param {{ body: string, bodyPath: string, title: string, finalSlice: string, titleConvention: string, threads: UnresolvedThread[] }} input
 * @returns {GateResult}
 */
export const gate = ({ body, bodyPath, title, finalSlice, titleConvention, threads }) => {
  assert([FINAL_SLICE, NOT_FINAL_SLICE].includes(finalSlice), `\`--final-slice\` must be ${FINAL_SLICE} or ${NOT_FINAL_SLICE}, got ${JSON.stringify(finalSlice)}; pass ${FINAL_SLICE} for the final slice and ${NOT_FINAL_SLICE} otherwise.`);
  assert(titleConvention !== "" && !new RegExp(titleConvention).test(""), `the title convention must be a regex that does not match an empty title, got ${JSON.stringify(titleConvention)}; pass a stricter \`--title-convention\`.`);
  const swallowedDirectory = basename(dirname(bodyPath)).startsWith(BODY_FILE_PREFIX);
  const named = basename(bodyPath).startsWith(BODY_FILE_PREFIX) && basename(bodyPath).endsWith(BODY_FILE_SUFFIX);
  return {
    title: new RegExp(titleConvention).test(title) ? null : `title ${JSON.stringify(title)} does not match ${titleConvention}; reword it to match.`,
    closingKeywords: finalSlice === FINAL_SLICE ? [] : [...body.matchAll(CLOSING_KEYWORD)].map(([hit]) => hit),
    unresolvedThreads: threads,
    bodyPath: named && !swallowedDirectory ? null : `${bodyPath} must be ${BODY_FILE_PREFIX}<branch>${BODY_FILE_SUFFIX} directly in the notes directory; rename it, with every / in the branch name replaced by -.`,
  };
};

/**
 * @param {string[]} argv
 * @returns {number}
 */
const main = (argv) => {
  try {
    const { values } = parseArgs({
      args: argv,
      options: { "body-file": { type: "string" }, title: { type: "string" }, "final-slice": { type: "string" }, pr: { type: "string" }, "title-convention": { type: "string" } },
    });
    assert(values["body-file"] && values.title !== undefined && values["final-slice"], `\`--body-file\`, \`--title\` and \`--final-slice\` must be given, got ${JSON.stringify(values)}; pass all three.`);
    assert(values.pr === undefined || POSITIVE_INTEGER.test(values.pr), `\`--pr\` must be a positive integer, got ${JSON.stringify(values.pr)}; pass the number from the pull request URL.`);
    const result = gate({
      body: readFileSync(values["body-file"], ENCODING),
      bodyPath: values["body-file"],
      title: values.title,
      finalSlice: values["final-slice"],
      titleConvention: values["title-convention"] ?? DEFAULT_TITLE_CONVENTION,
      threads: values.pr === undefined ? [] : listUnresolvedThreads(Number(values.pr)),
    });
    console.log(JSON.stringify(result, null, JSON_INDENT));
    const hit = result.title !== null || result.closingKeywords.length > 0 || result.unresolvedThreads.length > 0 || result.bodyPath !== null;
    return hit ? EXIT_HITS : EXIT_CLEAN;
  } catch (error) {
    console.error(`pr-gate: ${error instanceof Error ? error.message : String(error)}\n${USAGE}`);
    return EXIT_USAGE;
  }
};

const entryPoint = process.argv[1];
if (entryPoint !== undefined && import.meta.url === pathToFileURL(realpathSync(entryPoint)).href) process.exitCode = main(process.argv.slice(2));
