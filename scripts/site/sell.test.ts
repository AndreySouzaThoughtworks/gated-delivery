import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSite } from "./build.ts";
import { NAVIGATION, siteVariables } from "./pages.ts";
import { loadChecks } from "./registry.ts";
import { collectSiteData } from "./data.ts";
import { PINNED_CONTENT, diagramProblems, featureCardProblems, lockupProblems, missingSources, pinnedContentProblems } from "./sell-gates.ts";
import { DIAGRAMS_DIRECTORY, diagramFigure, featureCard, linkLine, sourceLine, sourcePaths } from "./sell.ts";
import { layout } from "./html.ts";

const REPOSITORY = process.cwd();
const WRONG = 5 as never;
const FIXTURE_ENTRIES = ["plugin", "evals", "scripts", "docs", ".github", ".claude-plugin", "tests", "LICENSE", "package.json", "zanity-baseline.json", "message-actionability-baseline.json", "assertion-effectiveness-baseline.json"];
const REAL_SOURCE = "plugin/skills/spec/SKILL.md";
const CARD_PARTS = "<dl><dt>Problem</dt><dd>x</dd></dl>";
const SVG_HEAD = '<svg viewBox="0 0 10 10" role="img"><title>T</title><desc>D</desc>';
const figureOf = (inner: string, sources = REAL_SOURCE) => {
  assert(inner.includes("<svg"), `a figure wraps an svg, got ${inner.slice(0, 40)}`);
  assert(typeof sources === "string", `sources are text, got ${typeof sources}`);
  return `<figure class="diagram" data-sources="${sources}"><div class="diagram-panels">${inner}</div></figure>`;
};
const cardOf = (sources: string) => {
  assert(typeof sources === "string", `sources are text, got ${typeof sources}`);
  assert(!sources.includes('"'), `sources sit in an attribute, got ${sources}`);
  return `<article class="feature" data-sources="${sources}"><h2 id="feature-demo">Demo</h2></article>`;
};

const plantedRoot = (fragment: string, change: (text: string) => string) => {
  const root = mkdtempSync(join(tmpdir(), "sell-planted-"));
  assert(root.startsWith(tmpdir()), `a planted site lives under ${tmpdir()}, got ${root}`);
  for (const name of FIXTURE_ENTRIES) symlinkSync(join(REPOSITORY, name), join(root, name));
  cpSync(join(REPOSITORY, "docs-site-src"), join(root, "docs-site-src"), { recursive: true });
  const file = join(root, "docs-site-src", fragment);
  const changed = change(readFileSync(file, "utf8"));
  assert(changed.length > 0, `the planted fragment ${fragment} must keep some text`);
  writeFileSync(file, changed);
  assert.equal(readFileSync(file, "utf8"), changed, `the planted fragment ${fragment} must hold the change`);
  return root;
};

const problemsOf = async (root: string) => {
  assert(root.startsWith(tmpdir()), `a planted site builds under ${tmpdir()}, got ${root}`);
  const { problems } = await buildSite(root, join(root, "docs-site"), await loadChecks(REPOSITORY));
  assert(Array.isArray(problems), `the build returns its problems as a list, got ${typeof problems}`);
  return problems.join("\n");
};

test("a feature card cites real files and names its parts", () => {
  const html = featureCard({ id: "demo", title: "Demo", sources: REAL_SOURCE, links: "skills/spec.html|The spec skill" }, CARD_PARTS);
  assert.match(html, /<h2 id="feature-demo">Demo<\/h2>/, "the card heading carries the id");
  assert.match(html, /data-sources="plugin\/skills\/spec\/SKILL\.md"/, "the card records its sources");
  assert.deepEqual(featureCardProblems("features.html", html, REPOSITORY), [], "a card with a real source passes");
});

