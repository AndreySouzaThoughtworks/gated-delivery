import { test } from "node:test";
import assert from "node:assert/strict";
import type { SpawnSyncOptions, SpawnSyncReturns } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ORDINARY_PHRASES, TICS, parseArguments, scanText } from "../../plugin/skills/prose-writing/scripts/prose-scan.mjs";
import { runScript } from "../../plugin/scripts/run-cli.test.support.mjs";
import { assertActionable, assertEveryLineActionable, assertErrorMatchesActionable } from "../test-support/actionable.test.support.ts";

const SCAN = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "plugin", "skills", "prose-writing", "scripts", "prose-scan.mjs");
const scan = (args: string[], options: SpawnSyncOptions = {}) => {
  assert(args.every((argument) => typeof argument === "string"), `the arguments must be strings, got ${JSON.stringify(args)}`);
  const result = runScript(SCAN, args, options) as SpawnSyncReturns<string>;
  assert(typeof result.stdout === "string", `the scan must return text output, got ${typeof result.stdout}`);
  return result;
};
const SENTENCE_LIMIT = 8;
const LONG_SENTENCE = "The importer retries every failed batch three times before it writes the batch to the dead letter folder.";

const PATTERN_SAMPLES: Record<string, string> = {
  "it['’]s not [^,.;]+, it": "It's not a cache, it is a queue.",
  "not an? [^,.;]* but ": "This is not a patch for the parser but a rewrite.",
  "yes, and it['’]s worth": "Yes, and it's worth the extra hour.",
};

const fileWith = (body: string) => {
  assert(typeof body === "string", `a draft needs text content, got ${typeof body}`);
  const file = join(mkdtempSync(join(tmpdir(), "prose-scan-")), "draft.md");
  writeFileSync(file, body);
  assert(existsSync(file), `the draft ${file} must exist after the write`);
  return file;
};

test("every phrase of every tic category is rejected with its own fix", () => {
  for (const group of TICS) {
    for (const phrase of group.phrases) {
      const hits = scanText(`Plain words, then ${phrase} appears here.`);
      assert(hits.length === 1 && hits[0].fix === group.fix, `${group.category} phrase ${JSON.stringify(phrase)} must give one hit with its fix, got ${JSON.stringify(hits)}`);
    }
    for (const pattern of group.patterns) {
      const sample = PATTERN_SAMPLES[pattern];
      assert(sample !== undefined, `the ${group.category} pattern ${JSON.stringify(pattern)} needs a sample in PATTERN_SAMPLES; add one.`);
      const hits = scanText(sample);
      assert(hits.some((hit) => hit.fix === group.fix), `${group.category} pattern ${JSON.stringify(pattern)} must hit ${JSON.stringify(sample)}, got ${JSON.stringify(hits)}`);
    }
  }
});

test("every ordinary phrase is one the tic list holds", () => {
  const listed = TICS.flatMap((group) => group.phrases);
  for (const phrase of ORDINARY_PHRASES) assert(listed.includes(phrase), `the ordinary phrase ${JSON.stringify(phrase)} must also be a tic phrase, got ${JSON.stringify(listed)}`);
});

test("the command line reports each category as an actionable file:line message and exits 1", () => {
  for (const group of TICS) {
    const sample = group.phrases[0] ?? PATTERN_SAMPLES[group.patterns[0]];
    const file = fileWith(`fine\n${sample}\n`);
    const result = scan([file]);
    assert.equal(result.status, 1, `${group.category} must exit 1, got ${result.status}: ${result.stderr}`);
    assert(result.stdout.startsWith(`${file}:2: tic "`) && result.stdout.includes(`" is not allowed; fix: ${group.fix}\n`), `${group.category} must print file:line: tic "text" is not allowed; fix: ..., got ${result.stdout}`);
    assertEveryLineActionable(result.stdout);
  }
});

test("clean prose exits 0 and prints nothing", () => {
  const file = fileWith("The importer retries a failed batch three times.\nIt writes the batch to the dead-letter folder.\n");
  const result = scan([file]);
  assert.deepEqual([result.status, result.stdout, result.stderr], [0, "", ""], "clean prose must exit 0 without output");
});

test("a phrase inside a longer word or a hyphenated word is not a tic", () => {
  assert.deepEqual(scanText("The dishonestly named helper does nothing and is non-load-bearing."), [], "a tic only counts as a whole word");
});

test("fenced code, tilde fences and inline code are skipped, prose after a fence is scanned", () => {
  const text = ["```bash", "grep -E 'rather than|instead of' file", "```", "~~~", "worth noting", "~~~", "Run `grep rather than` first.", "Then it is worth noting the result."].join("\n");
  const hits = scanText(text);
  assert.deepEqual(hits.map(({ line, text: hit }) => [line, hit]), [[8, "worth noting"]], "only the prose line after the fences hits");
});

