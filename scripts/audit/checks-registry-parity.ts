import assert from "node:assert";
import { CHECK_FIELDS, REGISTRY_FILE, type Check } from "./checks-registry.ts";

export const GUARD_FILE = "scripts/audit/consistency.ts";
export const MAX_TITLE_WORDS = 8;
export const MAX_SENTENCE_WORDS = 20;
const SECTION_HEADER = /^\/\/ --- (\d+)\. /gm;
const ANY_SECTION_HEADER = /^\/\/ --- /gm;
const PUSH_SITE = /\b(?:errors|warnings)\.push\b/;
const KEBAB_CASE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const SENTENCE_BREAK = /\.\s+\S/;
const SOURCE_SEPARATOR = "#";
const TEXT_FIELDS = ["id", "title", "rule", "fix", "example", "source"] as const;
const SENTENCE_FIELDS: readonly string[] = ["rule", "fix"];
const WORD_SEPARATOR = /\s+/;
const TABLE_CELL_SEPARATOR = "|";
const MISTAKES_HEADING = "## Mistakes caught by a rule";
const MISTAKES_SECTION_END = "\n## ";
const MISTAKES_HEADER_ROWS = 2;
const CATEGORY_CELL = 1;
const RULE_CELL = 2;
const COLLECTION_TABLE_HEADER = /^\|[^|\n]*\|\s*Checks\s*\|/m;

export type ParityInput = {
  checks: readonly Check[];
  guardSource: string;
  readSource: (path: string) => string | null;
  workflow: string;
  developmentDoc: string;
  mistakesDoc: string;
};

export const sectionsOf = (guardSource: string) => {
  assert(typeof guardSource === "string", `the guard source must be text, got ${typeof guardSource}; pass the file body`);
  const starts = [...guardSource.matchAll(ANY_SECTION_HEADER)].map((match) => match.index);
  const sections = new Map<number, string>();
  for (const header of guardSource.matchAll(SECTION_HEADER)) {
    const end = starts.find((start) => start > header.index) ?? guardSource.length;
    sections.set(Number(header[1]), guardSource.slice(header.index, end));
  }
  assert(sections.size > 0, `${GUARD_FILE} must hold numbered sections, got none; keep the "// --- N. " headers`);
  return sections;
};

const numberProblems = (checks: readonly Check[]) => {
  assert(Array.isArray(checks), `the registry must be a list of rows, got ${typeof checks}; pass the list`);
  assert(checks.length > 0, `${REGISTRY_FILE} must hold checks, got none; restore the rows`);
  const problems: string[] = [];
  const counts = new Map<number, number>();
  for (const { number } of checks) counts.set(number, (counts.get(number) ?? 0) + 1);
  const last = Math.max(0, ...counts.keys());
  for (let number = 1; number <= last; number++) {
    const count = counts.get(number) ?? 0;
    if (count === 0) problems.push(`${REGISTRY_FILE} has no row ${number} but numbers up to ${last}. Hint: add the row, or renumber so the rows run from 1 with no gap.`);
    if (count > 1) problems.push(`${REGISTRY_FILE} repeats check number ${number} in ${count} rows. Hint: give each row its own number.`);
  }
  return problems;
};

export const sentenceProblems = (text: string, label: string) => {
  assert(typeof text === "string", `${label} must be text, got ${typeof text}; write one sentence`);
  assert(label.trim() !== "", `a sentence needs a label that names its row, got ${JSON.stringify(label)}; pass one`);
  const problems: string[] = [];
  const wordCount = text.trim().split(WORD_SEPARATOR).length;
  if (SENTENCE_BREAK.test(text) || !text.endsWith(".")) problems.push(`${label} must be one sentence that ends with a period. Hint: merge or split the text into one sentence.`);
  if (wordCount > MAX_SENTENCE_WORDS) problems.push(`${label} has ${wordCount} words, over ${MAX_SENTENCE_WORDS}. Hint: trim it to ${MAX_SENTENCE_WORDS} words or fewer, as ASD-STE100 asks.`);
  return problems;
};

const fieldProblems = (check: Check) => {
  assert(Number.isInteger(check.number), `every check number must be a whole number, got ${check.number}; fix the row`);
  assert(check.number > 0, `a check number must be positive, got ${check.number}; renumber the rows from 1`);
  const problems: string[] = [];
  const at = `${REGISTRY_FILE} check ${check.number}`;
  const extra = Object.keys(check).filter((field) => !CHECK_FIELDS.includes(field));
  const missing = CHECK_FIELDS.filter((field) => !Object.hasOwn(check, field));
  if (extra.length > 0 || missing.length > 0) problems.push(`${at} must have exactly the fields ${CHECK_FIELDS.join(", ")}, got extra [${extra}] and missing [${missing}]. Hint: rename or add the fields.`);
  for (const field of TEXT_FIELDS) {
    const text = check[field];
    if (typeof text !== "string" || text.trim() === "") problems.push(`${at} has no ${field}. Hint: write the ${field} text.`);
    else if (field === "id" && !KEBAB_CASE.test(text)) problems.push(`${at} id "${text}" is not kebab-case. Hint: use lowercase words joined by hyphens.`);
    else if (field === "title" && text.trim().split(WORD_SEPARATOR).length > MAX_TITLE_WORDS) problems.push(`${at} title has more than ${MAX_TITLE_WORDS} words. Hint: trim the title.`);
    else if (SENTENCE_FIELDS.includes(field)) problems.push(...sentenceProblems(text, `${at} ${field}`));
  }
  return problems;
};