test("a feature card that cites a missing file is rejected with file, rule and fix", () => {
  const problems = featureCardProblems("features.html", cardOf("plugin/skills/spec/NOPE.md"), REPOSITORY);
  assert.equal(problems.length, 1, "one missing source gives one problem");
  assert.match(problems[0], /features\.html feature card "demo" cites "plugin\/skills\/spec\/NOPE\.md".* Rule: .* Fix: /, "the message names the file, the rule and the fix");
});

test("a feature card rejects an empty, absolute or parent source", () => {
  for (const bad of ["", "/etc/hosts", "../outside.md"]) assert.equal(featureCardProblems("f.html", cardOf(bad), REPOSITORY).length, 1, `"${bad}" is not a repository file`);
});

test("a diagram with a title, a description and variable colours passes", () => {
  const svg = `${SVG_HEAD}<rect class="dg-box" fill="var(--surface)" stroke="none"/></svg>`;
  assert.deepEqual(diagramProblems("a.html", figureOf(svg), REPOSITORY), [], "a clean diagram passes");
});

test("a diagram without a title or a description is rejected", () => {
  const noTitle = '<svg role="img"><desc>D</desc></svg>';
  const noDesc = '<svg role="img"><title>T</title></svg>';
  assert.match(diagramProblems("a.html", figureOf(noTitle), REPOSITORY).join("\n"), /no <title>.* Fix: add <title>/, "a missing title is named");
  assert.match(diagramProblems("a.html", figureOf(noDesc), REPOSITORY).join("\n"), /no <desc>.* Fix: add <desc>/, "a missing description is named");
});

test("a diagram with a hard-coded colour is rejected in every spelling", () => {
  for (const bad of ['<rect fill="#ff0000"/>', '<rect stroke="red"/>', '<rect style="fill:blue"/>', '<text fill="rgb(1,2,3)">x</text>']) {
    const problems = diagramProblems("a.html", figureOf(`${SVG_HEAD}${bad}</svg>`), REPOSITORY);
    assert.match(problems.join("\n"), /hard-coded colour.* Fix: use a dg- class/, `${bad} must be rejected`);
  }
});

test("a diagram that cites a missing file is rejected", () => {
  assert.match(diagramProblems("a.html", figureOf(`${SVG_HEAD}</svg>`, "docs/NOPE.md"), REPOSITORY).join("\n"), /diagram cites "docs\/NOPE\.md"/, "the missing source is named");
});

test("every shipped diagram passes the diagram gate", () => {
  for (const name of ["slice-batch", "slice-end", "waves", "rounds", "trust-ladder", "handoff-lifecycle"]) {
    const html = diagramFigure(REPOSITORY, name, "Caption.", REAL_SOURCE);
    assert.deepEqual(diagramProblems(`${name}.html`, html, REPOSITORY), [], `${name} passes the gate`);
    assert.match(html, /<title id="[\w-]+-title">/, `${name} has a title`);
  }
});

test("the home page shows the brand once, above the footer", () => {
  assert.deepEqual(lockupProblems("index.html", '<a class="brand" href="x">g</a><footer></footer>'), [], "one lockup passes");
  const doubled = '<a class="brand" href="x">g</a><p class="hero-lockup">g</p><footer><a class="brand">g</a></footer>';
  assert.match(lockupProblems("index.html", doubled)[0], /shows 2 brand lockups.* Fix: remove the extra lockup/, "a second lockup is rejected");
  assert.deepEqual(lockupProblems("why.html", doubled), [], "other pages are not counted");
});

test("the pinned cards and concept headings stay in the real fragments", () => {
  const fragments = PINNED_CONTENT.map(({ file }) => ({ file, text: readFileSync(join(REPOSITORY, file), "utf8") }));
  assert.deepEqual(pinnedContentProblems(fragments), [], "the real fragments hold every pinned part");
  const pinned = PINNED_CONTENT.flatMap(({ parts }) => parts);
  assert(pinned.length >= 10, `the pin list covers three cards and six headings, got ${pinned.length} parts`);
});

