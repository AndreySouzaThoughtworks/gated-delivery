import { test } from "node:test";
import assert from "node:assert/strict";

import { write, validRepo, runGuard } from "../test-support/consistency-fixtures.test.support.ts";
import { SITE_URL, siteFreshnessProblems, statedCountProblems } from "./site-freshness.ts";
import { MAX_SENTENCE_WORDS } from "./asd-style.ts";

const LINKING_README = `Read the [site](${SITE_URL}).`;
const FRESH = { buildScriptPresent: true, sourcesPresent: true, readme: LINKING_README };
const longSentence = `${Array.from({ length: MAX_SENTENCE_WORDS + 1 }, (_, index) => `word${index}`).join(" ")}.`;

test("a README that links the site, with the build script and the sources present, passes", () => {
  assert.deepEqual(siteFreshnessProblems(FRESH), []);
});

test("a missing build script is reported with the file, the rule and the fix", () => {
  assert.deepEqual(siteFreshnessProblems({ ...FRESH, buildScriptPresent: false }), [
    "scripts/site/build.ts is missing. Rule: the README links a site that this script builds. Fix: restore the script.",
  ]);
});

test("a missing sources folder is reported with the folder, the rule and the fix", () => {
  assert.deepEqual(siteFreshnessProblems({ ...FRESH, sourcesPresent: false }), [
    "docs-site-src/ is missing. Rule: the site pages come from these sources. Fix: restore the folder.",
  ]);
});

test("a README without the site link is reported, and the old guide link does not count", () => {
  const expected = [`README.md does not link ${SITE_URL}. Rule: the README sends readers to the site. Fix: add a link to it.`];
  assert.deepEqual(siteFreshnessProblems({ ...FRESH, readme: "No link here." }), expected);
  assert.deepEqual(siteFreshnessProblems({ ...FRESH, readme: "Read the [guide](docs/guide.html)." }), expected);
});

test("every missing part is reported once", () => {
  assert.equal(siteFreshnessProblems({ buildScriptPresent: false, sourcesPresent: false, readme: "" }).length, 3);
});

test("input that is not a README text or a pair of booleans is refused", () => {
  assert.throws(() => siteFreshnessProblems({ ...FRESH, readme: undefined as never }), /README must be text/);
  assert.throws(() => siteFreshnessProblems({ ...FRESH, sourcesPresent: "yes" as never }), /present or not, got boolean and string/);
});

test("a count that differs from the real one is reported for each kind", () => {
  const page = "<p>3 skills, 5 agents, 4 commands, 1 hooks.</p>";
  const counted: [string, number][] = [["skills", 2], ["agents", 1], ["commands", 1], ["hooks", 2]];
  assert.deepEqual(statedCountProblems("page.html", page, counted), [
    'page.html says "3 skills", which is not the real count of 2. Hint: change it to "2 skills".',
    'page.html says "5 agents", which is not the real count of 1. Hint: change it to "1 agents".',
    'page.html says "4 commands", which is not the real count of 1. Hint: change it to "1 commands".',
    'page.html says "1 hooks", which is not the real count of 2. Hint: change it to "2 hooks".',
  ]);
});

test("a count inside a quoted output block is not a statement, one in prose is", () => {
  const counted: [string, number][] = [["skills", 2]];
  const quoted = '<pre><code>README.md says "5 skills"</code></pre>';
  assert.deepEqual(statedCountProblems("page.html", quoted, counted), []);
  assert.equal(statedCountProblems("page.html", `${quoted}<p>It has 5 skills.</p>`, counted).length, 1);
});

test("a count check refuses a text that is not text or counts that are not a list", () => {
  assert.throws(() => statedCountProblems("page.html", undefined as never, []), /must be text to check its counts/);
  assert.throws(() => statedCountProblems("page.html", "x", "no" as never), /needs a list of \[label, count\] pairs/);
});

const repoWithGuardScripts = ({ buildScript = true, sources = true } = {}) => {
  const dir = validRepo();
  assert(dir.length > 0, `the fixture needs a directory, got ${dir}`);
  write(dir, "scripts/audit/asd-style.ts", "");
  write(dir, "scripts/audit/site-freshness.ts", "");
  if (buildScript) write(dir, "scripts/site/build.ts", "");
  if (sources) write(dir, "docs-site-src/home.html", "<h1>Home</h1>");
  write(dir, "README.md", `The plugin — 1 skills, 1 agents, 1 hooks. Read the [site](${SITE_URL}).\n\n[MIT](LICENSE)\n`);
  assert(dir.startsWith("/") || dir.includes(":"), `the fixture must be an absolute path, got ${dir}`);
  return dir;
};

test("the guard accepts a repo with the site files and a README that links the site", () => {
  const { code, out } = runGuard(repoWithGuardScripts());
  assert.equal(code, 0, out);
});

test("the guard rejects a repo whose README does not link the site", () => {
  const dir = repoWithGuardScripts();
  write(dir, "README.md", "The plugin — 1 skills, 1 agents, 1 hooks.\n\n[MIT](LICENSE)\n");
  const { code, out } = runGuard(dir);
  assert.equal(code, 1, out);
  assert.match(out, /README\.md does not link https:\/\/andrey1souza\.github\.io\/gated-delivery\/\. Rule: .* Fix:/);
});

test("the guard rejects a repo with no site build script, and one with no site sources", () => {
  const noScript = runGuard(repoWithGuardScripts({ buildScript: false }));
  assert.equal(noScript.code, 1, noScript.out);
  assert.match(noScript.out, /scripts\/site\/build\.ts is missing\. Rule: .* Fix:/);
  const noSources = runGuard(repoWithGuardScripts({ sources: false }));
  assert.equal(noSources.code, 1, noSources.out);
  assert.match(noSources.out, /docs-site-src\/ is missing\. Rule: .* Fix:/);
});

test("the guard rejects a README that holds mostly long sentences", () => {
  const dir = repoWithGuardScripts();
  write(dir, "README.md", `The plugin — 1 skills, 1 agents, 1 hooks. Read the [site](${SITE_URL}).\n\n${longSentence}\n\n[MIT](LICENSE)\n`);
  const { code, out } = runGuard(dir);
  assert.equal(code, 1, out);
  assert.match(out, /README\.md has 75% of its 4 sentences within 20 words, below the 80% ASD-STE100 rule\. Hint: split each long sentence/);
});
