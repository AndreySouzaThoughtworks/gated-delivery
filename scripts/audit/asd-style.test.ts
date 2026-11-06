import { test } from "node:test";
import assert from "node:assert/strict";

import { write } from "../test-support/consistency-fixtures.test.support.ts";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  LONGEST_SENTENCES_SHOWN,
  MAX_SENTENCE_WORDS,
  MIN_SHORT_SENTENCE_PERCENT,
  asdStyleProblems,
  htmlBlocks,
  markdownBlocks,
  sentencesOf,
  sentencesOfBlock,
  shareOf,
  styleDocuments,
} from "./asd-style.ts";

const SHORT_SENTENCE = "Run the check now.";
const sentenceOfWords = (count: number) => {
  assert(Number.isInteger(count) && count > 0, `a sentence needs a positive word count, got ${count}`);
  const sentence = `${Array.from({ length: count }, (_, index) => `word${index}`).join(" ")}.`;
  assert(sentence.split(" ").length === count, `the sentence must hold ${count} words, got ${sentence}`);
  return sentence;
};
const LONG_SENTENCE = sentenceOfWords(MAX_SENTENCE_WORDS + 1);
const SENTENCES_IN_FILE = 100;

const markdownWithShortSentences = (shortCount: number) => {
  assert(shortCount >= 0 && shortCount <= SENTENCES_IN_FILE, `the short count must fit the file, got ${shortCount}`);
  const text = [...Array(shortCount).fill(SHORT_SENTENCE), ...Array(SENTENCES_IN_FILE - shortCount).fill(LONG_SENTENCE)].join("\n\n");
  assert(text.split("\n\n").length === SENTENCES_IN_FILE, `the file must hold ${SENTENCES_IN_FILE} paragraphs, got ${text.split("\n\n").length}`);
  return text;
};

test("a file at the threshold passes and a file one sentence below it is rejected with its share", () => {
  const atThreshold = { file: "docs/a.md", text: markdownWithShortSentences(MIN_SHORT_SENTENCE_PERCENT) };
  const belowThreshold = { file: "docs/a.md", text: markdownWithShortSentences(MIN_SHORT_SENTENCE_PERCENT - 1) };
  assert.deepEqual(asdStyleProblems([atThreshold]), []);
  const [problem] = asdStyleProblems([belowThreshold]);
  assert.match(problem, /^docs\/a\.md has 79% of its 100 sentences within 20 words, below the 80% ASD-STE100 rule\. Hint: split each long sentence/);
});

test("a file of long sentences is rejected and lists only the longest sentences with line numbers", () => {
  const lengths = [21, 22, 23, 24, 25, 26, 27];
  const text = lengths.map((length) => sentenceOfWords(length)).join("\n\n");
  const [problem] = asdStyleProblems([{ file: "README.md", text }]);
  assert.match(problem, /^README\.md has 0% of its 7 sentences/);
  const listed = problem.match(/line \d+ \(\d+ words\)/g) ?? [];
  assert.equal(listed.length, LONGEST_SENTENCES_SHOWN, problem);
  assert.equal(listed[0], "line 13 (27 words)");
  assert.equal(listed[LONGEST_SENTENCES_SHOWN - 1], "line 5 (23 words)");
});

test("a sentence of exactly the word limit is short and one word more is long", () => {
  const share = shareOf({ file: "a.md", text: `${sentenceOfWords(MAX_SENTENCE_WORDS)}\n\n${sentenceOfWords(MAX_SENTENCE_WORDS + 1)}` });
  assert.equal(share.short, 1);
  assert.equal(share.total, 2);
});

test("code blocks, inline code, tables, headings and link targets add no sentences", () => {
  const text = [
    "# A heading that has many many many many many many many many many many many many many many many many many many words",
    "```text",
    sentenceOfWords(30),
    "```",
    "| a | b |",
    `| ${sentenceOfWords(30)} | x |`,
    "Run `a very long inline code span that holds many many many many many many many many many many words` now.",
    `See [the guide](https://example.com/${"long-target-".repeat(30)}) for more.`,
  ].join("\n");
  const sentences = sentencesOf({ file: "a.md", text });
  assert.deepEqual(sentences.map(({ text: sentence }) => sentence), ["Run now.", "See the guide for more."]);
});

test("e.g., i.e. and vs. do not end a sentence, and a period inside a number does not either", () => {
  const sentences = sentencesOf({ file: "a.md", text: "Use a tool, e.g. zanity, i.e. a linter, vs. nothing at Node 22.18 today. Next one." });
  assert.deepEqual(sentences.map(({ words }) => words), [14, 2]);
});

