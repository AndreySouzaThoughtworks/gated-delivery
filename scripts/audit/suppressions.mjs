#!/usr/bin/env node
import assert from "node:assert";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

const COUNT_FILE = "scripts/audit/suppressions.count";
const PROSE_EXTENSION = ".md";
const NOT_UTF8 = "\uFFFD";
const MIN_REASON_WORDS = 4;
const REASON_SEPARATOR = /\s--\s+(\S.*)$/;
const COMMENT_CLOSERS = /\s*(?:\*\/|-->)\s*$/;
const REASON_FORMAT = "<marker> -- <reason of at least " + MIN_REASON_WORDS + " distinct meaningful words>";

const MARKERS = [
  { label: "zanity", pattern: /\bzanity:\s*ignore(?:\[([^\]]*)\])?/ },
  { label: "eslint", pattern: /\beslint-disable(?:-next-line|-line)?\b/ },
  { label: "flake8", pattern: /\bnoqa\b/ },
  { label: "mypy", pattern: /\btype:\s*ignore\b/ },
  { label: "typescript", pattern: /@ts-(?:ignore|expect-error|nocheck)\b/ },
  { label: "semgrep", pattern: /\bnosemgrep\b/ },
  { label: "coverage", pattern: /\b(?:istanbul|c8|v8) ignore\b/ },
  { label: "shellcheck", pattern: /\bshellcheck\s+disable\b/ },
];

const EMPTY_REASONS = ["false positive", "n/a", "todo", "legacy", "temporary", "fix later", "wontfix", "noise", "ok"];

const STOPWORDS = new Set(
  "a an and are as at be because but by for from has have in is it its of on or so that the this to was we with would".split(" "),
);

const REGEX_SPECIALS = /[.*+?^${}()|[\]\\/]/g;

const boundedPhrase = (phrase) => {
  assert(phrase.length > 0, `an empty phrase would match everywhere, got length ${phrase.length}; list real phrases`);
  const bounded = new RegExp(`(?<![a-z0-9])${phrase.replace(REGEX_SPECIALS, "\\$&")}(?![a-z0-9])`, "g");
  assert(bounded.test(phrase), `the pattern for "${phrase}" must match the phrase itself, got ${bounded}`);
  bounded.lastIndex = 0;
  return bounded;
};

const meaningfulWords = (reason) => { // zanity: ignore[assertion-density] -- reason is a regex capture that reasonProblem already proved non-blank text and the result is a set built by one filter
  const withoutEmptyPhrases = EMPTY_REASONS.reduce((text, phrase) => text.replace(boundedPhrase(phrase), " "), reason.toLowerCase());
  const words = (withoutEmptyPhrases.match(/[a-z0-9]+/g) ?? []).filter((word) => word.length > 1 && !STOPWORDS.has(word));
  return new Set(words);
};

const reasonProblem = (rest) => {
  assert(typeof rest === "string", `the text after a marker must be a string, got ${typeof rest}`);
  const found = rest.replace(COMMENT_CLOSERS, "").match(REASON_SEPARATOR);
  if (!found) return `has no reason; write ${REASON_FORMAT}`;
  const words = meaningfulWords(found[1]);
  assert(found[1].length > 0, `the reason after "--" must not be empty, got "${found[1]}"; write why it is safe`);
  if (words.size < MIN_REASON_WORDS) {
    return `reason "${found[1]}" has ${words.size} meaningful distinct words; explain why in at least ${MIN_REASON_WORDS}, without filler such as ${EMPTY_REASONS.join(", ")}`;
  }
  return null;
};

const ruleProblem = (label, bracket, markerText) => {
  assert(typeof label === "string" && label.length > 0, `a marker needs a label, got "${label}"`);
  assert(typeof markerText === "string", `the marker text must be a string, got ${typeof markerText}`);
  if (label !== "zanity") return null;
  const rules = (bracket ?? "").split(",").map((rule) => rule.trim()).filter(Boolean);
  if (rules.length === 1) return null;
  return `names ${rules.length} rules in "${markerText}"; name exactly one, such as ignore[rule-name], never a bare ignore`;
};

const problemsIn = (line, marker, match) => { // zanity: ignore[assertion-density] -- line and match come from String.match on a split line in findSuppressions and the result merges two checks that assert for themselves
  const rest = line.slice(match.index + match[0].length);
  return [ruleProblem(marker.label, match[1], match[0]), reasonProblem(rest)].filter(Boolean);
};

const trackedFiles = (repo) => {
  assert(existsSync(repo), `${repo} must exist, got none; pass --repo <directory>`);
  const listed = execFileSync("git", ["ls-files", "-z"], { cwd: repo, encoding: "utf8" }).split("\0");
  const files = listed.filter((file) => file && !file.endsWith(PROSE_EXTENSION) && existsSync(join(repo, file)));
  assert(files.every((file) => !file.startsWith("/")), `git lists repo-relative paths, got ${files.find((file) => file.startsWith("/"))}`);
  return files;
};

const findSuppressions = (repo) => {
  assert(typeof repo === "string", `repo must be a directory path, got ${typeof repo}`);
  const found = [];
  for (const file of trackedFiles(repo)) {
    const body = readFileSync(join(repo, file), "utf8");
    if (body.includes(NOT_UTF8)) continue;
    body.split("\n").forEach((line, index) => {
      for (const marker of MARKERS) {
        const match = line.match(marker.pattern);
        if (match) found.push({ where: `${file}:${index + 1}`, label: marker.label, problems: problemsIn(line, marker, match) });
      }
    });
  }
  assert(found.every((entry) => Array.isArray(entry.problems)), "every finding carries a problems list, got a finding without one");
  return found;
};

const allowedCount = (repo) => {
  const path = join(repo, COUNT_FILE);
  assert(typeof repo === "string", `repo must be a directory path, got ${typeof repo}`);
  if (!existsSync(path)) return null;
  const allowed = Number.parseInt(readFileSync(path, "utf8").trim(), 10);
  assert(Number.isInteger(allowed) && allowed >= 0, `${COUNT_FILE} must hold one non-negative integer, got "${readFileSync(path, "utf8").trim()}"; write the current count`);
  return allowed;
};

const { values } = parseArgs({ options: { repo: { type: "string", default: process.cwd() } } });
const repo = resolve(values.repo);
const found = findSuppressions(repo);
const allowed = allowedCount(repo);
const errors = found.flatMap((entry) => entry.problems.map((problem) => `${entry.where}: ${entry.label} suppression ${problem}`));
if (allowed === null) errors.push(`${COUNT_FILE} is missing; create it holding the current count (${found.length})`);
else if (found.length > allowed) errors.push(`${found.length} suppressions exceed the ${allowed} allowed by ${COUNT_FILE}; remove suppressions instead of raising the count`);
else if (found.length < allowed) errors.push(`${found.length} suppressions are below the ${allowed} recorded in ${COUNT_FILE}; lower the file to ${found.length} to lock in the gain`);
if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(`OK: ${found.length} suppressions, all with a reason`);
