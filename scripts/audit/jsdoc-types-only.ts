#!/usr/bin/env node
import assert from "node:assert";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

const SHIPPED_DIRECTORY = "plugin/";
const SHIPPED_EXTENSION = ".mjs";
const TEST_SUFFIX = ".test.mjs";
const JSDOC_BLOCK = /\/\*\*[\s\S]*?\*\//g;
const BLOCK_OPENER = /^\s*(?:\/\*\*+)?\s*/;
const BLOCK_CLOSER = /\s*\*+\/\s*$/;
const LINE_GUTTER = /^\s*\*(?!\/)\s?/;
const TAG_START = /^@([A-Za-z]+)\s*(.*)$/;
const NOTHING = /^$/;
const IDENTIFIER = /^[\w$]*$/;
const PARAMETER_NAME = /^(?:\[[^\]]+\]|[\w$.]+)$/;
const TEMPLATE_NAMES = /^[\w$]+(?:\s*,\s*[\w$]+)*$/;
const IMPORT_SOURCE = /^from\s+(?:"[^"]+"|'[^']+')$/;
const TYPES_ONLY_FORMAT = "@tag {type} name, with nothing after the name";

type TypeRule = "required" | "optional" | "none";
type TagRule = { type: TypeRule; rest: RegExp };
type Offence = { where: string; text: string };
type OpenTag = { tag: string; line: number; body: string };

const TAG_RULES: Record<string, TagRule> = {
  param: { type: "required", rest: PARAMETER_NAME },
  property: { type: "required", rest: PARAMETER_NAME },
  prop: { type: "required", rest: PARAMETER_NAME },
  returns: { type: "required", rest: NOTHING },
  return: { type: "required", rest: NOTHING },
  type: { type: "required", rest: NOTHING },
  satisfies: { type: "required", rest: NOTHING },
  throws: { type: "required", rest: NOTHING },
  this: { type: "required", rest: NOTHING },
  typedef: { type: "required", rest: IDENTIFIER },
  callback: { type: "none", rest: /^[\w$]+$/ },
  template: { type: "optional", rest: TEMPLATE_NAMES },
  import: { type: "required", rest: IMPORT_SOURCE },
};

const splitLeadingType = (text: string) => {
  assert(typeof text === "string", `the text to split must be a string, got ${typeof text}`);
  if (!text.startsWith("{")) return null;
  let depth = 0;
  for (let index = 0; index < text.length; index++) {
    if (text[index] === "{") depth++;
    if (text[index] === "}") depth--;
    if (depth === 0) {
      const split = { type: text.slice(0, index + 1), rest: text.slice(index + 1).trim() };
      assert(split.type.endsWith("}"), `a leading type must end at its closing brace, got "${split.type}"`);
      return split;
    }
  }
  return null;
};

const segmentProblem = (tag: string, body: string) => {
  assert(tag.length > 0, `a tag name must be non-empty, got "${tag}"`);
  const rule = TAG_RULES[tag];
  if (!rule) return `@${tag} is not a type tag; allowed: ${Object.keys(TAG_RULES).join(", ")}`;
  const split = splitLeadingType(body);
  if (rule.type === "required" && !split) return `@${tag} needs a {type}; write ${TYPES_ONLY_FORMAT}`;
  const rest = split ? split.rest : body;
  const problem = rule.rest.test(rest) ? null : `@${tag} carries text after its type beyond what a type tag allows; write ${TYPES_ONLY_FORMAT}`;
  assert(problem === null || problem.includes(`@${tag}`), `a problem must name its tag @${tag}, got "${problem}"`);
  return problem;
};

const tagOffence = (file: string, open: OpenTag) => {
  assert(open.line >= 1, `line numbers start at 1, got ${open.line}`);
  const problem = segmentProblem(open.tag, open.body);
  const offence = problem ? { where: `${file}:${open.line}`, text: `${problem}: "@${open.tag} ${open.body}"` } : null;
  assert(offence === null || offence.where.endsWith(`:${open.line}`), `an offence must carry its line ${open.line}, got ${offence?.where}`);
  return offence;
};

const cleanedLines = (block: string) => {
  assert(block.startsWith("/**"), `a JSDoc block must start with /**, got "${block.slice(0, 10)}"`);
  const lines = block.split("\n").map((line, index) => {
    const withoutOpener = index === 0 ? line.replace(BLOCK_OPENER, "") : line.replace(LINE_GUTTER, "");
    return withoutOpener.replace(BLOCK_CLOSER, "").trim();
  });
  assert(lines.every((line) => !line.includes("*/")), `a cleaned line must hold no block closer, got "${lines.find((line) => line.includes("*/"))}"`);
  return lines;
};

const offencesInBlock = (file: string, firstLine: number, block: string) => {
  assert(Number.isInteger(firstLine) && firstLine >= 1, `line numbers start at 1, got ${firstLine}`);
  const offences: Offence[] = [];
  const segments: OpenTag[] = [];
  cleanedLines(block).forEach((line, index) => {
    if (line === "") return;
    const tagged = line.match(TAG_START);
    const current = segments.at(-1);
    if (tagged) {
      segments.push({ tag: tagged[1], line: firstLine + index, body: tagged[2] });
    } else if (current) {
      current.body = `${current.body} ${line}`;
    } else {
      offences.push({ where: `${file}:${firstLine + index}`, text: `prose in a JSDoc block, only type tags are allowed: "${line}"` });
    }
  });
  for (const segment of segments) {
    const offence = tagOffence(file, segment);
    if (offence) offences.push(offence);
  }
  assert(offences.every((offence) => offence.where.startsWith(`${file}:`)), `every offence must name ${file}, got ${offences.map((offence) => offence.where)}`);
  return offences;
};

const shippedFiles = (repo: string) => {
  assert(existsSync(repo), `${repo} must exist, got none; pass --repo <directory>`);
  const listed = execFileSync("git", ["ls-files", "-z", SHIPPED_DIRECTORY], { cwd: repo, encoding: "utf8" }).split("\0");
  const files = listed.filter((file) => file.endsWith(SHIPPED_EXTENSION) && !file.endsWith(TEST_SUFFIX) && existsSync(join(repo, file)));
  assert(files.every((file) => file.startsWith(SHIPPED_DIRECTORY)), `only ${SHIPPED_DIRECTORY} files are audited, got ${files.find((file) => !file.startsWith(SHIPPED_DIRECTORY))}`);
  return files;
};

const auditRepo = (repo: string) => {
  const files = shippedFiles(repo);
  const offences: Offence[] = [];
  let blocks = 0;
  for (const file of files) {
    const source = readFileSync(join(repo, file), "utf8");
    for (const match of source.matchAll(JSDOC_BLOCK)) {
      blocks++;
      const firstLine = source.slice(0, match.index).split("\n").length;
      offences.push(...offencesInBlock(file, firstLine, match[0]));
    }
  }
  assert(offences.every((offence) => offence.text.length > 0), `every offence must carry its text, got ${offences.find((offence) => offence.text.length === 0)?.where}`);
  assert(files.length === new Set(files).size, `git lists each file once, got ${files.length} entries for ${new Set(files).size} files`);
  return { files: files.length, blocks, offences };
};

const { values } = parseArgs({ options: { repo: { type: "string", default: process.cwd() } } });
const audit = auditRepo(resolve(values.repo));
if (audit.offences.length > 0) {
  console.error(audit.offences.map((offence) => `${offence.where}: ${offence.text}`).join("\n"));
  process.exit(1);
}
console.log(`OK: ${audit.blocks} JSDoc blocks in ${audit.files} shipped files, types only`);
