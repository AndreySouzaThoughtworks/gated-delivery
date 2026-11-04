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

const segmentProblem = (tag: string, body: string) => { // zanity: ignore[assertion-density] -- no-invariant: tag and body are captures of one cleaned JSDoc line and every branch only builds a message from the tag rules
  const rule = TAG_RULES[tag];
  if (!rule) return `@${tag} is not a type tag; allowed: ${Object.keys(TAG_RULES).join(", ")}`;
  let split: { type: string; rest: string } | null = null;
  let depth = 0;
  for (let index = 0; body.startsWith("{") && index < body.length && split === null; index++) {
    if (body[index] === "{") depth++;
    if (body[index] === "}") depth--;
    if (depth === 0) split = { type: body.slice(0, index + 1), rest: body.slice(index + 1).trim() };
  }
  if (rule.type === "required" && !split) return `@${tag} needs a {type}; write ${TYPES_ONLY_FORMAT}`;
  return rule.rest.test(split ? split.rest : body) ? null : `@${tag} carries text after its type beyond what a type tag allows; write ${TYPES_ONLY_FORMAT}`;
};

const offencesInBlock = (file: string, firstLine: number, block: string) => { // zanity: ignore[assertion-density] -- no-invariant: block is one match of the JSDoc pattern and firstLine counts lines of text already read, so nothing here can be asserted that a bug could break
  const offences: Offence[] = [];
  const segments: OpenTag[] = [];
  block.split("\n").forEach((rawLine, index) => {
    const withoutOpener = index === 0 ? rawLine.replace(BLOCK_OPENER, "") : rawLine.replace(LINE_GUTTER, "");
    const line = withoutOpener.replace(BLOCK_CLOSER, "").trim();
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
    const problem = segmentProblem(segment.tag, segment.body);
    if (problem) offences.push({ where: `${file}:${segment.line}`, text: `${problem}: "@${segment.tag} ${segment.body}"` });
  }
  return offences;
};

const { values } = parseArgs({ options: { repo: { type: "string", default: process.cwd() } } });
const repo = resolve(values.repo);
assert(existsSync(repo), `${repo} must exist, got none; pass --repo <directory>`);
const listed = execFileSync("git", ["ls-files", "-z", SHIPPED_DIRECTORY], { cwd: repo, encoding: "utf8" }).split("\0");
const files = listed.filter((file) => file.endsWith(SHIPPED_EXTENSION) && !file.endsWith(TEST_SUFFIX) && existsSync(join(repo, file)));
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
if (offences.length > 0) {
  console.error(offences.map((offence) => `${offence.where}: ${offence.text}`).join("\n"));
  process.exit(1);
}
console.log(`OK: ${blocks} JSDoc blocks in ${files.length} shipped files, types only`);
