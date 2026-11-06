import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { CHECKS } from "../audit/checks-registry.ts";
import { statedCountProblems } from "../audit/site-freshness.ts";
import { buildSite, main } from "./build.ts";
import { collectSiteData, exitCodesOf, guardSectionNumbers, shippedScriptFiles, sourceUsageOf, frontmatter, scriptsCalled, usageOf } from "./data.ts";
import type { SiteData } from "./data.ts";
import { demoOutput, mistakeRows, renderFragment } from "./fragments.ts";
import { coverageProblems, handTypedCountProblems, leakProblems, linkProblems, quotationProblems, renderedCountProblems, siteReport, structureProblems, styleProblems } from "./gates.ts";
import { checkCard, quotation, relativeLink } from "./html.ts";
import type { CheckEntry } from "./html.ts";
import { balanceProblems, tagsOf } from "./markup.ts";
import { loadChecks, validateChecks } from "./registry.ts";

const REPOSITORY = process.cwd();
const TWO_CHECKS: CheckEntry[] = [
  { number: 1, id: "fixture-one", title: "Fixture check one", rule: "A rule with `code`.", fix: "A fix.", example: "ERROR fixture one. Hint: fix it.", mistake: "A fixture mistake.", source: "scripts/audit/consistency.ts" },
  { number: 7, id: "fixture-two", title: "Fixture check two", rule: "Another rule.", fix: "Another fix.", example: "ERROR fixture two. Hint: fix it.", mistake: "Another mistake.", source: "scripts/audit/consistency.ts" },
];
const FIXTURE_CHECKS: CheckEntry[] = [...TWO_CHECKS, ...CHECKS.filter(({ number }) => !TWO_CHECKS.some((fixture) => fixture.number === number))];
const LONG_SENTENCE = "This sentence keeps going with many more words than the plain style allows because it never stops to take a breath and just keeps on adding clause after clause until the reader gets lost.";

const fixtureRoot = () => {
  const root = mkdtempSync(join(tmpdir(), "site-test-"));
  assert(root.startsWith(tmpdir()), `${root} must be a throwaway under ${tmpdir()}`);
  for (const name of ["plugin", "evals", "scripts", "docs", ".github", ".claude-plugin", "tests", "LICENSE", "package.json", "zanity-baseline.json", "message-actionability-baseline.json", "assertion-effectiveness-baseline.json"]) symlinkSync(join(REPOSITORY, name), join(root, name));
  cpSync(join(REPOSITORY, "docs-site-src"), join(root, "docs-site-src"), { recursive: true });
  assert(existsSync(join(root, "docs-site-src", "home.html")), `${root} must hold a copy of the site fragments`);
  return root;
};

const buildWith = async (root: string, fragment: string, appended: string) => {
  const path = join(root, "docs-site-src", fragment);
  assert(existsSync(path), `${path} must exist before a snippet is appended`);
  assert(appended !== "", `a planted snippet for ${fragment} must not be empty`);
  writeFileSync(path, `${readFileSync(path, "utf8")}\n${appended}\n`);
  return (await buildSite(root, join(root, "docs-site"), FIXTURE_CHECKS)).problems;
};

const fixtureLoader = async () => {
  assert(TWO_CHECKS.length === 2, `the fixture registry must hold two rows, got ${TWO_CHECKS.length}`);
  assert(TWO_CHECKS.every(({ source }) => existsSync(join(REPOSITORY, source))), `every fixture source must be a real file under ${REPOSITORY}`);
  return FIXTURE_CHECKS;
};

const emptyData: SiteData = { skills: [], agents: [], commands: [], hooks: [], pluginScripts: [] };

test("the real repository builds clean from the fixture registry", async () => {
  const root = fixtureRoot();
  const { files, problems } = await buildSite(root, join(root, "docs-site"), FIXTURE_CHECKS);
  assert.deepEqual(problems, [], `a clean build must report no problem, got ${problems.join("; ")}`);
  assert(files.has("index.html") && files.has("ci-checks.html"), `the site must hold the home and checks pages, got ${[...files.keys()].join(", ")}`);
  assert.match(files.get("ci-checks.html") as string, /Check 7: Fixture check two/, "the checks page must render the registry rows");
});

