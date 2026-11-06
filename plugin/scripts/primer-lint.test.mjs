import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_TEMPLATE_PATH, lintPrimer } from "./primer-lint.mjs";
import { runScript, assertErrorMatchesActionable } from "./run-cli.test.support.mjs";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "primer-lint.mjs");
const EXIT_CLEAN = 0;
const EXIT_PROBLEMS = 1;
const EXIT_USAGE = 2;
const TEMPLATE = readFileSync(DEFAULT_TEMPLATE_PATH, "utf8");
const PLACEHOLDER = /\{\{[^}]*\}\}/g;
const FILLED = "Filled text.";
const FIRST_STYLE_RULE = "  *{box-sizing:border-box}";
const ACCENT_BAR = '<div class="accent-bar"></div>';
const EXPECTED_PROBLEM_LINES = 2;

const validPage = () => {
  const page = TEMPLATE.replace(PLACEHOLDER, FILLED);
  assert(!page.includes("{{"), "the valid page must hold no placeholder marker");
  assert(page.includes(ACCENT_BAR), `the valid page must hold ${ACCENT_BAR}`);
  return page;
};
const inHeader = (html, fragment) => {
  assert(html.includes("</header>"), "the page must hold a header to put the fragment in");
  assert(typeof fragment === "string", `the fragment must be text, got ${typeof fragment}`);
  return html.replace("</header>", `${fragment}</header>`);
};
const problemsOf = (html, template = TEMPLATE) => {
  assert(typeof html === "string", `the page must be text, got ${typeof html}`);
  assert(typeof template === "string", `the template must be text, got ${typeof template}`);
  return lintPrimer(html, template).join("\n");
};
const writePage = (html) => {
  assert(typeof html === "string", `the page must be text, got ${typeof html}`);
  const file = join(mkdtempSync(join(tmpdir(), "primer-lint-")), "page.html");
  writeFileSync(file, html);
  assert(readFileSync(file, "utf8") === html, `the page must be written intact to ${file}`);
  return file;
};

test("accepts the template filled in", () => {
  assert.deepEqual(lintPrimer(validPage(), TEMPLATE), []);
});

test("rejects an edited style block", () => {
  assert.match(problemsOf(validPage().replace(FIRST_STYLE_RULE, `${FIRST_STYLE_RULE}\n  p{margin:0}`)), /<style> block differs/);
});

test("rejects a missing style block", () => {
  assert.match(problemsOf(validPage().replace(/^<style>[\s\S]*?^<\/style>\n/m, "")), /<style> block differs/);
});

test("rejects Muted, Accent and pure black as text colours", () => {
  for (const [declaration, rule] of [["color:#9AA3AF", /Muted/], ["color:#7AA7D6", /Accent/], ["color:#000000", /pure black/]]) {
    assert.match(problemsOf(inHeader(validPage(), `<p style="${declaration}">x</p>`)), rule);
  }
});

test("rejects a radius other than 4px or 8px", () => {
  assert.match(problemsOf(inHeader(validPage(), '<p style="border-radius:999px">x</p>')), /border-radius is not 4px or 8px/);
});

test("warns on zero Highlights and exits 0", () => {
  const page = validPage().replace(ACCENT_BAR, "");
  assert.match(problemsOf(page), /^warning: the page should paint the Highlight exactly 1 time/);
  const result = runScript(SCRIPT, [writePage(page)]);
  assert.equal(result.status, EXIT_CLEAN);
  assert.match(result.stdout, /^warning: /);
});

test("warns on two Highlights and exits 0", () => {
  const page = inHeader(validPage(), ACCENT_BAR);
  assert.match(problemsOf(page), /^warning: the page should paint the Highlight exactly 1 time/);
  assert.equal(runScript(SCRIPT, [writePage(page)]).status, EXIT_CLEAN);
});

test("rejects a missing banner", () => {
  assert.match(problemsOf(validPage().replace(/<div class="banner warn">[\s\S]*?<\/div>/, "")), /no element with class="banner"/);
});

test("rejects a banner without the Internal only wording", () => {
  assert.match(problemsOf(validPage().replace("Internal only", "Public")), /does not say "Internal only"/);
});

test("rejects a missing footer", () => {
  assert.match(problemsOf(validPage().replace(/<footer[\s\S]*?<\/footer>/, "")), /no <footer> element/);
});

test("rejects a footer without the disclosure wording", () => {
  assert.match(problemsOf(validPage().replaceAll("Generated with Claude AI", "Written")), /does not say "Generated with Claude AI"/);
});

test("rejects a leftover placeholder", () => {
  assert.match(problemsOf(inHeader(validPage(), "{{LEFT}}")), /template placeholder/);
});

test("skips the neutral token rules for a client template", () => {
  const page = inHeader(validPage().replace("Internal only", "Public"), '<p style="color:#9AA3AF;border-radius:999px">x</p>');
  assert.deepEqual(lintPrimer(page, TEMPLATE, false), []);
});

test("throws on a page that is not text", () => {
  assertErrorMatchesActionable(() => lintPrimer(undefined, TEMPLATE), /the .html. page must be text/);
});

test("throws on a template without a style block", () => {
  assertErrorMatchesActionable(() => lintPrimer(validPage(), "<html></html>"), /template must hold a <style> block/);
});

test("exits 0 and prints nothing for the valid page", () => {
  const result = runScript(SCRIPT, [writePage(validPage())]);
  assert.equal(result.status, EXIT_CLEAN);
  assert.equal(result.stdout, "");
});

test("exits 1 with one line per problem prefixed by the file", () => {
  const file = writePage(validPage().replace(ACCENT_BAR, "").replace("Internal only", "Public"));
  const result = runScript(SCRIPT, [file]);
  assert.equal(result.status, EXIT_PROBLEMS);
  const lines = result.stdout.trimEnd().split("\n");
  assert.equal(lines.length, EXPECTED_PROBLEM_LINES);
  assert.ok(lines.filter((line) => !line.startsWith("warning: ")).every((line) => line.startsWith(`${file}: `)));
  assert.equal(lines.filter((line) => line.startsWith("warning: ")).length, 1);
});

test("exits 2 without a page, with an empty template value, and with a missing file", () => {
  const noPage = runScript(SCRIPT, []);
  assert.equal(noPage.status, EXIT_USAGE);
  assert.match(noPage.stderr, /needs one page to lint, got 0/);
  const emptyTemplate = runScript(SCRIPT, [writePage(validPage()), "--template", ""]);
  assert.equal(emptyTemplate.status, EXIT_USAGE);
  assert.match(emptyTemplate.stderr, /--template needs a path/);
  assert.equal(runScript(SCRIPT, [join(tmpdir(), "primer-lint-absent.html")]).status, EXIT_USAGE);
});

test("honours --template: a client template with its own style block", () => {
  const client = TEMPLATE.replace(FIRST_STYLE_RULE, `${FIRST_STYLE_RULE}\n  .brand-mark{color:var(--ink)}`);
  const result = runScript(SCRIPT, [writePage(client.replace(PLACEHOLDER, FILLED)), "--template", writePage(client)]);
  assert.equal(result.status, EXIT_CLEAN, result.stdout);
});