test("a deleted card or heading is rejected by name", () => {
  const home = readFileSync(join(REPOSITORY, "docs-site-src/home.html"), "utf8").replace("<strong>Rules that can fail.</strong>", "");
  const concepts = readFileSync(join(REPOSITORY, "docs-site-src/concepts.html"), "utf8").replace('id="not-verified"', 'id="gone"');
  const problems = pinnedContentProblems([{ file: "docs-site-src/home.html", text: home }, { file: "docs-site-src/concepts.html", text: concepts }]);
  assert.equal(problems.length, 2, "each deletion is one problem");
  assert.match(problems.join("\n"), /home\.html lost the pinned content <strong>Rules that can fail\.<\/strong>.* Fix: restore the text/, "the card is named");
  assert.match(problems.join("\n"), /concepts\.html lost the pinned content <h2 id="not-verified">/, "the heading is named");
});

test("the build fails when a planted card cites a missing file", async () => {
  const root = plantedRoot("features.html", (text) => text.replace("plugin/.claude-plugin/plugin.json", "plugin/missing-file.json"));
  assert.match(await problemsOf(root), /features\.html feature card "shared-plugin" cites "plugin\/missing-file\.json"/, "the build reports the card and the path");
});

test("the build fails when a planted lockup doubles the brand on the home page", async () => {
  const root = plantedRoot("home.html", (text) => text.replace('<h1 id="hero-title">', '<p class="hero-lockup">gated-delivery</p><h1 id="hero-title">'));
  assert.match(await problemsOf(root), /index\.html shows 2 brand lockups/, "the build reports the second lockup");
});

test("the build fails when a planted edit deletes a home card", async () => {
  const root = plantedRoot("home.html", (text) => text.replace("<strong>Honest evidence.</strong>", "<strong>Evidence.</strong>"));
  assert.match(await problemsOf(root), /home\.html lost the pinned content <strong>Honest evidence\.<\/strong>/, "the build reports the lost card");
});

test("the build fails when a planted diagram holds a hex colour", async () => {
  const root = plantedRoot("home.html", (text) => text);
  const svg = join(root, DIAGRAMS_DIRECTORY, "slice-batch.svg");
  writeFileSync(svg, readFileSync(svg, "utf8").replace('class="dg-arrow"', 'fill="#123456" class="dg-arrow"'));
  assert.match(await problemsOf(root), /hard-coded colour/, "the build reports the hex colour");
});

test("the navigation lists Why and Features in the Guide group and the pages exist", async () => {
  const guide = NAVIGATION.find((entry) => "items" in entry && entry.label === "Guide");
  assert(guide && "items" in guide, "the Guide group exists");
  assert.deepEqual(guide.items.slice(0, 2).map(({ path }) => path), ["why.html", "features.html"], "Why and Features lead the Guide group");
  const { files } = await buildSite(REPOSITORY, join(mkdtempSync(join(tmpdir(), "sell-nav-")), "out"), await loadChecks(REPOSITORY));
  assert.match(files.get("why.html") as string, /<a href="why\.html" aria-current="page">Why<\/a>/, "the Why page marks itself current");
  assert.match(files.get("features.html") as string, /<a href="features\.html" aria-current="page">Features<\/a>/, "the Features page marks itself current");
  assert.match(files.get("index.html") as string, /<a href="why\.html">Why gated-delivery<\/a>/, "the home page links Why");
});

test("the evidence strip variables count the mutation scores", async () => {
  const data = await collectSiteData(REPOSITORY);
  const variables = siteVariables(data, await loadChecks(REPOSITORY), []);
  assert(variables.mutationScored > 0, `some inventories are scored, got ${variables.mutationScored}`);
  assert(variables.mutationPerfect <= variables.mutationScored, `perfect scores are a part of the scored ones, got ${variables.mutationPerfect} of ${variables.mutationScored}`);
  const half = siteVariables({ ...data, skills: data.skills.map((skill) => ({ ...skill, mutation: skill.mutation && { ...skill.mutation, killed: skill.mutation.total - 1 } })) }, await loadChecks(REPOSITORY), []);
  assert(half.mutationPerfect < variables.mutationPerfect, `a survivor removes an inventory from the perfect count, got ${half.mutationPerfect} against ${variables.mutationPerfect}`);
});