test("the real registry renders every row, names the checks that only warn, and a missing registry fails the build", async () => {
  const root = fixtureRoot();
  const real = await loadChecks(root);
  assert.equal(real.length, CHECKS.length, `the loader must return every registry row, got ${real.length} of ${CHECKS.length}`);
  const { files, problems } = await buildSite(root, join(root, "docs-site"), [...real]);
  assert.deepEqual(problems, [], `the real registry must build clean, got ${problems.join("; ")}`);
  const page = files.get("ci-checks.html") as string;
  for (const check of CHECKS) assert(page.includes(`id="check-${check.number}"`), `the checks page must hold a card for check ${check.number}`);
  const [, total, guard, standalone] = /CI runs (\d+) numbered checks: (\d+) inside the consistency guard and (\d+) standalone/.exec(page) as RegExpExecArray;
  assert.equal(Number(total), CHECKS.length, `the page must state the registry row count, got ${total}`);
  assert.equal(Number(guard) + Number(standalone), CHECKS.length, `guard ${guard} and standalone ${standalone} checks must add up to ${CHECKS.length}`);
  assert.equal(Number(guard), guardSectionNumbers(root).length, `the guard count must equal the sections of the guard source, got ${guard}`);
  assert.match(page, /These checks only warn: 7\./, "the page must name the check that only warns, read from the guard source");
  assert.match(page, /The registry has no severity field/, "the page must say that the registry has no severity field");
  assert.equal(await main(["--check"], mkdtempSync(join(tmpdir(), "site-no-registry-"))), 1, "a root with no registry must fail the build");
});