const implementationProblems = (check: Check, input: ParityInput, sections: Map<number, string>) => {
  assert(typeof check.source === "string" && check.source !== "", `check ${check.number} needs a source, got ${JSON.stringify(check.source)}; name the file that implements it`);
  assert(check.source.split(SOURCE_SEPARATOR).length <= 2, `check ${check.number} must name one file and at most one symbol, got ${check.source}; keep one symbol`);
  const [file, symbol] = check.source.split(SOURCE_SEPARATOR);
  const at = `${REGISTRY_FILE} check ${check.number}`;
  const problems: string[] = [];
  const section = sections.get(check.number);
  if (section !== undefined) {
    if (!PUSH_SITE.test(section)) problems.push(`${at} points at a section of ${GUARD_FILE} that never pushes an error or warning. Hint: add the check there, or remove the row.`);
    if (symbol !== undefined && !section.includes(`${symbol}(`)) problems.push(`${at} names ${symbol}, but the section of ${GUARD_FILE} never calls it. Hint: add the call to the section, or fix the source.`);
  } else if (file === GUARD_FILE || check.number <= Math.max(...sections.keys())) {
    problems.push(`${at} has no section ${check.number} in ${GUARD_FILE}. Hint: add the section, or remove the row.`);
  }
  const body = input.readSource(file);
  if (body === null) problems.push(`${at} names ${file}, which does not exist. Hint: fix the source path.`);
  else if (symbol !== undefined && !new RegExp(`export (?:async )?(?:const|function) ${symbol}\\b`).test(body)) problems.push(`${at} names ${symbol}, which ${file} does not export. Hint: fix the symbol name.`);
  if (section === undefined && file !== GUARD_FILE && !input.workflow.includes(file)) problems.push(`${at} names ${file}, which no step of the audit workflow runs. Hint: add the step, or remove the row.`);
  return problems;
};

const mistakeProblems = (check: Check, mistakesDoc: string) => {
  assert(typeof mistakesDoc === "string", `the mistakes document must be text, got ${typeof mistakesDoc}; pass its body`);
  assert(check.mistake === null || (typeof check.mistake === "string" && check.mistake !== ""), `the mistake of check ${check.number} must be null or a category, got ${JSON.stringify(check.mistake)}; fix the row`);
  if (check.mistake === null) return [];
  const start = mistakesDoc.indexOf(MISTAKES_HEADING);
  const section = start < 0 ? "" : mistakesDoc.slice(start + MISTAKES_HEADING.length).split(MISTAKES_SECTION_END)[0];
  const rows = section.split("\n").filter((line) => line.startsWith(TABLE_CELL_SEPARATOR)).slice(MISTAKES_HEADER_ROWS).map((row) => row.split(TABLE_CELL_SEPARATOR).slice(1, -1).map((cell) => cell.trim()));
  const [file] = check.source.split(SOURCE_SEPARATOR);
  const named = new RegExp(`check ${check.number}[a-z]?\\b`);
  const found = rows.some((cells) => cells[CATEGORY_CELL] === check.mistake && (named.test(cells[RULE_CELL]) || cells[RULE_CELL].includes(file)));
  return found ? [] : [`${REGISTRY_FILE} check ${check.number} cites the mistake "${check.mistake}", but no row of docs/mistakes-to-rules.md has that category and names the check. Hint: fix the category, or set mistake to null.`];
};

const developmentDocProblems = (checks: readonly Check[], developmentDoc: string) => {
  assert(typeof developmentDoc === "string", `docs/development.md must be text, got ${typeof developmentDoc}; pass its body`);
  assert(developmentDoc.length > 0, `docs/development.md must not be empty, got no text; restore it`);
  const problems: string[] = [];
  const lowerDocument = developmentDoc.toLowerCase();
  if (COLLECTION_TABLE_HEADER.test(developmentDoc)) problems.push(`docs/development.md holds a table with a Checks column. Hint: delete the table, since ${REGISTRY_FILE} is the only list of checks.`);
  for (const { title } of checks) {
    if (title.trim() !== "" && lowerDocument.includes(title.toLowerCase())) problems.push(`docs/development.md repeats the check title "${title}". Hint: delete it, since ${REGISTRY_FILE} is the only place check titles live.`);
  }
  return problems;
};

export const parityProblems = (input: ParityInput) => {
  assert(typeof input.readSource === "function", `the source reader must be a function, got ${typeof input.readSource}; pass one`);
  assert(typeof input.workflow === "string", `the workflow must be text, got ${typeof input.workflow}; pass its body`);
  const sections = sectionsOf(input.guardSource);
  const problems = numberProblems(input.checks);
  const registered = new Set(input.checks.map((check) => check.number));
  for (const number of sections.keys()) {
    if (!registered.has(number)) problems.push(`${GUARD_FILE} has check ${number}, but ${REGISTRY_FILE} has no row for it. Hint: add a row numbered ${number}.`);
  }
  for (const check of input.checks) {
    problems.push(...fieldProblems(check), ...implementationProblems(check, input, sections), ...mistakeProblems(check, input.mistakesDoc));
  }
  problems.push(...developmentDocProblems(input.checks, input.developmentDoc));
  return problems;
};

export const exampleProblems = (checks: readonly Check[], messageOf: (number: number) => string) => {
  assert(checks.length > 0, `${REGISTRY_FILE} must hold checks to prove, got none; restore the rows`);
  assert(typeof messageOf === "function", `the message source must be a function, got ${typeof messageOf}; pass one`);
  return checks.flatMap(({ number, example }) => {
    const produced = messageOf(number);
    return produced === example ? [] : [`${REGISTRY_FILE} check ${number} shows "${example}", but its planted bad case prints "${produced}". Hint: copy the printed message into the example.`];
  });
};