test("the layout leaves the table of contents off a hero page", () => {
  const body = '<section class="hero"><h1>A</h1></section><h2 id="a">A</h2><h2 id="b">B</h2><h2 id="c">C</h2>';
  const hero = layout({ path: "a.html", title: "A", summary: "S", body, source: "x" }, NAVIGATION);
  assert(!hero.includes('class="toc"'), "a hero page has no table of contents");
  const plain = layout({ path: "a.html", title: "A", summary: "S", body: body.replace("hero", "plain"), source: "x" }, NAVIGATION);
  assert(plain.includes('class="toc"'), "a plain page keeps it");
});

const GUARDS: [string, () => unknown, RegExp][] = [
  ["sourcePaths rejects non-text", () => sourcePaths(WRONG), /source list is text/],
  ["sourcePaths rejects an empty list", () => sourcePaths("  "), /at least one repository file/],
  ["linkLine rejects non-text", () => linkLine(WRONG), /link list is text/],
  ["linkLine rejects a link with no label", () => linkLine("page.html"), /page and a label joined by a bar/],
  ["sourceLine rejects a non-list", () => sourceLine(WRONG), /lists paths/],
  ["sourceLine rejects an empty list", () => sourceLine([]), /at least one path/],
  ["missingSources rejects non-text", () => missingSources(REPOSITORY, WRONG), /source list is text/],
  ["missingSources rejects an absent root", () => missingSources(join(tmpdir(), "sell-absent-root"), REAL_SOURCE), /resolve against the repository root/],
  ["featureCard rejects a bad id", () => featureCard({ id: "a b", title: "T", sources: REAL_SOURCE, links: "a.html|A" }, CARD_PARTS), /one word with dashes/],
  ["featureCard rejects an empty body", () => featureCard({ id: "a", title: "T", sources: REAL_SOURCE, links: "a.html|A" }, " "), /needs its parts/],
  ["diagramFigure rejects a bad name", () => diagramFigure(REPOSITORY, "a/b", "C", REAL_SOURCE), /named by file stem/],
  ["diagramFigure rejects an empty caption", () => diagramFigure(REPOSITORY, "waves", " ", REAL_SOURCE), /needs a caption/],
  ["diagramFigure rejects a missing svg", () => diagramFigure(REPOSITORY, "no-such-diagram", "C", REAL_SOURCE), /no-such-diagram\.svg is missing/],
  ["featureCardProblems rejects an absent root", () => featureCardProblems("a.html", "", join(tmpdir(), "sell-absent-root")), /resolve against the repository root/],
  ["featureCardProblems rejects non-text", () => featureCardProblems("a.html", WRONG, REPOSITORY), /must be html text/],
  ["diagramProblems rejects an absent root", () => diagramProblems("a.html", "", join(tmpdir(), "sell-absent-root")), /resolve against the repository root/],
  ["diagramProblems rejects non-text", () => diagramProblems("a.html", WRONG, REPOSITORY), /must be html text/],
  ["lockupProblems rejects an empty file name", () => lockupProblems("", ""), /needs a file name/],
  ["lockupProblems rejects non-text", () => lockupProblems("a.html", WRONG), /must be html text/],
  ["pinnedContentProblems rejects a non-list", () => pinnedContentProblems(WRONG), /list of files/],
  ["pinnedContentProblems rejects a fragment without text", () => pinnedContentProblems([{ file: "a", text: WRONG }]), /holds text/],
];

for (const [label, call, message] of GUARDS) {
  test(`guard: ${label}`, () => {
    assert.throws(call, message, `${label} must fail with a message that matches ${message}`);
  });
}
