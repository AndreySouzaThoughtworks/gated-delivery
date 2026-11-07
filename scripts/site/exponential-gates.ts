import assert from "node:assert";
import { existsSync } from "node:fs";
import { join } from "node:path";

export const EXPONENTIAL_PAGE = "exponential-engineering.html";
export const SOURCE_SITE_URL = "https://exponentialengineering.dev/";
export const SOURCE_AUTHORS = ["Ben O'Mahony", "Fabian Nonnenmacher"];
export const CONCEPT_PARTS = ["The idea", "How this repo applies it", "Proof", "Where it falls short"];
export const MIN_COPIED_WORDS = 12;
const MINIMUM_RUN_WORDS = 2;

const CONCEPT_CARD_START = '<article class="feature"';
const CHECK_CARD = /<article class="check-card"[\s\S]*?<\/article>/g;
const FIRST_CARD_INDEX = 1;
const CONCEPT_ID = /<h2 id="feature-([\w-]+)">/;
const DEFINITION_TERM = /<dt>([^<]*)<\/dt>/g;
const TERMINAL_FIGURE = /<figure class="terminal">[\s\S]*?<\/figure>/g;
const CODE_SPAN = /<code>([^<\s]+)<\/code>/g;
const REPOSITORY_FILE = /^[\w.-]+(?:\/[\w.-]+)*\.(?:ts|mjs|json|md|sh|yml|toml|html|count)$/;
const TAG = /<[^>]*>/g;
const NAMED_ENTITIES: [string, string][] = [["&lt;", "<"], ["&gt;", ">"], ["&quot;", '"'], ["&#39;", "'"], ["&apos;", "'"], ["&amp;", "&"]];
const WORD = /[\p{L}\p{N}']+/gu;
const SPACE = " ";

export const plainText = (html: string) => {
  assert(typeof html === "string", `plain text is made from html text, got ${typeof html}; pass the page body.`);
  assert(html.trim() !== "", `plain text needs a page body, got an empty one; pass the html.`);
  return NAMED_ENTITIES.reduce((text, [entity, character]) => text.replaceAll(entity, character), html.replace(TAG, SPACE));
};

export const wordsOf = (text: string) => {
  assert(typeof text === "string", `words are read from text, got ${typeof text}; pass a string.`);
  assert(text.trim() !== "", `words are read from text, got an empty one; pass the text.`);
  return [...text.toLowerCase().matchAll(WORD)].map(([word]) => word);
};

export const gramsOf = (words: string[], size: number) => {
  assert(Array.isArray(words), `grams are cut from a list of words, got ${typeof words}; pass the words.`);
  assert(Number.isInteger(size) && size >= MINIMUM_RUN_WORDS, `a gram has at least ${MINIMUM_RUN_WORDS} words, got ${size}; pass a larger size.`);
  return Array.from({ length: Math.max(0, words.length - size + 1) }, (_word, start) => words.slice(start, start + size).join(SPACE));
};

export const copiedRuns = (candidate: string, source: string, minimumWords = MIN_COPIED_WORDS) => {
  assert(Number.isInteger(minimumWords) && minimumWords >= MINIMUM_RUN_WORDS, `a copied run has at least ${MINIMUM_RUN_WORDS} words, got ${minimumWords}; pass a larger limit.`);
  assert(typeof candidate === "string" && typeof source === "string", `copy detection compares two texts, got ${typeof candidate} and ${typeof source}; pass strings.`);
  const candidateWords = wordsOf(candidate);
  const known = new Set(gramsOf(wordsOf(source), minimumWords));
  const copied = new Array<boolean>(candidateWords.length).fill(false);
  gramsOf(candidateWords, minimumWords).forEach((gram, start) => {
    if (known.has(gram)) copied.fill(true, start, start + minimumWords);
  });
  const runs: string[] = [];
  let begin = -1;
  copied.forEach((flag, index) => {
    if (flag && begin < 0) begin = index;
    if (!flag && begin >= 0) {
      runs.push(candidateWords.slice(begin, index).join(SPACE));
      begin = -1;
    }
  });
  if (begin >= 0) runs.push(candidateWords.slice(begin).join(SPACE));
  return runs;
};

export const attributionProblems = (file: string, html: string) => {
  assert(file !== "", `an attribution check needs a file name, got an empty one; pass the page path.`);
  assert(typeof html === "string", `${file} must be html text, got ${typeof html}; pass the page body.`);
  if (file !== EXPONENTIAL_PAGE) return [];
  const problems: string[] = [];
  if (!html.includes(`href="${SOURCE_SITE_URL}"`)) problems.push(`${file} does not link ${SOURCE_SITE_URL}. Rule: the page credits the source of the ideas with a link. Fix: link ${SOURCE_SITE_URL} in the opening paragraph of docs-site-src/exponential-engineering.html.`);
  const text = plainText(html);
  for (const author of SOURCE_AUTHORS) {
    if (!text.includes(author)) problems.push(`${file} does not name ${author}. Rule: the page names both authors of the ideas. Fix: write ${SOURCE_AUTHORS.join(" and ")} in the opening paragraph of docs-site-src/exponential-engineering.html.`);
  }
  return problems;
};

export const conceptPartProblems = (file: string, html: string) => {
  assert(file !== "", `a concept check needs a file name, got an empty one; pass the page path.`);
  assert(typeof html === "string", `${file} must be html text, got ${typeof html}; pass the page body.`);
  if (file !== EXPONENTIAL_PAGE) return [];
  const cards = html.split(CONCEPT_CARD_START).slice(FIRST_CARD_INDEX).map((card) => card.replace(CHECK_CARD, ""));
  const empty = cards.length === 0 ? [`${file} holds no concept card. Rule: the page maps each idea in a card. Fix: add x-feature cards to docs-site-src/exponential-engineering.html.`] : [];
  return [
    ...empty,
    ...cards.flatMap((card) => {
      const terms = [...card.matchAll(DEFINITION_TERM)].map(([, term]) => term);
      const id = CONCEPT_ID.exec(card)?.[1] ?? "unknown";
      return CONCEPT_PARTS.every((part, position) => terms[position] === part)
        ? []
        : [`${file} concept "${id}" has the parts ${JSON.stringify(terms)}. Rule: each concept shows ${CONCEPT_PARTS.join(", ")} in that order. Fix: use those four dt labels in the x-feature of docs-site-src/exponential-engineering.html.`];
    }),
  ];
};

export const citedPathProblems = (file: string, html: string, root: string) => {
  assert(existsSync(root), `cited paths resolve against the repository root ${root}, got none; pass the root.`);
  assert(typeof html === "string", `${file} must be html text, got ${typeof html}; pass the page body.`);
  if (file !== EXPONENTIAL_PAGE) return [];
  const spans = [...html.replace(TERMINAL_FIGURE, "").matchAll(CODE_SPAN)].map(([, text]) => text);
  return [...new Set(spans.filter((span) => REPOSITORY_FILE.test(span) && !existsSync(join(root, span))))].map(
    (path) => `${file} names the file "${path}", which is not a file of the repository. Rule: a file named in code on this page exists. Fix: correct the path in docs-site-src/exponential-engineering.html or restore the file.`,
  );
};

export const exponentialProblems = (files: Map<string, string>, root: string) => {
  assert(files instanceof Map, `the site files are a Map of path to html, got ${typeof files}; pass the map.`);
  assert(existsSync(root), `the page gates resolve against the repository root ${root}, got none; pass the root.`);
  const html = files.get(EXPONENTIAL_PAGE);
  if (html === undefined) return [`${EXPONENTIAL_PAGE} is not a page of the site. Rule: the site credits and maps the exponential engineering ideas. Fix: restore docs-site-src/exponential-engineering.html and its entry in scripts/site/pages.ts.`];
  return [...attributionProblems(EXPONENTIAL_PAGE, html), ...conceptPartProblems(EXPONENTIAL_PAGE, html), ...citedPathProblems(EXPONENTIAL_PAGE, html, root)];
};
