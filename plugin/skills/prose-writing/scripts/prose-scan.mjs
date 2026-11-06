#!/usr/bin/env node

import assert from "node:assert";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** @typedef {{ category: string, phrases: string[], patterns: string[], fix: string }} TicGroup */
/** @typedef {{ line: number, kind: string, text: string, fix: string }} Hit */

/** @type {TicGroup[]} */
export const TICS = [
  {
    category: "announcing frame",
    phrases: ["worth noting", "the point is", "the interesting bit", "the honest read", "honestly", "to be fair", "good question"],
    patterns: [],
    fix: "delete the frame and open on the fact, not on the announcement",
  },
  {
    category: "banned phrase",
    phrases: ["earns its place", "load-bearing"],
    patterns: [],
    fix: "reword the claim in plain words and drop this phrase",
  },
  {
    category: "negation-contrast",
    phrases: ["rather than", "instead of", "not just"],
    patterns: ["it['’]s not [^,.;]+, it", "not an? [^,.;]* but "],
    fix: "state the positive and drop the foil; keep the contrast only where it is the information",
  },
  {
    category: "negative space",
    phrases: ["does not", "doesn't touch"],
    patterns: [],
    fix: "cut the absence and keep the positive claim; no reader needs a list of what is missing",
  },
  {
    category: "self-commentary",
    phrases: ["reads better as"],
    patterns: [],
    fix: "delete it; prose does not review itself",
  },
  {
    category: "affirm-then-justify opener",
    phrases: [],
    patterns: ["yes, and it['’]s worth"],
    fix: "delete the opener and start on the fact; do not affirm or justify first",
  },
  {
    category: "debate residue",
    phrases: ["went back and forth"],
    patterns: [],
    fix: "cut the recap of the discussion; the reader needs only the decision",
  },
];

export const ORDINARY_PHRASES = ["rather than", "instead of", "does not"];

const FLAG_MAX_SENTENCE_WORDS = "--max-sentence-words";
const STDIN_NAME = "-";
const STDIN_LABEL = "<stdin>";
const STDIN_DESCRIPTOR = 0;
const TIC_KIND = "tic";
const LONG_SENTENCE_KIND = "long sentence";
const EXIT_HITS = 1;
const EXIT_USAGE = 2;
const FENCE_LINE = /^\s*(```|~~~)/;
const INLINE_CODE = /`[^`]*`/g;
const SENTENCE_END = /(?<=[.!?])\s+/;
const LINE_SKIPPED_FOR_SENTENCES = /^\s*(#|\|)/;
const LIST_MARKER = /^\s*(?:[-*>]|\d+\.)\s+/;
const SHOWN_WORDS = 6;
const WORD_BREAK = /\s+/;
const REGEX_SPECIALS = /[.*+?^${}()|[\]\\]/g;
const WORD_EDGE_BEFORE = "(?<![\\w-])";
const WORD_EDGE_AFTER = "(?![\\w-])";

const MATCHERS = TICS.map((group) => ({
  fix: group.fix,
  expression: new RegExp(
    [
      ...group.phrases.map((phrase) => `${WORD_EDGE_BEFORE}${phrase.replace(REGEX_SPECIALS, "\\$&").replace(/ /g, "\\s+").replace(/'/g, "['’]")}${WORD_EDGE_AFTER}`),
      ...group.patterns,
    ].join("|"),
    "gi",
  ),
}));

/**
 * @param {string} text
 * @param {{ maxSentenceWords?: number }} [options]
 * @returns {Hit[]}
 */
export const scanText = (text, options = {}) => {
  assert(typeof text === "string", `the \`text\` to scan must be a string, got ${typeof text}; pass the file text.`);
  const { maxSentenceWords } = options;
  assert(
    maxSentenceWords === undefined || (Number.isInteger(maxSentenceWords) && maxSentenceWords > 0),
    `\`maxSentenceWords\` must be a positive whole number, got ${JSON.stringify(maxSentenceWords)}; pass a count such as 20.`,
  );
  /** @type {Hit[]} */
  const hits = [];
  let inFence = false;
  text.split("\n").forEach((rawLine, index) => {
    if (FENCE_LINE.test(rawLine)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    const line = rawLine.replace(INLINE_CODE, " ");
    for (const { expression, fix } of MATCHERS) {
      for (const match of line.matchAll(expression)) hits.push({ line: index + 1, kind: TIC_KIND, text: match[0], fix });
    }
    if (maxSentenceWords === undefined || LINE_SKIPPED_FOR_SENTENCES.test(line)) return;
    for (const sentence of line.replace(LIST_MARKER, "").split(SENTENCE_END)) {
      const words = sentence.split(WORD_BREAK).filter(Boolean).length;
      if (words <= maxSentenceWords) continue;
      const shown = sentence.trim().split(WORD_BREAK).slice(0, SHOWN_WORDS).join(" ");
      hits.push({ line: index + 1, kind: LONG_SENTENCE_KIND, text: `${words} words: ${shown} ...`, fix: `split it; no sentence may run past ${maxSentenceWords} words` });
    }
  });
  return hits;
};

/**
 * @param {string[]} args
 * @returns {{ source: string, maxSentenceWords?: number } | null}
 */
export const parseArguments = (args) => {
  assert(Array.isArray(args), `the \`args\` must be a list, got ${typeof args}; pass process.argv.slice(2).`);
  assert(args.every((argument) => typeof argument === "string"), `every item of \`args\` must be a string, got ${JSON.stringify(args)}; pass process.argv.slice(2).`);
  const flagAt = args.indexOf(FLAG_MAX_SENTENCE_WORDS);
  const rest = flagAt === -1 ? args : [...args.slice(0, flagAt), ...args.slice(flagAt + 2)];
  const limit = flagAt === -1 ? undefined : Number(args[flagAt + 1]);
  const limitValid = limit === undefined || (Number.isInteger(limit) && limit > 0);
  if (rest.length !== 1 || !limitValid) return null;
  return { source: rest[0], maxSentenceWords: limit };
};

const USAGE = `prose-scan needs one <file>, or ${STDIN_NAME} for stdin, and a positive whole number after ${FLAG_MAX_SENTENCE_WORDS}; run: node <skill base directory>/scripts/prose-scan.mjs <file> [${FLAG_MAX_SENTENCE_WORDS} <n>]\n`;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const parsed = parseArguments(process.argv.slice(2));
  if (parsed === null) {
    process.stderr.write(USAGE);
    process.exit(EXIT_USAGE);
  }
  const { source, maxSentenceWords } = parsed;
  let text;
  try {
    text = readFileSync(source === STDIN_NAME ? STDIN_DESCRIPTOR : source, "utf8");
  } catch {
    process.stderr.write(`prose-scan cannot read "${source}", which is not a readable file; pass an existing file path.\n`);
    process.exit(EXIT_USAGE);
  }
  const label = source === STDIN_NAME ? STDIN_LABEL : source;
  const hits = scanText(text, { maxSentenceWords });
  for (const { line, kind, text: hit, fix } of hits) process.stdout.write(`${label}:${line}: ${kind} "${hit}" is not allowed; fix: ${fix}\n`);
  process.exit(hits.length > 0 ? EXIT_HITS : 0);
}
