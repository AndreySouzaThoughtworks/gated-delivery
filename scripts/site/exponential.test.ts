import { before, test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { buildSite } from "./build.ts";
import { collectSiteData } from "./data.ts";
import {
  CONCEPT_PARTS,
  EXPONENTIAL_PAGE,
  MIN_COPIED_WORDS,
  SOURCE_AUTHORS,
  SOURCE_SITE_URL,
  attributionProblems,
  citedPathProblems,
  conceptPartProblems,
  copiedRuns,
  exponentialProblems,
  plainText,
  gramsOf,
  wordsOf,
} from "./exponential-gates.ts";
import { factVariables } from "./facts.ts";
import { NAVIGATION } from "./pages.ts";
import { loadChecks } from "./registry.ts";

const REPOSITORY = process.cwd();
const WRONG = 5 as never;
const FRAGMENT = "exponential-engineering.html";
const SOURCE_TEXT_FILE = process.env.EXPONENTIAL_SOURCE_TEXT ?? join(homedir(), ".local/state/gated-delivery/brand-v2/exponentialengineering-text.txt");
const SOURCE_PRESENT = existsSync(SOURCE_TEXT_FILE);
const SKIP_MESSAGE = `the saved source text ${SOURCE_TEXT_FILE} is absent, so the page is not compared with it; set EXPONENTIAL_SOURCE_TEXT to a saved copy of ${SOURCE_SITE_URL} to run this test`;
const SKIPPED_ENTRIES = ["node_modules", "docs-site-src", "docs-site", ".git"];
const TWELVE_WORDS = "a rule that is written once holds for every file and every";
const ELEVEN_WORDS = "a rule that is written once holds for every file and";
const ABSENT_ROOT = join(tmpdir(), "exponential-absent-root");

let page = "";

before(async () => {
  const { files } = await buildSite(REPOSITORY, join(mkdtempSync(join(tmpdir(), "exponential-page-")), "out"), await loadChecks(REPOSITORY));
  page = files.get(EXPONENTIAL_PAGE) ?? "";
});

const plantedRoot = (change: (text: string) => string) => {
  const root = mkdtempSync(join(tmpdir(), "exponential-planted-"));
  assert(root.startsWith(tmpdir()), `a planted site lives under ${tmpdir()}, got ${root}`);
  for (const name of readdirSync(REPOSITORY).filter((entry) => !SKIPPED_ENTRIES.includes(entry))) symlinkSync(join(REPOSITORY, name), join(root, name));
  cpSync(join(REPOSITORY, "docs-site-src"), join(root, "docs-site-src"), { recursive: true });
  const file = join(root, "docs-site-src", FRAGMENT);
  const changed = change(readFileSync(file, "utf8"));
  writeFileSync(file, changed);
  assert.equal(readFileSync(file, "utf8"), changed, `the planted fragment ${FRAGMENT} must hold the change`);
  assert(changed.length > 0, `the planted fragment ${FRAGMENT} must keep some text`);
  return root;
};

const plantedProblems = async (root: string) => {
  assert(root.startsWith(tmpdir()), `a planted site builds under ${tmpdir()}, got ${root}`);
  const { problems } = await buildSite(root, join(root, "docs-site"), await loadChecks(REPOSITORY));
  assert(Array.isArray(problems), `the build returns its problems as a list, got ${typeof problems}`);
  return problems;
};

test("the real page passes every exponential engineering gate", async () => {
  const html = page;
  assert.match(html, /<h1>Exponential engineering<\/h1>/, `the page was built, got ${html.length} characters`);
  assert.deepEqual(exponentialProblems(new Map([[EXPONENTIAL_PAGE, html]]), REPOSITORY), [], "the real page has no problem");
  assert.match(html, /<h2 id="feature-ratchets">/, "the ratchet concept is a card");
});

test("a page without the source link is rejected with file, rule and fix", async () => {
  const html = page.replaceAll(`href="${SOURCE_SITE_URL}"`, 'href="https://example.com/"');
  const problems = attributionProblems(EXPONENTIAL_PAGE, html);
  assert.equal(problems.length, 1, "only the link is missing");
  assert.match(problems[0], /exponential-engineering\.html does not link https:\/\/exponentialengineering\.dev\/\. Rule: .* Fix: link /, "the message names the file, the rule and the fix");
});

test("a page without an author name is rejected for each missing name", async () => {
  const html = page.replaceAll("Fabian Nonnenmacher", "someone").replaceAll("Ben O'Mahony", "someone");
  const problems = attributionProblems(EXPONENTIAL_PAGE, html);
  assert.equal(problems.length, SOURCE_AUTHORS.length, "each author is one problem");
  for (const author of SOURCE_AUTHORS) assert(problems.some((problem) => problem.includes(`does not name ${author}. Rule: `) && problem.includes("Fix: write ")), `${author} is named in a problem`);
});

test("another page needs no attribution", () => {
  assert.deepEqual(attributionProblems("why.html", "<p>no credit</p>"), [], "only the exponential page is checked");
  assert.deepEqual(conceptPartProblems("why.html", "<p>no card</p>"), [], "only the exponential page has concept cards");
  assert.deepEqual(citedPathProblems("why.html", "<code>docs/NOPE.md</code>", REPOSITORY), [], "only the exponential page cites files in code");
});

test("a concept card with a missing or misordered part is rejected", async () => {
  const html = page;
  const withoutProof = html.replace("<dt>Proof</dt>", "<dt>Evidence</dt>");
  assert.match(conceptPartProblems(EXPONENTIAL_PAGE, withoutProof).join("\n"), /concept "[\w-]+" has the parts .*Evidence.* Rule: each concept shows The idea, How this repo applies it, Proof, Where it falls short in that order\. Fix: /, "a renamed part is named");
  assert.equal(conceptPartProblems(EXPONENTIAL_PAGE, "<h1>x</h1>").length, 1, "a page with no card is rejected");
  const lost = CONCEPT_PARTS.filter((part) => part !== "Proof" && !withoutProof.includes(part));
  assert.deepEqual(lost, [], `the planted page keeps every part except Proof, lost ${lost.join(", ")}`);
});

test("a code span that names a missing file is rejected, and a terminal is ignored", () => {
  const missing = citedPathProblems(EXPONENTIAL_PAGE, "<p><code>docs/NOPE.md</code> and <code>docs/NOPE.md</code> and <code>zanity.toml</code></p>", REPOSITORY);
  assert.equal(missing.length, 1, "one missing file is reported once");
  assert.match(missing[0], /names the file "docs\/NOPE\.md", which is not a file of the repository\. Rule: .* Fix: correct the path/, "the message names the file, the rule and the fix");
  assert.deepEqual(citedPathProblems(EXPONENTIAL_PAGE, '<figure class="terminal"><pre><code>docs/NOPE.md</code></pre></figure>', REPOSITORY), [], "terminal output is not a citation");
});

test("the page is absent from the site", () => {
  const problems = exponentialProblems(new Map([["why.html", "<h1>x</h1>"]]), REPOSITORY);
  assert.equal(problems.length, 1, "an absent page is one problem");
  assert.match(problems[0], /exponential-engineering\.html is not a page of the site\. Rule: .* Fix: restore docs-site-src\/exponential-engineering\.html/, "the message names the file, the rule and the fix");
});

test("the build fails when a planted page drops the credit", async () => {
  const root = plantedRoot((text) => text.replaceAll("Ben O'Mahony", "an author").replaceAll("https://exponentialengineering.dev/", "https://example.com/"));
  const problems = (await plantedProblems(root)).join("\n");
  assert.match(problems, /exponential-engineering\.html does not link https:\/\/exponentialengineering\.dev\//, "the build reports the missing link");
  assert.match(problems, /exponential-engineering\.html does not name Ben O'Mahony/, "the build reports the missing author");
});

test("the build fails when a planted card cites a missing file", async () => {
  const root = plantedRoot((text) => text.replace("sources=\"docs/mistakes-to-rules.md scripts/audit/mistakes-table.test.ts", "sources=\"docs/mistakes-to-rules.md scripts/audit/missing-file.ts"));
  assert.match((await plantedProblems(root)).join("\n"), /exponential-engineering\.html feature card "mistake-to-rule" cites "scripts\/audit\/missing-file\.ts"/, "the build reports the card and the path");
});

test("the build fails when planted prose names a missing file in code", async () => {
  const root = plantedRoot((text) => text.replace("<code>docs/mistakes-to-rules.md</code> lists", "<code>docs/absent-table.md</code> lists"));
  assert.match((await plantedProblems(root)).join("\n"), /exponential-engineering\.html names the file "docs\/absent-table\.md"/, "the build reports the file");
});

test("the build fails when planted prose types a count by hand", async () => {
  const root = plantedRoot((text) => text.replace("The rules run as {{checks}} numbered checks", "The rules run as 7 checks"));
  assert.match((await plantedProblems(root)).join("\n"), /exponential-engineering\.html types the count "7 checks" by hand/, "the build reports the typed count");
});

test("the build fails when a planted concept loses its falls-short part", async () => {
  const root = plantedRoot((text) => text.replace("<dt>Where it falls short</dt><dd><ul>\n<li>These checks find counts", "<dt>Notes</dt><dd><ul>\n<li>These checks find counts"));
  assert.match((await plantedProblems(root)).join("\n"), /concept "rot" has the parts .*Notes/, "the build reports the concept");
});

test("the navigation lists the page in the Guide group and the other pages link it", async () => {
  const guide = NAVIGATION.find((entry) => "items" in entry && entry.label === "Guide");
  assert(guide && "items" in guide, "the Guide group exists");
  assert(guide.items.some(({ path }) => path === EXPONENTIAL_PAGE), `the Guide group lists ${EXPONENTIAL_PAGE}, got ${guide.items.map(({ path }) => path).join(", ")}`);
  const { files } = await buildSite(REPOSITORY, join(mkdtempSync(join(tmpdir(), "exponential-nav-")), "out"), await loadChecks(REPOSITORY));
  for (const page of ["index.html", "concepts.html", "features.html"]) assert.match(files.get(page) as string, /<a href="exponential-engineering\.html">Exponential engineering<\/a>/, `${page} links the page`);
});

const BASELINE_VARIABLES = [
  ["zanityBaseline", "zanity-baseline.json"],
  ["messageBaseline", "message-actionability-baseline.json"],
  ["assertionBaseline", "assertion-effectiveness-baseline.json"],
] as const;

test("the baseline variables equal the findings of the baseline files", async () => {
  const variables = factVariables(REPOSITORY);
  for (const [name, file] of BASELINE_VARIABLES) assert.equal(variables[name], JSON.parse(readFileSync(join(REPOSITORY, file), "utf8")).findings.length, `${name} is read from ${file}`);
  assert((await collectSiteData(REPOSITORY)).skills.length > 0, "the site data lists skills");
});

test("the copy detector flags a run of twelve words and ignores eleven", () => {
  const planted = `Some new words here. ${TWELVE_WORDS}. And more new words.`;
  assert.deepEqual(copiedRuns(planted, `Intro. ${TWELVE_WORDS}! Outro.`), [TWELVE_WORDS], "a copied run is returned in full");
  assert.deepEqual(copiedRuns(`Some new words. ${ELEVEN_WORDS}. And more.`, `Intro. ${TWELVE_WORDS}! Outro.`), [], "eleven shared words are a short phrase");
  assert.equal(wordsOf(TWELVE_WORDS).length, MIN_COPIED_WORDS, "the planted run has exactly the limit");
  assert.equal(wordsOf(ELEVEN_WORDS).length, MIN_COPIED_WORDS - 1, "the short run is one word under the limit");
});

test("the copy detector ignores case, tags and entities, and merges a long run", () => {
  const html = `<p>${TWELVE_WORDS.toUpperCase()} &amp; <em>more</em> shared words follow it</p>`;
  const runs = copiedRuns(plainText(html), `${TWELVE_WORDS} more shared words follow it`);
  assert.equal(runs.length, 1, "one long run is one result");
  assert(runs[0].endsWith("follow it"), `the run reaches its last shared word, got ${runs[0]}`);
});

test("the page copies no run of twelve words from the saved source text", { skip: SOURCE_PRESENT ? false : SKIP_MESSAGE }, async () => {
  const source = readFileSync(SOURCE_TEXT_FILE, "utf8");
  assert(wordsOf(source).length > MIN_COPIED_WORDS * 10, `the saved source holds the site text, got ${wordsOf(source).length} words`);
  const text = plainText(page);
  assert.deepEqual(copiedRuns(text, source), [], "no run of twelve words is copied");
  const copied = wordsOf(source).slice(0, MIN_COPIED_WORDS * 2).join(" ");
  const found = copiedRuns(`${text} ${copied}`, source);
  assert(found.length > 0, `the detector finds a planted copy of the real source, got ${found.length} runs`);
});

const GUARDS: [string, () => unknown, RegExp][] = [
  ["plainText rejects non-text", () => plainText(WRONG), /made from html text/],
  ["plainText rejects an empty body", () => plainText(" "), /needs a page body/],
  ["wordsOf rejects non-text", () => wordsOf(WRONG), /read from text, got number/],
  ["wordsOf rejects empty text", () => wordsOf(" "), /got an empty one/],
  ["gramsOf rejects non-words", () => gramsOf(WRONG, 2), /cut from a list of words/],
  ["gramsOf rejects a size of one", () => gramsOf(["a"], 1), /at least 2 words/],
  ["copiedRuns rejects a run of one word", () => copiedRuns("a", "a", 1), /at least 2 words/],
  ["copiedRuns rejects non-text", () => copiedRuns(WRONG, "a b"), /compares two texts/],
  ["attributionProblems rejects an empty file name", () => attributionProblems("", ""), /needs a file name/],
  ["attributionProblems rejects non-text", () => attributionProblems("a.html", WRONG), /must be html text/],
  ["conceptPartProblems rejects an empty file name", () => conceptPartProblems("", ""), /needs a file name/],
  ["conceptPartProblems rejects non-text", () => conceptPartProblems("a.html", WRONG), /must be html text/],
  ["citedPathProblems rejects an absent root", () => citedPathProblems("a.html", "", ABSENT_ROOT), /resolve against the repository root/],
  ["citedPathProblems rejects non-text", () => citedPathProblems("a.html", WRONG, REPOSITORY), /must be html text/],
  ["exponentialProblems rejects a non-map", () => exponentialProblems(WRONG, REPOSITORY), /Map of path to html/],
  ["exponentialProblems rejects an absent root", () => exponentialProblems(new Map(), ABSENT_ROOT), /resolve against the repository root/],
];

for (const [label, call, message] of GUARDS) {
  test(`guard: ${label}`, () => {
    assert.throws(call, message, `${label} must fail with a message that matches ${message}`);
  });
}
