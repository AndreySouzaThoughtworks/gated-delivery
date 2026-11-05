#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { CROSS_REPO_TAG, parseSpec } from "../skills/spec/scripts/spec-lint.mjs";

const EXIT_OK = 0;
const EXIT_PROBLEMS = 1;
const EXIT_USAGE = 2;
const ENCODING = "utf8";
const POSITIVE_INTEGER = /^[1-9]\d*$/;
const AC_LIST_SEPARATOR = ",";
const UNRESOLVED_DECISION = /^- \*\*Options:\*\*|needs user input/m;
const FILE_BULLET = /^- `([^`\s]+)`(.*)$/;
const LINE_SUFFIX = /:\d+(?:-\d+)?$/;
const GLOB_CHARACTER = /[*?[\]{}]/;
const ADDED_FILE_WORDING = /\b(?:new|adds?|added|creates?|created)\b/i;
const USAGE = "usage: executor-preflight.mjs --spec <path> --slice <n> [--acs <n,n,...>] [--worktree <dir>]";

const RULE_UNRESOLVED_DECISION = "unresolved-open-decision";
const RULE_EMPTY_ACCEPTANCE_CRITERIA = "empty-acceptance-criteria";
const RULE_MISSING_RELEVANT_FILE = "missing-relevant-file";
const RULE_SLICE_NOT_FOUND = "slice-not-found";
const RULE_AC_OUTSIDE_SLICE = "ac-outside-slice";
const RULE_NOT_A_WORKTREE = "worktree-not-a-git-worktree";
const RULE_DIRTY_WORKTREE = "worktree-dirty";

/** @typedef {{ rule: string, detail: string }} Problem */

/**
 * @param {string} directory
 * @returns {Problem[]}
 */
export const worktreeProblems = (directory) => { // zanity: ignore[assertion-density] -- single-invariant: the path check is the only input precondition, and git decides everything else
  assert(typeof directory === "string" && directory !== "", `the worktree must be a directory path, got ${JSON.stringify(directory)}`);
  const inside = spawnSync("git", ["-C", directory, "rev-parse", "--is-inside-work-tree"], { encoding: ENCODING });
  if (inside.status !== 0 || inside.stdout.trim() !== "true") return [{ rule: RULE_NOT_A_WORKTREE, detail: `${directory} is not a git worktree` }];
  const changes = spawnSync("git", ["-C", directory, "status", "--porcelain"], { encoding: ENCODING });
  return changes.stdout.trim() === "" ? [] : [{ rule: RULE_DIRTY_WORKTREE, detail: `${directory} has uncommitted changes` }];
};

/**
 * @param {string} section
 * @param {string} base
 * @returns {Problem[]}
 */
export const missingFileProblems = (section, base) => {
  assert(typeof section === "string", `the Relevant files section must be text, got ${typeof section}`);
  assert(isAbsolute(base), `the base directory must be absolute, got ${JSON.stringify(base)}`);
  /** @type {Problem[]} */
  const problems = [];
  for (const line of section.split("\n")) {
    const bullet = line.match(FILE_BULLET);
    if (!bullet) continue;
    const path = bullet[1].replace(LINE_SUFFIX, "");
    const listed = existsSync(resolve(base, path)) || GLOB_CHARACTER.test(path) || ADDED_FILE_WORDING.test(bullet[2]);
    if (!listed) problems.push({ rule: RULE_MISSING_RELEVANT_FILE, detail: `${path} is listed under Relevant files but does not exist under ${base}` });
  }
  return problems;
};

/**
 * @param {string} raw
 * @param {{ slice: number, acs?: number[], base: string }} request
 * @returns {{ problems: Problem[], skip: number[] }}
 */
export const specProblems = (raw, { slice, acs, base }) => { // zanity: ignore[assertion-density] -- single-invariant: the slice-number check is the only input precondition, and parseSpec asserts the text type
  assert(Number.isInteger(slice) && slice > 0, `the slice must be a positive integer, got ${slice}`);
  const spec = parseSpec(raw);
  /** @type {Problem[]} */
  const problems = [];
  if (UNRESOLVED_DECISION.test(spec.bodies["Open decisions"] ?? "")) problems.push({ rule: RULE_UNRESOLVED_DECISION, detail: "Open decisions still holds an unresolved entry" });
  if (spec.criteria.length === 0) problems.push({ rule: RULE_EMPTY_ACCEPTANCE_CRITERIA, detail: "the Acceptance criteria section holds no criterion" });
  problems.push(...missingFileProblems(spec.bodies["Relevant files"] ?? "", base));
  const target = spec.slices.find((candidate) => candidate.number === slice);
  if (!target) problems.push({ rule: RULE_SLICE_NOT_FOUND, detail: `Rollout has no Slice ${slice}` });
  const skip = [];
  for (const id of acs ?? target?.acs ?? []) {
    if (spec.criteria.some((criterion) => criterion.id === id && criterion.tag === CROSS_REPO_TAG)) skip.push(id);
    else if (target && !target.acs.includes(id)) problems.push({ rule: RULE_AC_OUTSIDE_SLICE, detail: `AC[${id}] is not assigned to Slice ${slice}, which holds ${target.acs.join(", ")}` });
  }
  return { problems, skip };
};

/**
 * @param {string[]} argv
 * @returns {number}
 */
const main = (argv) => {
  try {
    const { values } = parseArgs({ args: argv, options: { spec: { type: "string" }, slice: { type: "string" }, acs: { type: "string" }, worktree: { type: "string" } } });
    assert(values.spec && POSITIVE_INTEGER.test(values.slice ?? ""), `--spec and a positive --slice are required, got ${JSON.stringify(values.spec)} and ${JSON.stringify(values.slice)}`);
    const acs = values.acs?.split(AC_LIST_SEPARATOR).map((id) => (POSITIVE_INTEGER.test(id.trim()) ? Number(id) : Number.NaN));
    assert(acs === undefined || acs.every(Number.isInteger), `--acs must be a comma-separated list of positive integers, got ${JSON.stringify(values.acs)}`);
    const found = specProblems(readFileSync(values.spec, ENCODING), { slice: Number(values.slice), acs, base: resolve(values.worktree ?? process.cwd()) });
    const problems = [...found.problems, ...(values.worktree === undefined ? [] : worktreeProblems(values.worktree))];
    console.log(JSON.stringify({ ok: problems.length === 0, problems, skip: found.skip }));
    return problems.length === 0 ? EXIT_OK : EXIT_PROBLEMS;
  } catch (error) {
    console.error(`executor-preflight: ${error instanceof Error ? error.message : String(error)}\n${USAGE}`);
    return EXIT_USAGE;
  }
};

const entryPoint = process.argv[1];
if (entryPoint !== undefined && import.meta.url === pathToFileURL(realpathSync(entryPoint)).href) process.exitCode = main(process.argv.slice(2));
