#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const EXIT_CLEAN = 0;
const EXIT_PROBLEMS = 1;
const EXIT_USAGE = 2;
const ENCODING = "utf8";
const ONE_BASED_OFFSET = 1;
const FIRST_LINE = 1;
const MAX_BULLET_WORDS = 30;
const AC_MERGE_THRESHOLD = 15;
const AC_SPLIT_THRESHOLD = 40;
const ERROR = "error";
const WARNING = "warning";
const LINE_BREAK = /\r?\n/;
const WHITESPACE = /\s+/;
const FENCE = /^\s*```/;
const HEADING = /^## (.+?)\s*$/;
const INLINE_CODE = /`[^`\n]*`/g;
const OPEN_TAG = /\[(QUESTION|DEPENDENCY)\]/g;
const ANY_OPEN_TAG = /\[(QUESTION|DEPENDENCY)\]/;
const STATUS_FIELD = /^\s*(?:[-*]\s*)?\*{0,2}status\*{0,2}:\*{0,2}\s*(.+?)\s*\*{0,2}$/i;
const PRIORITY_FIELD = /^\s*(?:[-*]\s*)?\*{0,2}priority\*{0,2}:\*{0,2}\s*(.+?)\s*\*{0,2}$/i;
/** @type {[name: string, pattern: RegExp][]} */
const FIELD_PATTERNS = [
  ["status", STATUS_FIELD],
  ["priority", PRIORITY_FIELD],
];
const READY_STATUS = /^ready\b/i;
const LOW_PRIORITY = /^low\b/i;
const TICKED_BOX = /^\s*[-*] \[[xX]\]/;
const CHECKBOX_ROW = /^\s*[-*] \[[ xX]\]/;
const BULLET = /^\s*[-*]\s+/;
const INDENTED = /^\s+\S/;
const ACCEPTANCE_ROW = /^\|\s*\d+\s*\|/;
const ITALIC_LINE = /^\*[^*].*\*$/;
const TIMEBOX_LABEL = /\*\*Duration or end date:\*\*/i;
const NUMBER_WORD = "one|two|three|four|five|six|seven|eight|nine|ten|a|an";
const DURATION = new RegExp(String.raw`\b(?:\d+(?:\.\d+)?|${NUMBER_WORD})\s+(?:hours?|hrs?|days?|weeks?|months?|sprints?)\b`, "i");
const MONTH = "jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec";
const DATE = new RegExp(String.raw`\b\d{4}-\d{2}-\d{2}\b|\b(?:${MONTH})[a-z]*\.?\s+\d{1,2}\b|\b\d{1,2}(?:st|nd|rd|th)?\s+(?:${MONTH})`, "i");
const DEFINITION_PREFIX = "definition of";
const READY_SECTION = "definition of ready";
const ACCEPTANCE_SECTION = "acceptance criteria";
const TIMEBOX_SECTION = "timebox";
const USAGE = "usage: ticket-lint.mjs <draft.md> --kind story|task|bug|spike [--priority-confirmed]";

/** @type {Record<string, string[]>} */
export const REQUIRED_HEADINGS = {
  story: ["User Story", "Background", "Scope", "Acceptance Criteria"],
  task: ["Description", "Completion Criteria"],
  bug: ["Impact summary", "Expected Result", "Actual Result", "Steps to Reproduce", "Environment"],
  spike: ["Question", "Why it matters", "Timebox", "Deliverables"],
};

/** @type {[name: string, pattern: RegExp][]} */
export const PLACEHOLDERS = [
  ["template guidance line", /Guidance in italics/],
  ["template placeholder", /\\?<(?:role|capability|benefit|action)\\?>/],
  ["empty bullet", /^\s*[-*]\s*$/],
  ["empty numbered step", /^\s*\d+\.\s*$/],
  ["empty completion criterion", /^\s*- \[ \] C\d+\.\s*$/],
  ["empty table row", /^\|\s*\d*\s*(?:\|\s*)+$/],
];

/**
 * @typedef {{ number: number, text: string, prose: string, section: string | undefined, heading: boolean }} Line
 * @typedef {{ line: number, value: string }} Field
 * @typedef {{ lines: Line[], titles: Map<string, number>, bodies: Map<string, Line[]>, fields: Record<string, Field | undefined> }} Draft
 * @typedef {{ line: number, level: "error" | "warning", rule: string, detail: string }} Problem
 * @typedef {{ kind: string, priorityConfirmed: boolean }} Context
 */

/**
 * @param {string} raw
 * @returns {Draft}
 */
export const parseDraft = (raw) => {
  assert(typeof raw === "string", `the \`raw\` draft must be text, got ${typeof raw}; pass the draft as a string.`);
  /** @type {Line[]} */
  const lines = [];
  /** @type {Map<string, number>} */
  const titles = new Map();
  /** @type {Record<string, Field | undefined>} */
  const fields = {};
  let fenced = false;
  let fenceOpenedAt = 0;
  let section;
  for (const [index, text] of raw.split(LINE_BREAK).entries()) {
    if (FENCE.test(text)) {
      fenced = !fenced;
      if (fenced) fenceOpenedAt = index + ONE_BASED_OFFSET;
    }
    else if (!fenced) {
      const number = index + ONE_BASED_OFFSET;
      const title = HEADING.exec(text)?.[1].toLowerCase();
      if (title !== undefined) {
        section = title;
        titles.set(title, number);
      }
      for (const [name, pattern] of FIELD_PATTERNS) {
        const value = fields[name] ? undefined : pattern.exec(text)?.[1];
        if (value !== undefined) fields[name] = { line: number, value };
      }
      lines.push({ number, text, prose: text.replace(INLINE_CODE, ""), section, heading: title !== undefined });
    }
  }
  assert(!fenced, `a code fence opened at line ${fenceOpenedAt} and never closed, which hides every line after it from the lint; add the closing fence after it`);
  const bodies = new Map([...titles.keys()].map((title) => [title, lines.filter((line) => line.section === title && !line.heading)]));
  return { lines, titles, bodies, fields };
};

/** @type {((draft: Draft, context: Context) => Problem[])[]} */
const RULES = [
  ({ titles }, { kind }) =>
    REQUIRED_HEADINGS[kind]
      .filter((heading) => !titles.has(heading.toLowerCase()))
      .map((heading) => ({ line: FIRST_LINE, level: ERROR, rule: "required-heading", detail: `a ${kind} needs the section "## ${heading}"; add it` })),
  ({ lines }) =>
    lines.flatMap((line) =>
      PLACEHOLDERS.filter(([, pattern]) => pattern.test(line.prose)).map(([name]) => ({ line: line.number, level: ERROR, rule: "placeholder", detail: `${name} is still in the draft; fill it or delete it` })),
    ),
  (draft) => {
    const { status } = draft.fields;
    if (!status || !READY_STATUS.test(status.value)) return [];
    return draft.lines.flatMap((line) =>
      [...line.prose.matchAll(OPEN_TAG)].map(([tag]) => ({ line: line.number, level: ERROR, rule: "ready-with-open-item", detail: `status is "${status.value}" but ${tag} is still open; resolve it with the user or move the ticket out of Ready` })),
    );
  },
  (draft, { kind, priorityConfirmed }) => {
    const { priority } = draft.fields;
    if (kind !== "bug" || priorityConfirmed || !priority || !LOW_PRIORITY.test(priority.value)) return [];
    return [{ line: priority.line, level: ERROR, rule: "bug-priority", detail: "a Bug drafted at Low is the starting point, not a decision; recommend a priority from the Impact summary, get the user to confirm, then pass --priority-confirmed" }];
  },
  (draft, { kind }) => {
    const heading = draft.titles.get(TIMEBOX_SECTION);
    if (kind !== "spike" || heading === undefined) return [];
    const value = (draft.bodies.get(TIMEBOX_SECTION) ?? [])
      .filter((line) => !ITALIC_LINE.test(line.text.trim()))
      .map((line) => line.text.replace(TIMEBOX_LABEL, ""))
      .join(" ");
    return DURATION.test(value) || DATE.test(value) ? [] : [{ line: heading, level: ERROR, rule: "spike-timebox", detail: `the timebox must be a duration or an end date, got ${JSON.stringify(value.trim())}; ask for one` }];
  },
  (draft, { kind }) =>
    kind === "story"
      ? (draft.bodies.get(READY_SECTION) ?? [])
          .filter((line) => TICKED_BOX.test(line.text))
          .map((line) => ({ line: line.number, level: ERROR, rule: "definition-of-ready-ticked", detail: "a Definition of Ready box is ticked; leave every box unticked, ticking is the team's act" }))
      : [],
  (draft, { kind }) => {
    if (kind !== "story") return [];
    const count = (draft.bodies.get(ACCEPTANCE_SECTION) ?? []).filter((line) => ACCEPTANCE_ROW.test(line.text)).length;
    const line = draft.titles.get(ACCEPTANCE_SECTION) ?? FIRST_LINE;
    if (count > AC_SPLIT_THRESHOLD) return [{ line, level: WARNING, rule: "acceptance-criteria-count", detail: `${count} acceptance criteria is a test plan or two stories; split it` }];
    if (count > AC_MERGE_THRESHOLD) return [{ line, level: WARNING, rule: "acceptance-criteria-count", detail: `${count} acceptance criteria; look for merges first, then a split` }];
    return [];
  },
  (draft, { kind }) => {
    if (kind !== "story") return [];
    const candidates = draft.lines.filter((line) => !line.heading && !line.section?.startsWith(DEFINITION_PREFIX));
    /** @type {{ line: number, words: string[], text: string }[]} */
    const bullets = [];
    let current;
    for (const line of candidates) {
      if (BULLET.test(line.text) && !CHECKBOX_ROW.test(line.text)) {
        current = { line: line.number, words: line.text.replace(BULLET, "").split(WHITESPACE), text: line.text };
        bullets.push(current);
      } else if (current && INDENTED.test(line.text) && !BULLET.test(line.text)) current.words.push(...line.text.trim().split(WHITESPACE));
      else current = undefined;
    }
    return bullets
      .filter(({ words, text }) => words.length > MAX_BULLET_WORDS && !ANY_OPEN_TAG.test(text))
      .map(({ line, words }) => ({ line, level: WARNING, rule: "bullet-length", detail: `${words.length} words; past about ${MAX_BULLET_WORDS}, look for a second claim` }));
  },
];

/**
 * @param {string} raw
 * @param {string} kind
 * @param {{ priorityConfirmed?: boolean }} [options]
 * @returns {Problem[]}
 */
export const lintDraft = (raw, kind, options = {}) => {
  assert(Object.hasOwn(REQUIRED_HEADINGS, kind), `the kind must be one of ${Object.keys(REQUIRED_HEADINGS).join(", ")}, got ${JSON.stringify(kind)}; pass one of them.`);
  assert([undefined, true, false].includes(options.priorityConfirmed), `priorityConfirmed must be a boolean when given, got ${JSON.stringify(options.priorityConfirmed)}; pass true or false.`);
  const draft = parseDraft(raw);
  const context = { kind, priorityConfirmed: options.priorityConfirmed === true };
  return RULES.flatMap((rule) => rule(draft, context)).sort((a, b) => a.line - b.line);
};

/**
 * @param {string[]} argv
 * @returns {number}
 */
const main = (argv) => {
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      options: { kind: { type: "string" }, "priority-confirmed": { type: "boolean" } },
      allowPositionals: true,
    });
    assert(positionals.length === 1, `ticket-lint needs exactly one draft file, got ${positionals.length}; pass one path.`);
    assert(values.kind !== undefined, `--kind is required but missing, got ${JSON.stringify(values.kind)}; pass --kind with ${Object.keys(REQUIRED_HEADINGS).join(", ")}.`);
    const problems = lintDraft(readFileSync(positionals[0], ENCODING), values.kind, { priorityConfirmed: values["priority-confirmed"] });
    for (const { line, level, rule, detail } of problems) console.log(level === WARNING ? `${WARNING}: ${line}: ${rule}: ${detail}` : `${line}: ${rule}: ${detail}`);
    return problems.some((problem) => problem.level === ERROR) ? EXIT_PROBLEMS : EXIT_CLEAN;
  } catch (error) {
    console.error(`ticket-lint: ${error instanceof Error ? error.message : String(error)}\n${USAGE}`);
    return EXIT_USAGE;
  }
};

const entryPoint = process.argv[1];
if (entryPoint !== undefined && import.meta.url === pathToFileURL(realpathSync(entryPoint)).href) process.exitCode = main(process.argv.slice(2));