test("each list item is its own sentence and a wrapped paragraph is one", () => {
  const text = "- Install it\n- Run it now\n\nThis paragraph\nwraps over two lines.";
  assert.deepEqual(sentencesOf({ file: "a.md", text }).map(({ text: sentence, line }) => [sentence, line]), [
    ["Install it", 1],
    ["Run it now", 2],
    ["This paragraph\nwraps over two lines.", 4],
  ]);
});

test("a sentence starting on a later line of a paragraph reports that line", () => {
  const sentences = sentencesOf({ file: "a.md", text: "First one.\nSecond one." });
  assert.deepEqual(sentences.map(({ line }) => line), [1, 2]);
});

test("html drops scripts, styles, code, tables, headings and tags, keeps prose and reports source lines", () => {
  const text = [
    "<html><head><style>p { color: red; }</style></head>",
    "<body>",
    `<h1>${sentenceOfWords(30)}</h1>`,
    '<nav><a href="#x">Jump to the very long sentence</a></nav>',
    `<p>Read <a href="https://example.com/${"x".repeat(80)}">the guide</a> and run <code>${sentenceOfWords(30)}</code> now.</p>`,
    `<pre>${sentenceOfWords(30)}</pre>`,
    `<table><tr><td>${sentenceOfWords(30)}</td></tr></table>`,
    "<ul><li>One &amp; two.</li>",
    `<li>${LONG_SENTENCE}</li></ul>`,
    "<script>const a = 1;</script>",
    "</body></html>",
  ].join("\n");
  const sentences = sentencesOf({ file: "docs/guide.html", text });
  assert.deepEqual(sentences.map(({ text: sentence, line }) => [sentence.slice(0, 20), line]), [
    ["Read the guide and r", 5],
    ["One & two.", 8],
    ["word0 word1 word2 wo", 9],
  ]);
});

test("a document with no sentences passes", () => {
  assert.deepEqual(asdStyleProblems([{ file: "a.md", text: "```\ncode only\n```\n" }]), []);
});

test("documents that are not a list are refused", () => {
  assert.throws(() => asdStyleProblems(undefined as never), /documents must be a list/);
});

test("the graded files are the root documents, docs markdown and the guide, and a missing one is skipped", () => {
  const dir = mkdtempSync(join(tmpdir(), "gated-delivery-asd-test-"));
  write(dir, "README.md", "Hi.");
  write(dir, "docs/b.md", "Hi.");
  write(dir, "docs/guide.html", "<p>Hi.</p>");
  write(dir, "docs/notes.txt", "Hi.");
  write(dir, "plugin/skills/x/SKILL.md", "Hi.");
  assert.deepEqual(styleDocuments(dir).map(({ file }) => file), ["README.md", "docs/b.md", "docs/guide.html"]);
});

test("each block function refuses input it cannot grade, naming the fix", () => {
  assert.throws(() => sentencesOfBlock({ text: 1 as never, line: 1 }), /a block needs text/);
  assert.throws(() => sentencesOfBlock({ text: "Hi.", line: 0 }), /must start at a line from 1, got 0/);
  assert.throws(() => markdownBlocks(1 as never), /markdown source must be text/);
  assert.throws(() => markdownBlocks("a\n```\ncode\nmore"), /code fence opened at line 2 never closes/);
  assert.throws(() => htmlBlocks(1 as never), /html source must be text/);
  assert.throws(() => htmlBlocks("<p>a\u0001b</p>"), /reserved control character U\+0001, got it at offset 4/);
});

test("a document without a name or text is refused by every grader", () => {
  const nameless = { file: "", text: "Hi." };
  assert.throws(() => sentencesOf(nameless), /needs a file name/);
  assert.throws(() => sentencesOf({ file: "a.md", text: 1 as never }), /needs text content/);
  assert.throws(() => shareOf(nameless), /needs a file name/);
  assert.throws(() => shareOf({ file: "a.md", text: 1 as never }), /needs text content/);
  assert.throws(() => asdStyleProblems([nameless]), /every document needs a file name/);
});

test("a repository root that is a file is refused", () => {
  const dir = mkdtempSync(join(tmpdir(), "gated-delivery-asd-test-"));
  write(dir, "README.md", "Hi.");
  assert.throws(() => styleDocuments(join(dir, "README.md")), /must be a directory/);
});

test("a repository root that does not exist is refused", () => {
  assert.throws(() => styleDocuments(join(tmpdir(), "gated-delivery-no-such-root")), /must exist/);
});
