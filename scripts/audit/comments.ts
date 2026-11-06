#!/usr/bin/env node
import assert from "node:assert";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const SCANNED_DIRECTORIES = ["plugin/", "scripts/", "tests/"];
const SCANNED_EXTENSIONS = [".ts", ".mjs", ".js", ".cjs"];
const FIXTURE_SEGMENT = "/fixtures/";
const EXIT_OFFENCE = 1;
const SNIPPET_LENGTH = 90;
const LINE_COMMENT_OPENER_LENGTH = 2;
const BLOCK_COMMENT_DELIMITER_LENGTH = 2;
const JSDOC_OPENER = "/**";
const NUL = "\0";
const REGEX_MAY_FOLLOW = "(,=:[!&|?{};+-*%<>~^";
const KEYWORD_BEFORE_REGEX = /(?:^|[^\w$])(?:return|typeof|case|in|of|delete|void|throw|new|else|do)$/;
const KEYWORD_LOOKBEHIND_WINDOW = 10;
const TOKEN = /(?<line>\/\/[^\n]*)|(?<block>\/\*[\s\S]*?(?:\*\/|$))|(?<string>'(?:\\[\s\S]|[^'\\\n])*'?|"(?:\\[\s\S]|[^"\\\n])*"?)|(?<template>`)|(?<open>\{)|(?<close>\})|(?<slash>\/)|(?<other>[^/'"`{}]+)/y;
const REGEX_LITERAL = /\/(?:\\.|\[(?:\\.|[^\]\\\n])*\]|[^/\\[\n])+\/[a-z]*/y;
const TEMPLATE_TOKEN = /(?<end>`)|(?<expression>\$\{)|(?<text>(?:\\[\s\S]|[^`\\$]|\$(?!\{)|\\$)+)/y;
const BLOCK_LINE_BREAK = /\s*\n\s*\*?\s*/g;
const OFFENCE_LOCATION = /^.+:\d+$/;
const HASH_AND_LETTER_SHA = "(?=[0-9a-f]*\\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}";
const CHANGE_VERBS = "moved|removed|renamed|added|changed|replaced|dropped|extracted|split|merged|introduced|fixed|deleted|rewritten|converted|deprecated|reverted|tightened|hardened|narrowed|widened";
const PRESENT_TENSE_CHANGE_VERBS = "link|use|read|check|return|run|call|accept|reject|handle|treat|carry|name|state|catch|report|skip|scan";
const COMMENT_FORMAT = "a comment states a constraint the code cannot show, in the present tense";

type Comment = { line: number; text: string; index: number };
type ScanContext = { template: boolean; depth: number };
type ScanState = { contexts: ScanContext[]; comments: Comment[] };
type HistoryRule = { name: string; pattern: RegExp; hint: string };
type Offence = { where: string; rule: string; snippet: string; hint: string };

export const HISTORY_RULES: HistoryRule[] = [
  {
    name: "temporal-contrast",
    pattern: new RegExp(
      "\\b(?:until now|same as before|as before|no longer|previously|formerly|anymore|any more|originally|at first|back then|long after|stopped using|started using|kept (?:advertising|firing|using|reading))\\b|(?<!\\b(?:is|are|be|being|been|was|were|get|gets|getting)\\s)\\bused to\\b",
      "i",
    ),
    hint: `delete the before-and-after contrast, or restate what the code does now; ${COMMENT_FORMAT}`,
  },
  {
    name: "change-narration",
    pattern: new RegExp(
      `\\b(?:was|were|has been|have been|had been|got) (?:\\w+ly )?(?:${CHANGE_VERBS})\\b|\\b(?:we|i) (?:${CHANGE_VERBS}|rewrote|switched)\\b|\\b(?:the )?(?:old|previous|former|earlier|prior) (?:behaviou?r|version|implementation|code|name|form|approach|way|check|logic)\\b|\\bnow (?:${PRESENT_TENSE_CHANGE_VERBS})s?\\b|\\bnewly (?:added|introduced)\\b`,
      "i",
    ),
    hint: `describe the code as it is, not the edit that made it so; ${COMMENT_FORMAT}`,
  },
  {
    name: "bug-history",
    pattern: /\bregression:|\b(?:fixes|fixed|fixing) (?:a |the )?(?:bug|defect|issue|crash|leak)\b|\bbug fix\b|\bsurvived (?:\w+ )?review/i,
    hint: `name the case in the test title and delete the account of the defect; ${COMMENT_FORMAT}`,
  },
  {
    name: "tracker-reference",
    pattern: new RegExp(`(?:^|[\\s(\\[])#\\d{1,6}\\b|\\b(?:PR|pull request|issue|ticket)s? ?#?\\d+\\b|\\bcommit ${HASH_AND_LETTER_SHA}\\b|\\b${HASH_AND_LETTER_SHA}\\b`, "i"),
    hint: "move the PR, issue or commit reference to the commit message; a comment holds no pointer into history",
  },
  {
    name: "dated-note",
    pattern: /\b\d{4}-\d{2}-\d{2}\b|\b(?:since|as of|from) (?:v|version )?\d+\.\d+|\b(?:last|this) (?:week|month|sprint|release|quarter|year)\b|\b(?:yesterday|recently)\b/i,
    hint: "remove the date or release mark; the commit date already records it",
  },
];