test("planted bad fragments each fail the build with the page, the rule and the fix", async () => {
  const cases: [string, string, RegExp | null][] = [
    ["a hand-typed check count", `<p>CI runs 40 numbered checks.</p>`, /docs-site-src\/home\.html types the count "40 numbered checks" by hand\. Rule: .* Fix: write \{\{checks\}\}/],
    ["a hand-typed Node release", `<p>Use Node 22 today.</p>`, /docs-site-src\/home\.html types the Node release "Node 22" by hand\. Rule: .* Fix: write \{\{nodeFloor\}\}/],
    ["a rule that does not exist", `<x-rule id="no.such-rule"/>`, null],
    ["a hand-typed count", `<p>We ship 5 skills.</p>`, /docs-site-src\/home\.html types the count "5 skills" by hand\. Rule: .* Fix: write \{\{skills\}\}/],
    ["a long sentence", `<p>${LONG_SENTENCE}</p>`.repeat(30), /index\.html has \d+% of its \d+ sentences .* Fix: edit docs-site-src\/home\.html/],
    ["a dead link", `<p><a href="nowhere.html">gone</a></p>`, /index\.html:\d+ links to nowhere\.html, but nowhere\.html is not a page of the site\. Rule: .* Fix:/],
    ["a dead anchor", `<p><a href="concepts.html#nope">gone</a></p>`, /index\.html:\d+ links to concepts\.html#nope, but concepts\.html has no id "nope"\. Rule: .* Fix:/],
    ["a repeated id", `<p id="what">again</p>`, /index\.html:\d+ repeats the id "what"\. Rule: .* Fix:/],
    ["an image with no alt", `<img src="data:,">`, /index\.html:\d+ has an img with no alt attribute\. Rule: .* Fix:/],
    ["a skipped heading level", `<h4 id="skipped">Skipped</h4>`, /index\.html:\d+ jumps from h2 to h4\. Rule: .* Fix:/],
    ["a second h1", `<h1>Another</h1>`, /index\.html has 2 h1 headings\. Rule: .* Fix:/],
    ["an unclosed element", `<div><p>open</p>`, /index\.html:\d+ closes <\/main> but <div> from line \d+ is still open\. Rule: .* Fix:/],
    ["a local path", `<p>See /Users/someone/work.</p>`, /index\.html holds the local path "\/Users\/"\. Rule: .* Fix:/],
    ["an email address", `<p>Write to someone@example.com today.</p>`, /index\.html holds the email address "someone@example\.com"\. Rule: .* Fix:/],
    ["a token", `<p>ghp_${"a".repeat(30)}</p>`, /index\.html holds a string that looks like a secret token\. Rule: .* Fix:/],
    ["an external script", `<script src="https://cdn.example/x.js"></script>`, /index\.html:\d+ loads an external resource through <script>\. Rule: .* Fix:/],
  ];
  for (const [name, snippet, expected] of cases) {
    if (expected === null) {
      await assert.rejects(buildWith(fixtureRoot(), "home.html", snippet), /holds the rule "no\.such-rule"\. Fix: copy an id/, `${name} must stop the build with its fix`);
      continue;
    }
    const problems = await buildWith(fixtureRoot(), "home.html", snippet);
    assert(problems.some((problem) => expected.test(problem)), `${name} must fail the build with ${expected}, got ${JSON.stringify(problems)}`);
  }
});

test("a noreply address is allowed and a plain sentence of plain length passes", async () => {
  const problems = await buildWith(fixtureRoot(), "home.html", `<p>Mail noreply@anthropic.com for nothing.</p>`);
  assert.deepEqual(problems, [], `a noreply address must pass, got ${problems.join("; ")}`);
});

test("a fragment variable, mistake row, demo or check that does not exist fails with its fix", async () => {
  const root = fixtureRoot();
  const context = { root, file: "docs-site-src/x.html", variables: { skills: 12 }, checks: FIXTURE_CHECKS };
  assert.throws(() => renderFragment("{{bogus}}", context), /docs-site-src\/x\.html uses \{\{bogus\}\}, which is not a site variable\. Fix: use one of skills/);
  assert.throws(() => renderFragment(`<x-mistake match="no such mistake zzz"/>`, context), /has no such row\. Fix: copy a phrase/);
  assert.throws(() => renderFragment(`<x-check number="99"/>`, context), /the registry has no such check\. Fix: use a number/);
  assert.throws(() => demoOutput(root, "no-such-demo"), /demo\.json is missing, so the demo "no-such-demo" cannot run\. Fix: add demo\.json/);
  assert.match(renderFragment(`<x-check number="1"/>`, context), /Check 1: Fixture check one/, "an existing check must render as a card");
  assert.match(renderFragment("{{skills}} skills", context), /^12 skills$/, "a known variable must expand");
});

test("the demo output is the real output of the script, including its exit code", () => {
  const output = demoOutput(REPOSITORY, "ticket-lint");
  assert.match(output, /^\$ node ticket-lint\.mjs draft\.md --kind story\n.*required-heading: a story needs the section "## Background"/, "the demo must show the real lint message");
  assert.match(output, /\(exit 1\)$/, "the demo must show the real exit code");
});

test("a fragment that is missing fails the page with its fix", async () => {
  const root = fixtureRoot();
  const path = join(root, "docs-site-src", "home.html");
  unlinkSync(path);
  await assert.rejects(buildSite(root, join(root, "docs-site"), FIXTURE_CHECKS), /home\.html is missing, so the page index\.html cannot render\. Fix: add the fragment file/);
  await assert.rejects(buildSite(join(root, "absent"), join(root, "out"), FIXTURE_CHECKS), /the repository root .* must exist/);
});

test("--check writes nothing to docs-site, a plain build writes it, an unknown flag is a usage error", async () => {
  const root = fixtureRoot();
  const loader = fixtureLoader;
  assert.equal(await main(["--check"], root, loader), 0, "--check must pass on the real repository");
  assert(!existsSync(join(root, "docs-site")), `--check must not write ${join(root, "docs-site")}`);
  assert.equal(await main([], root, loader), 0, "a plain build must pass");
  assert(existsSync(join(root, "docs-site", "index.html")), `a plain build must write ${join(root, "docs-site", "index.html")}`);
  assert.equal(await main(["--bogus"], root, loader), 2, "an unknown flag must exit with the usage code");
  assert.equal(await main(["--check"], root, async () => { throw new Error("registry is missing"); }), 1, "a registry failure must fail the build");
});

test("the registry loader fails when the module is missing and validates the rows", async () => {
  const empty = mkdtempSync(join(tmpdir(), "site-registry-"));
  await assert.rejects(loadChecks(empty), /scripts\/audit\/checks-registry\.ts is missing, so the CI checks page has no source\. Rule: .* Fix:/);
  assert.throws(() => validateChecks([]), /must export a non-empty list of checks/);
  assert.throws(() => validateChecks([{ ...TWO_CHECKS[0], fix: "" }]), /check 1 .* lacks the field "fix"/);
  assert.equal(validateChecks(TWO_CHECKS).length, 2, "valid rows must pass");
});

test("coverage names every skill, agent, command, hook and script that has no place on the site", () => {
  const data: SiteData = {
    skills: [{ name: "alpha", path: "p", description: "d", rules: null, mutation: null, budget: null, inputs: [], sections: [], steps: [], scripts: [], tier: "none", stampedAt: null }],
    agents: [{ name: "bot", path: "p", description: "d", rules: null, mutation: null, budget: null, model: null, tools: null }],
    commands: [{ name: "go", path: "p", description: "d", rules: null, mutation: null, budget: null, allowedTools: null }],
    hooks: [{ file: "h.mjs", path: "p", event: "e", matcher: "m", tested: true }],
    pluginScripts: [{ name: "s.mjs", path: "p", usage: [], exitCodes: [], exitWithoutArguments: 0, group: "shared", usageFrom: "none" }],
  };
  const problems = coverageProblems(data, new Map(), [{ path: "plugin/scripts/s.mjs" }]);
  for (const name of ["skill \"alpha\"", "agent \"bot\"", "command \"go\"", "hook \"h.mjs\"", "plugin script \"s.mjs\""]) {
    assert(problems.some((problem) => problem.startsWith(`${name} is on disk but not on the site`) && problem.includes("Fix:")), `${name} must be reported, got ${JSON.stringify(problems)}`);
  }
  const complete = new Map([["skills/alpha.html", `<h1 id="skill-alpha">`], ["skills/index.html", `<a href="alpha.html">`], ["agents.html", `<h2 id="agent-bot">`], ["commands.html", `<h2 id="command-go">`], ["hooks.html", `<h2 id="hook-h.mjs">`], ["plugin-scripts.html", `<h2 id="script-s.mjs">`]]);
  assert.deepEqual(coverageProblems(data, complete, [{ path: "plugin/scripts/s.mjs" }]), [], "a site that holds every item must pass");
  complete.set("skills/index.html", "");
  assert.match(coverageProblems(data, complete, [])[0], /skill "alpha" has a page but the skills index does not link it/);
  assert.deepEqual(coverageProblems(emptyData, new Map(), []), [], "an empty inventory needs no page");
});

test("a hand-typed count in a fragment is rejected, a variable and a terminal block are not", () => {
  assert.match(handTypedCountProblems("f.html", "<p>12 skills ship.</p>")[0], /f\.html types the count "12 skills" by hand/);
  assert.deepEqual(handTypedCountProblems("f.html", "<p>{{skills}} skills ship.</p>"), [], "a variable must pass");
  assert.deepEqual(handTypedCountProblems("f.html", `<x-terminal title="t">3 checks passed</x-terminal>`), [], "terminal output is real output and must pass");
  assert.throws(() => handTypedCountProblems("", "x"), /a fragment needs a file name/);
});

test("a rendered page of the hand-written kind with a wrong count is rejected, and a check card is left out of the scan", () => {
  const wrong = new Map([["a.html", "<p>7 skills</p>"]]);
  assert.match(renderedCountProblems(wrong, [["skills", 3]])[0], /a\.html says "7 skills", which is not the real count of 3/);
  const card = new Map([["a.html", `<article class="check-card"><p>for example 7 skills</p></article>`]]);
  assert.deepEqual(renderedCountProblems(card, [["skills", 3]]), [], "registry text inside a check card is not a hand-typed count");
  const copied = new Map([["a.html", `<table class="stacked"><tr><td>one page said 23 checks</td></tr></table><p>1 skills</p>`]]);
  assert.equal(renderedCountProblems(copied, [["skills", 3], ["checks", 40]]).length, 1, "rows copied from a repository document are left out, but a sentence is not");
});

test("the shared count logic rejects a wrong count and a non-text body", () => {
  assert.match(statedCountProblems("p.html", "<p>7 skills</p>", [["skills", 3]])[0], /p\.html says "7 skills", which is not the real count of 3/);
  assert.deepEqual(statedCountProblems("p.html", "<p>3 skills</p>", [["skills", 3]]), [], "a true count must pass");
  assert.throws(() => statedCountProblems("p.html", 5 as unknown as string, []), /p\.html must be text to check its counts/);
});

test("quotations must equal their source byte for byte, and only a verified quotation leaves the sentence ratio", () => {
  const firstLine = readFileSync(join(REPOSITORY, "README.md"), "utf8").split("\n")[0];
  assert.deepEqual(quotationProblems("p.html", quotation("README.md", firstLine), REPOSITORY), [], "a real line must verify");
  assert.match(quotationProblems("p.html", quotation("README.md", "Text that the README never holds zzz."), REPOSITORY)[0], /does not hold byte for byte\. Rule: .* Fix:/);
  assert.match(quotationProblems("p.html", quotation("no/such/file.md", "x"), REPOSITORY)[0], /quotes no\/such\/file\.md, which does not exist\. Rule: .* Fix:/);
  const long = `<p>${LONG_SENTENCE}</p>`;
  assert.deepEqual(styleProblems("p.html", `<main>${quotation("README.md", LONG_SENTENCE)}<p>Short one.</p></main>`, "src"), [], "a quotation must leave the ratio");
  assert.match(styleProblems("p.html", `<main>${long}</main>`, "src.html")[0], /p\.html has 0% of its 1 sentences .* Fix: edit src\.html/);
});

test("structure gate accepts a sound page", () => {
  const sound = `<h1 id="a">A</h1><h2 id="b">B</h2><h3 id="c">C</h3><h2 id="d">D</h2><a href="#b">b</a><img src="data:," alt="">`;
  assert.deepEqual(structureProblems("p.html", sound), [], "a sound page must pass");
  assert.deepEqual(balanceProblems("p.html", `<div><p>x</p><br><img alt=""></div><!-- <b> --><script>if (a < b) {}</script>`), [], "void elements, comments and scripts must not unbalance a page");
  assert.match(balanceProblems("p.html", "<div><p>x</div>")[0], /p\.html:1 closes <\/div> but <p> from line 1 is still open/);
  assert.match(balanceProblems("p.html", "</div>")[0], /no element is open/);
  assert.throws(() => tagsOf(5 as unknown as string), /markup must be text/);
});

test("links resolve across folders, and a missing page or anchor is named", () => {
  const files = new Map([["a/one.html", `<a href="../two.html#top">x</a><a href="https://example.org">y</a>`], ["two.html", `<h1 id="top">t</h1>`]]);
  assert.deepEqual(linkProblems(files), [], "a relative link with an anchor must resolve");
  files.set("a/one.html", `<a href="../two.html#gone">x</a><a href="missing.html">y</a>`);
  assert.equal(linkProblems(files).length, 2, "an unknown anchor and an unknown page are two problems");
});

test("leak gate accepts clean text and relative-link markup", () => {
  assert.deepEqual(leakProblems("p.html", "<p>Plain text with noreply@anthropic.com</p>"), [], "clean text must pass");
  assert.match(leakProblems("p.html", "<style>@import url(https://x.example/a.css);</style>")[0], /loads a style from outside/);
});

test("data helpers parse frontmatter, usage and exit codes, and reject bad input", () => {
  assert.deepEqual(frontmatter("---\nname: a\ndescription: Does a thing.\n---\nbody", "a.md"), { name: "a", description: "Does a thing." });
  assert.throws(() => frontmatter("no block", "a.md"), /a\.md must open with a --- frontmatter block/);
  assert.throws(() => frontmatter("---\nname: a\n---\n", "a.md"), /a\.md must set a description/);
  assert.deepEqual(exitCodesOf("const EXIT_OK = 0;\nconst EXIT_NEEDS_TICKET = 1;\n"), [{ code: 0, name: "ok" }, { code: 1, name: "needs ticket" }]);
  assert.deepEqual(usageOf("oops\nusage: x <a>\n       x <b>\nnext", ""), ["usage: x <a>", "       x <b>"]);
  assert.deepEqual(usageOf("", `const USAGE = "usage: y [--z]";`), ["usage: y [--z]"]);
  assert.deepEqual(usageOf("", "nothing"), []);
  assert.deepEqual(scriptsCalled("run `plugin/scripts/a.mjs` and b.mjs", new Map([["a.mjs", "plugin/scripts/a.mjs"]])), ["plugin/scripts/a.mjs"]);
  assert.deepEqual(mistakeRows("| h1 | h2 | h3 |\n|---|---|---|\n| a | b | c |\n").at(-1), ["a", "b", "c"]);
});

test("the collected data matches the plugin on disk", async () => {
  const data = await collectSiteData(REPOSITORY);
  assert(data.skills.length > 0 && data.agents.length > 0 && data.commands.length > 0 && data.hooks.length > 0, `the plugin must list skills, agents, commands and hooks, got ${data.skills.length}, ${data.agents.length}, ${data.commands.length}, ${data.hooks.length}`);
  assert(data.pluginScripts.every((script) => script.exitWithoutArguments !== -1), `every script must run with no arguments, got ${JSON.stringify(data.pluginScripts.filter((script) => script.exitWithoutArguments === -1).map((script) => script.name))}`);
  assert(data.skills.every((skill) => skill.rules === null || (skill.mutation !== null && skill.mutation.killed <= skill.mutation.total)), `a skill with rules must carry a mutation score, got ${JSON.stringify(data.skills.filter((skill) => skill.rules !== null && skill.mutation === null).map((skill) => skill.name))}`);
  await assert.rejects(collectSiteData(mkdtempSync(join(tmpdir(), "site-empty-"))), /must hold plugin\/, got none/);
});

test("helpers render relative links, cards and the report", () => {
  assert.equal(relativeLink("skills/a.html", "index.html"), "../index.html");
  assert.equal(relativeLink("index.html", "skills/a.html"), "skills/a.html");
  assert.throws(() => relativeLink("/a.html", "b.html"), /page paths must be relative to the site root/);
  assert.match(checkCard(TWO_CHECKS[0]), /<code>code<\/code>/, "a card must render inline code");
  assert.match(siteReport(new Map([["a.html", "<p>Short.</p>"]]))[0], /site: 1 pages, \d+ bytes in total, largest a\.html/);
});

test("every script file on disk is listed, a planted one is reported by name, and usage comes from the source when no run prints it", () => {
  const root = mkdtempSync(join(tmpdir(), "site-scripts-tree-"));
  const planted: [string, string][] = [
    ["plugin/scripts/a.mjs", "export {};\n"],
    ["plugin/scripts/a.test.mjs", "export {};\n"],
    ["plugin/scripts/fixtures/stub.mjs", "export {};\n"],
    ["plugin/skills/alpha/scripts/b.sh", "#!/usr/bin/env bash\n# Usage: b.sh <x>\n"],
    ["plugin/bootstrap/guards/c.mjs", "export {};\n"],
    ["plugin/hooks/h.mjs", "export {};\n"],
  ];
  for (const [path, body] of planted) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), body);
  }
  assert.deepEqual(shippedScriptFiles(root).map(({ path, group }) => `${group}:${path}`), ["bootstrap:plugin/bootstrap/guards/c.mjs", "shared:plugin/scripts/a.mjs", "skill:plugin/skills/alpha/scripts/b.sh"]);
  const rendered = new Map([["plugin-scripts.html", `<h3 id="script-a.mjs">a</h3><h3 id="script-c.mjs">c</h3>`]]);
  const problems = coverageProblems(emptyData, rendered, shippedScriptFiles(root));
  assert.equal(problems.length, 1, `exactly the planted shell script is missing, got ${JSON.stringify(problems)}`);
  assert.match(problems[0], /plugin script "b\.sh" is on disk but not on the site/);
  assert.deepEqual(sourceUsageOf("#!/usr/bin/env bash\n# Usage: b.sh <x>\n"), ["usage: b.sh <x>"]);
  assert.deepEqual(sourceUsageOf('const USAGE = "usage: node t.mjs <a>";\n'), ["usage: node t.mjs <a>"]);
  assert.deepEqual(sourceUsageOf("#!/usr/bin/env bash\n# Shared helper.\n# Source it.\n\ncode\n"), ["Shared helper.", "Source it."]);
  assert.deepEqual(sourceUsageOf("export {};\n"), []);
});
