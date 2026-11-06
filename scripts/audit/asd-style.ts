import assert from "node:assert";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export const MAX_SENTENCE_WORDS = 20;
export const MIN_SHORT_SENTENCE_PERCENT = 80;
export const LONGEST_SENTENCES_SHOWN = 5;
export const ROOT_DOCUMENTS = ["README.md", "AGENTS.md", "plugin/README.md"];
export const DOCS_DIRECTORY = "docs";

const PERCENT = 100;
const SNIPPET_WORDS = 6;
const BOUNDARY = "\u0001";
const PROTECTED_DOT = "\u0002";
const MARKDOWN_EXTENSION = ".md";
const HTML_EXTENSION = ".html";
const FENCE = /^\s*(?:```|~~~)/;
const TABLE_ROW = /^\s*\|/;
const HEADING = /^\s{0,3}#{1,6}(?:\s|$)/;
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+/;
const BLOCKQUOTE = /^\s*>\s?/;
const NON_NEWLINE = /[^\n]/g;
const MARKDOWN_NOISE: [RegExp, string][] = [
  [/(`+)[^`]*?\1/g, ""],
  [/!\[[^\]]*\]\([^)]*\)/g, ""],
  [/\[([^\]]*)\]\([^)]*\)/g, "$1"],
  [/<\/?[a-zA-Z][^>]*>/g, ""],
  [/https?:\/\/[^\s)>]+/g, ""],
  [/[*_]{1,3}(?=\S)|(?<=\S)[*_]{1,3}/g, ""],
];
const PROTECTED_ABBREVIATIONS = [/\be\.g\./gi, /\bi\.e\./gi, /\bvs\./gi];
const SENTENCE_END = /[.!?]+["')\]]*(?=\s|$)/g;
const WORD = /[\p{L}\p{N}]/u;
const HTML_COMMENT = /<!--[\s\S]*?-->/g;
const SKIPPED_HTML_ELEMENTS = /<(pre|table|h[1-6]|script|style|svg|head|nav)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const INLINE_HTML_CODE = /<code\b[^>]*>[\s\S]*?<\/code\s*>/gi;
const BLOCK_HTML_TAG = /<\/?(?:p|div|li|ul|ol|section|article|header|footer|main|aside|br|details|summary|figure|figcaption|blockquote|dl|dt|dd|body|html|label|tr|td|th)\b[^>]*>/gi;
const ANY_HTML_TAG = /<\/?[a-zA-Z][^>]*>/g;
const BLANKED_HTML: [RegExp, string][] = [
  [HTML_COMMENT, ""],
  [SKIPPED_HTML_ELEMENTS, BOUNDARY],
  [INLINE_HTML_CODE, ""],
  [BLOCK_HTML_TAG, BOUNDARY],
  [ANY_HTML_TAG, ""],
];
const HTML_ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " ", "&mdash;": "—", "&ndash;": "–" };

export type Sentence = { text: string; line: number; words: number };
export type Document = { file: string; text: string };
export type Share = { file: string; total: number; short: number; percent: number; longest: Sentence[] };
export type Block = { text: string; line: number };

export const sentencesOfBlock = ({ text, line }: Block): Sentence[] => {
  assert(typeof text === "string", `a block needs text, got ${typeof text}; pass the block body.`);
  assert(Number.isInteger(line) && line >= 1, `a block must start at a line from 1, got ${line}; pass the 1-based start line.`);
  const protectedText = PROTECTED_ABBREVIATIONS.reduce((current, abbreviation) => current.replace(abbreviation, (match) => match.replaceAll(".", PROTECTED_DOT)), text);
  const ends = [...protectedText.matchAll(SENTENCE_END)].map((match) => match.index + match[0].length);
  const starts = [0, ...ends];
  const stops = [...ends, protectedText.length];
  return starts.flatMap((start, index) => {
    const raw = protectedText.slice(start, stops[index]);
    const words = raw.split(/\s+/).filter((token) => WORD.test(token)).length;
    if (words === 0) return [];
    const leading = raw.length - raw.trimStart().length;
    const precedingNewlines = protectedText.slice(0, start + leading).split("\n").length - 1;
    return [{ text: raw.trim().replace(/[ \t]+/g, " ").replaceAll(PROTECTED_DOT, "."), line: line + precedingNewlines, words }];
  });
};

export const markdownBlocks = (source: string): Block[] => {
  assert(typeof source === "string", `a markdown source must be text, got ${typeof source}; pass the file body.`);
  const blocks: Block[] = [];
  let current: Block | null = null;
  let fenceOpenedAt = 0;
  source.split("\n").forEach((rawLine, index) => {
    const line = index + 1;
    const isFence = FENCE.test(rawLine);
    if (isFence) fenceOpenedAt = fenceOpenedAt === 0 ? line : 0;
    const isSeparator = isFence || fenceOpenedAt !== 0 || TABLE_ROW.test(rawLine) || HEADING.test(rawLine) || rawLine.trim() === "";
    if (isSeparator || LIST_ITEM.test(rawLine)) current = null;
    if (isSeparator) return;
    const content = rawLine.replace(BLOCKQUOTE, "").replace(LIST_ITEM, "");
    if (current) {
      current.text += `\n${content}`;
    } else {
      current = { text: content, line };
      blocks.push(current);
    }
  });
  assert(fenceOpenedAt === 0, `the code fence opened at line ${fenceOpenedAt} never closes, so it hides the rest of the file; add the closing fence.`);
  return blocks;
};

export const htmlBlocks = (source: string): Block[] => {
  assert(typeof source === "string", `an html source must be text, got ${typeof source}; pass the file body.`);
  assert(!source.includes(BOUNDARY), `the html holds the reserved control character U+0001, got it at offset ${source.indexOf(BOUNDARY)}; remove it.`);
  const blanked = BLANKED_HTML.reduce((current, [pattern, prefix]) => current.replace(pattern, (match) => prefix + match.replace(NON_NEWLINE, "")), source);
  const decoded = Object.entries(HTML_ENTITIES).reduce((current, [entity, character]) => current.replaceAll(entity, character), blanked);
  const blocks: Block[] = [];
  let offset = 0;
  for (const piece of decoded.split(BOUNDARY)) {
    const leading = piece.length - piece.trimStart().length;
    blocks.push({ text: piece.trim(), line: decoded.slice(0, offset + leading).split("\n").length });
    offset += piece.length + BOUNDARY.length;
  }
  return blocks.filter((block) => block.text !== "");
};

export const sentencesOf = ({ file, text }: Document): Sentence[] => {
  assert(typeof file === "string" && file !== "", `a document needs a file name, got ${JSON.stringify(file)}; pass the repository path.`);
  assert(typeof text === "string", `${file} needs text content, got ${typeof text}; pass the file body.`);
  const blocks = file.endsWith(HTML_EXTENSION)
    ? htmlBlocks(text)
    : markdownBlocks(text).map((block) => ({ ...block, text: MARKDOWN_NOISE.reduce((current, [pattern, replacement]) => current.replace(pattern, replacement), block.text) }));
  return blocks.flatMap(sentencesOfBlock);
};

export const shareOf = (document: Document): Share => {
  assert(typeof document.file === "string" && document.file !== "", `a document needs a file name, got ${JSON.stringify(document.file)}; pass the repository path.`);
  assert(typeof document.text === "string", `${document.file} needs text content, got ${typeof document.text}; pass the file body.`);
  const sentences = sentencesOf(document);
  const short = sentences.filter(({ words }) => words <= MAX_SENTENCE_WORDS).length;
  const longest = sentences
    .filter(({ words }) => words > MAX_SENTENCE_WORDS)
    .sort((a, b) => b.words - a.words || a.line - b.line)
    .slice(0, LONGEST_SENTENCES_SHOWN);
  const percent = sentences.length === 0 ? PERCENT : Math.floor((short * PERCENT) / sentences.length);
  return { file: document.file, total: sentences.length, short, percent, longest };
};

export const asdStyleProblems = (documents: Document[]) => {
  assert(Array.isArray(documents), `documents must be a list of files, got ${typeof documents}; pass the list.`);
  assert(documents.every(({ file }) => typeof file === "string" && file !== ""), `every document needs a file name, got ${JSON.stringify(documents.map(({ file }) => file))}; name each one.`);
  const problems: string[] = [];
  for (const document of documents) {
    const share = shareOf(document);
    if (share.short * PERCENT >= share.total * MIN_SHORT_SENTENCE_PERCENT) continue;
    const longest = share.longest.map(({ line, words, text }) => `line ${line} (${words} words) "${text.split(/\s+/).slice(0, SNIPPET_WORDS).join(" ")}..."`);
    problems.push(
      `${share.file} has ${share.percent}% of its ${share.total} sentences within ${MAX_SENTENCE_WORDS} words, below the ${MIN_SHORT_SENTENCE_PERCENT}% ASD-STE100 rule. Hint: split each long sentence, longest first: ${longest.join("; ")}.`,
    );
  }
  return problems;
};

export const styleDocuments = (root: string): Document[] => {
  assert(existsSync(root), `the repository root ${root} must exist; pass the repository root.`);
  assert(statSync(root).isDirectory(), `the repository root ${root} must be a directory, got a file; pass the repository root.`);
  const docsPath = join(root, DOCS_DIRECTORY);
  const docsFiles = existsSync(docsPath)
    ? readdirSync(docsPath).filter((name) => name.endsWith(MARKDOWN_EXTENSION)).sort().map((name) => `${DOCS_DIRECTORY}/${name}`)
    : [];
  return [...ROOT_DOCUMENTS, ...docsFiles]
    .filter((file) => existsSync(join(root, file)))
    .map((file) => ({ file, text: readFileSync(join(root, file), "utf8") }));
};