export const regexMayStartAt = (source: string, index: number) => {
  assert(Number.isInteger(index) && index >= 0, `the slash index must be a whole number from 0, got ${index}`);
  assert(source[index] === "/", `a regex literal starts at a slash, got ${JSON.stringify(source[index])} at index ${index}`);
  const before = source.slice(0, index).trimEnd();
  return before === "" || REGEX_MAY_FOLLOW.includes(before.at(-1) as string) || KEYWORD_BEFORE_REGEX.test(before.slice(-KEYWORD_LOOKBEHIND_WINDOW));
};

export const stepTemplate = (source: string, index: number, state: ScanState) => {
  assert(Number.isInteger(index) && index >= 0, `a step starts at a whole index from 0, got ${index}`);
  assert(index < source.length, `a step reads a character inside the ${source.length} of the source, got index ${index}`);
  TEMPLATE_TOKEN.lastIndex = index;
  const groups = (TEMPLATE_TOKEN.exec(source) as RegExpExecArray).groups as Record<string, string | undefined>;
  if (groups.end !== undefined) state.contexts.pop();
  if (groups.expression !== undefined) state.contexts.push({ template: false, depth: 0 });
  return (groups.end ?? groups.expression ?? (groups.text as string)).length;
};

export const stepCode = (source: string, index: number, state: ScanState) => {
  assert(Number.isInteger(index) && index >= 0, `a step starts at a whole index from 0, got ${index}`);
  assert(index < source.length, `a step reads a character inside the ${source.length} of the source, got index ${index}`);
  const context = state.contexts.at(-1) as ScanContext;
  TOKEN.lastIndex = index;
  const groups = (TOKEN.exec(source) as RegExpExecArray).groups as Record<string, string | undefined>;
  const [kind, token] = Object.entries(groups).find(([, value]) => value !== undefined) as [string, string];
  if (kind === "line") state.comments.push({ line: 0, index, text: token.slice(LINE_COMMENT_OPENER_LENGTH).trim() });
  if (kind === "block" && !token.startsWith(JSDOC_OPENER)) {
    state.comments.push({ line: 0, index, text: token.slice(BLOCK_COMMENT_DELIMITER_LENGTH, -BLOCK_COMMENT_DELIMITER_LENGTH).replace(BLOCK_LINE_BREAK, " ").trim() });
  }
  if (kind === "template") state.contexts.push({ template: true, depth: 0 });
  if (kind === "open") context.depth++;
  if (kind === "close" && context.depth === 0 && state.contexts.length > 1) state.contexts.pop();
  else if (kind === "close") context.depth--;
  REGEX_LITERAL.lastIndex = index;
  const regexLength = kind === "slash" && regexMayStartAt(source, index) ? REGEX_LITERAL.exec(source)?.[0].length : undefined;
  return regexLength ?? token.length;
};