test("a hit reports the one-based line and the matched text", () => {
  assert.deepEqual(scanText("fine\n\nInstead of a retry, we log.").map(({ line, kind, text }) => [line, kind, text]), [[3, "tic", "Instead of"]], "the line is 3 and the text keeps its case");
});

test("sentence length is off by default and flagged with the option", () => {
  const file = fileWith(`${LONG_SENTENCE}\n`);
  const off = scan([file]);
  assert.deepEqual([off.status, off.stdout], [0, ""], "no flag, no sentence check");
  const on = scan([file, "--max-sentence-words", String(SENTENCE_LIMIT)]);
  assert.equal(on.status, 1, `a long sentence must exit 1 with the flag, got ${on.status}`);
  assert(on.stdout.includes(`${file}:1: long sentence "18 words: The importer retries every failed batch ...`) && on.stdout.includes(`no sentence may run past ${SENTENCE_LIMIT} words`), `the long sentence must be reported with its count, got ${on.stdout}`);
  assertEveryLineActionable(on.stdout);
});

test("a sentence at the limit, a heading, a table row and a list marker are measured correctly", () => {
  const atLimit = "One two three four five six seven eight.";
  assert.deepEqual(scanText(atLimit, { maxSentenceWords: SENTENCE_LIMIT }), [], "a sentence of exactly the limit is accepted");
  assert.equal(scanText(`- ${LONG_SENTENCE}`, { maxSentenceWords: 18 }).length, 0, "the list marker is not a word");
  assert.equal(scanText(`- ${LONG_SENTENCE}`, { maxSentenceWords: 17 }).length, 1, "one word over the limit is flagged");
  assert.deepEqual(scanText(`# ${LONG_SENTENCE}\n| ${LONG_SENTENCE} |`, { maxSentenceWords: SENTENCE_LIMIT }), [], "headings and table rows are not sentences");
  assert.equal(scanText(`Short one. ${LONG_SENTENCE} Short two.`, { maxSentenceWords: SENTENCE_LIMIT }).length, 1, "each sentence is measured alone");
});

test("standard input is scanned under the stdin label", () => {
  const result = scan(["-"], { input: "It is worth noting the retry.\n" });
  assert.equal(result.status, 1, `stdin hits must exit 1, got ${result.status}`);
  assert(result.stdout.startsWith('<stdin>:1: tic "worth noting" is not allowed; fix: '), `stdin hits must use the stdin label, got ${result.stdout}`);
});

test("bad usage exits 2 with an actionable message", () => {
  const file = fileWith("fine\n");
  const bad: string[][] = [[], [file, file], [file, "--max-sentence-words"], [file, "--max-sentence-words", "0"], [file, "--max-sentence-words", "abc"], [file, "--max-sentence-words", "2.5"], ["--max-sentence-words", "5"]];
  for (const args of bad) {
    const result = scan(args);
    assert.equal(result.status, 2, `${JSON.stringify(args)} must exit 2, got ${result.status}: ${result.stdout}`);
    assertActionable(result.stderr.trim());
  }
  const missing = scan([join(dirname(file), "absent.md")]);
  assert.equal(missing.status, 2, `an unreadable file must exit 2, got ${missing.status}`);
  assertActionable(missing.stderr.trim());
});

test("the scan refuses input it cannot measure", () => {
  const scan = scanText as (text: unknown, options?: unknown) => unknown;
  assertErrorMatchesActionable(() => scan(Buffer.from("hello")), /the .text. to scan must be a string, got object/);
  for (const limit of [0, -3, 2.5, "20"]) assertErrorMatchesActionable(() => scan("hello", { maxSentenceWords: limit }), /.maxSentenceWords. must be a positive whole number/);
  const parse = parseArguments as (args: unknown) => unknown;
  assertErrorMatchesActionable(() => parse("file.md"), /the .args. must be a list, got string/);
  assertErrorMatchesActionable(() => parse(["file.md", 7]), /every item of .args. must be a string/);
  assert.deepEqual(parseArguments(["a.md", "--max-sentence-words", "20"]), { source: "a.md", maxSentenceWords: 20 }, "the option may follow the file");
  assert.deepEqual(parseArguments(["--max-sentence-words", "20", "a.md"]), { source: "a.md", maxSentenceWords: 20 }, "the option may precede the file");
  assert.deepEqual(parseArguments(["a.md"]), { source: "a.md", maxSentenceWords: undefined }, "the option is off by default");
});
