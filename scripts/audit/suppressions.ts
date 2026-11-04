#!/usr/bin/env node
import assert from "node:assert";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { ASSERTION_DENSITY_REASON_CODE_MEANINGS } from "./suppression-reason-codes.ts";

const COUNT_FILE = "scripts/audit/suppressions.count";
const PROSE_EXTENSION = ".md";
const NOT_UTF8 = "\uFFFD";
const MIN_REASON_WORDS = 4;
const ASSERTION_DENSITY_RULE = "assertion-density";
const MIN_CODED_DETAIL_WORDS = 3;
const CODED_REASON = /^([a-z-]+):\s*(\S.*)$/;
const WORD_SEPARATOR = /\s+/;
const NON_WORD = /[^a-z0-9]+/;
const REASON_SEPARATOR = /\s--\s+(\S.*)$/;
const COMMENT_CLOSERS = /\s*(?:\*\/|-->)\s*$/;
const REASON_FORMAT = "<marker> -- <reason of at least " + MIN_REASON_WORDS + " distinct meaningful words>";

type Marker = { label: string; pattern: RegExp };
type Suppression = { where: string; label: string; problems: string[] };

const MARKERS: Marker[] = [
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

const EMPTY_REASON_PATTERNS = EMPTY_REASONS.map((phrase) => new RegExp(`(?<![a-z0-9])${phrase.replace(REGEX_SPECIALS, "\\$&")}(?![a-z0-9])`, "g"));

const problemsIn = (line: string, marker: Marker, match: RegExpMatchArray) => { // zanity: ignore[assertion-density] -- no-invariant: line and match come from one regex match on a split source line and every branch only builds a message from captures
  const [markerText, bracket = ""] = match;
  const rules = bracket.split(",").map((rule) => rule.trim()).filter(Boolean);
  const ruleProblem = marker.label === "zanity" && rules.length !== 1
    ? `names ${rules.length} rules in "${markerText}"; name exactly one, such as ignore[rule-name], never a bare ignore`
    : null;
  const found = line.slice((match.index ?? 0) + markerText.length).replace(COMMENT_CLOSERS, "").match(REASON_SEPARATOR);
  const reason = found?.[1] ?? "";
  const coded = reason.match(CODED_REASON);
  const [, code = "", detail = ""] = coded ?? [];
  const needsCode = bracket.trim() === ASSERTION_DENSITY_RULE;
  const codes = Object.keys(ASSERTION_DENSITY_REASON_CODE_MEANINGS).join(", ");
  const withoutEmptyPhrases = EMPTY_REASON_PATTERNS.reduce((text, pattern) => text.replace(pattern, " "), reason.toLowerCase());
  const words = new Set(withoutEmptyPhrases.split(NON_WORD).filter((word) => word.length > 1 && !STOPWORDS.has(word)));
  let reasonProblem: string | null = null;
  if (!found) reasonProblem = `has no reason; write ${REASON_FORMAT}`;
  else if (needsCode && !coded) reasonProblem = `reason "${reason}" must start with a code, a colon and a specific reason, as in "single-invariant: <why>"; codes: ${codes}`;
  else if (needsCode && !Object.hasOwn(ASSERTION_DENSITY_REASON_CODE_MEANINGS, code)) reasonProblem = `reason code "${code}" is unknown; use one of ${codes}`;
  else if (needsCode && detail.split(WORD_SEPARATOR).length < MIN_CODED_DETAIL_WORDS) reasonProblem = `reason after "${code}:" needs at least ${MIN_CODED_DETAIL_WORDS} words saying what is specific to this function, got "${detail}"`;
  else if (words.size < MIN_REASON_WORDS) reasonProblem = `reason "${reason}" has ${words.size} meaningful distinct words; explain why in at least ${MIN_REASON_WORDS}, without filler such as ${EMPTY_REASONS.join(", ")}`;
  return [ruleProblem, reasonProblem].filter((problem): problem is string => problem !== null);
};

const { values } = parseArgs({ options: { repo: { type: "string", default: process.cwd() } } });
const repo = resolve(values.repo);
assert(existsSync(join(repo, ".git")), `${repo} has no .git; expected the root of a git checkout, since tracked files come from git ls-files`);
const listed = execFileSync("git", ["ls-files", "-z"], { cwd: repo, encoding: "utf8" }).split("\0");
const found: Suppression[] = [];
for (const file of listed.filter((name) => name && !name.endsWith(PROSE_EXTENSION) && existsSync(join(repo, name)))) {
  const body = readFileSync(join(repo, file), "utf8");
  if (body.includes(NOT_UTF8)) continue;
  body.split("\n").forEach((line, index) => {
    for (const marker of MARKERS) {
      const match = line.match(marker.pattern);
      if (match) found.push({ where: `${file}:${index + 1}`, label: marker.label, problems: problemsIn(line, marker, match) });
    }
  });
}
const countPath = join(repo, COUNT_FILE);
const countText = existsSync(countPath) ? readFileSync(countPath, "utf8").trim() : null;
const allowed = countText === null ? null : Number.parseInt(countText, 10);
assert(allowed === null || (Number.isInteger(allowed) && allowed >= 0), `${COUNT_FILE} must hold one non-negative integer, got "${countText}"; write the current count`);
const errors = found.flatMap((entry) => entry.problems.map((problem) => `${entry.where}: ${entry.label} suppression ${problem}`));
if (allowed === null) errors.push(`${COUNT_FILE} is missing; create it holding the current count (${found.length})`);
else if (found.length > allowed) errors.push(`${found.length} suppressions exceed the ${allowed} allowed by ${COUNT_FILE}; remove suppressions instead of raising the count`);
else if (found.length < allowed) errors.push(`${found.length} suppressions are below the ${allowed} recorded in ${COUNT_FILE}; lower the file to ${found.length} to lock in the gain`);
if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(`OK: ${found.length} suppressions, all with a reason`);