export const commentsIn = (source: string) => {
  assert(typeof source === "string", `the source must be text, got ${typeof source}`);
  assert(!source.includes(NUL), `the source must be text, got a NUL byte at index ${source.indexOf(NUL)}`);
  const state: ScanState = { contexts: [{ template: false, depth: 0 }], comments: [] };
  let index = 0;
  while (index < source.length) index += (state.contexts.at(-1)?.template ? stepTemplate : stepCode)(source, index, state);
  return state.comments.map((comment) => ({ ...comment, line: source.slice(0, comment.index).split("\n").length }));
};

export const runsOfComments = (comments: Comment[]) => {
  assert(Array.isArray(comments), `the comments must be a list, got ${typeof comments}`);
  assert(comments.every((comment, position) => position === 0 || comment.line >= comments[position - 1].line), `the comments must arrive in line order, got lines ${comments.map((comment) => comment.line).join(", ")}`);
  const runs: Comment[][] = [];
  for (const comment of comments) {
    const run = runs.at(-1);
    if (run && comment.line === (run.at(-1) as Comment).line + 1) run.push(comment);
    else runs.push([comment]);
  }
  return runs;
};

export const historyOffences = (file: string, source: string) => {
  assert(file !== "", `an offence names its file, got ${JSON.stringify(file)}`);
  assert(!file.includes("\n"), `a file name must fit one report line, got ${JSON.stringify(file)}`);
  const offences: Offence[] = [];
  for (const run of runsOfComments(commentsIn(source))) {
    const text = run.map((comment) => comment.text).join(" ");
    for (const rule of HISTORY_RULES) {
      const found = rule.pattern.exec(text);
      if (!found) continue;
      const lineStarts = run.map((_, position) => run.slice(0, position).reduce((length, comment) => length + comment.text.length + 1, 0));
      const position = lineStarts.filter((start) => start <= found.index).length - 1;
      offences.push({ where: `${file}:${run[position].line}`, rule: rule.name, snippet: text.slice(found.index, found.index + SNIPPET_LENGTH).trim(), hint: rule.hint });
    }
  }
  return offences;
};

export const scannedFiles = (repo: string) => {
  assert(existsSync(repo), `${repo} must exist, got none; pass --repo <directory>`);
  assert(existsSync(join(repo, ".git")), `${repo} has no .git; pass --repo <root of a git checkout>, since tracked files come from git ls-files`);
  const listed = execFileSync("git", ["ls-files", "-z", ...SCANNED_DIRECTORIES], { cwd: repo, encoding: "utf8" }).split("\0");
  return listed.filter((file) => SCANNED_EXTENSIONS.some((extension) => file.endsWith(extension)) && !file.includes(FIXTURE_SEGMENT) && existsSync(join(repo, file)));
};

export const formatOffence = (offence: Offence) => {
  assert(OFFENCE_LOCATION.test(offence.where), `an offence location reads <file>:<line>, got ${JSON.stringify(offence.where)}`);
  assert(HISTORY_RULES.some((rule) => rule.name === offence.rule), `an offence names one of ${HISTORY_RULES.map((rule) => rule.name).join(", ")}, got ${JSON.stringify(offence.rule)}`);
  return `${offence.where}: rule ${offence.rule}: "${offence.snippet}". Hint: ${offence.hint}`;
};

const main = () => {
  const { values, positionals } = parseArgs({ options: { repo: { type: "string", default: process.cwd() } }, allowPositionals: true });
  assert(positionals.length === 0, `the check takes no positional argument, got ${JSON.stringify(positionals)}; pass --repo <directory>`);
  const repo = resolve(values.repo);
  const files = scannedFiles(repo);
  assert(files.length > 0, `${repo} tracks no source file under ${SCANNED_DIRECTORIES.join(", ")}; pass --repo <root of the plugin repo>`);
  const offences = files.flatMap((file) => historyOffences(file, readFileSync(join(repo, file), "utf8")));
  if (offences.length > 0) {
    console.error(offences.map(formatOffence).join("\n"));
    process.exit(EXIT_OFFENCE);
  }
  console.log(`OK: no history comments in ${files.length} source files`);
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
