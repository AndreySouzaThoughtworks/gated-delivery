import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TEMPLATE_PATH, lintDeskcheck } from "../../plugin/skills/deskcheck/scripts/deskcheck-lint.mjs";
import { assertActionable, assertEveryLineActionable, assertErrorMatchesActionable } from "../test-support/actionable.test.support.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(HERE, "fixtures", "deskcheck");
const LINT = join(HERE, "..", "..", "plugin", "skills", "deskcheck", "scripts", "deskcheck-lint.mjs");
const VALID = readFileSync(join(FIXTURE_DIR, "valid.html"), "utf8");
const TEMPLATE = readFileSync(TEMPLATE_PATH, "utf8");
const CSP_TAG = VALID.match(/<meta http-equiv="Content-Security-Policy"[^>]*>/)?.[0] ?? "";

const lintPage = lintDeskcheck as (html: string, options: { dir: string }) => string[];

const swap = (from: string, to: string) => (text: string) => {
  assert(text.includes(from), `the fixture must contain ${JSON.stringify(from)} so the mutation can apply, got ${text.length} characters without it`);
  assert(from !== to, `a mutation must change the text, got ${JSON.stringify(from)} replaced by itself`);
  return text.replace(from, to);
};

const REJECTED: [string, (text: string) => string, string][] = [
  ["a placeholder left open", swap("PROJ-123 deskcheck", "{{TICKET_ID}} deskcheck"), "placeholder marker {{"],
  ["a placeholder left closed", swap("Prepared 2026-01-15", "Prepared 2026-01-15 }}"), "placeholder marker }}"],
  ["a second h1", swap("<h2>Evidence</h2>", "<h1>Evidence</h1>"), "exactly one h1, got 2"],
  ["no h1", swap("<h1>Reject empty order lines</h1>", "<h2>Reject empty order lines</h2>"), "exactly one h1, got 0"],
  ["a script element", swap("</main>", "<script>alert(1)</script></main>"), "`<script>` element"],
  ["an upper-case script element", swap("</main>", "<SCRIPT src=x></SCRIPT></main>"), "`<script>` element"],
  ["an event attribute", swap('<img alt="one pixel"', '<img onerror="x()" alt="one pixel"'), "onerror event attribute"],
  ["a javascript link", swap("https://tracker.example.com/browse/PROJ-123?focus=ac", "javascript:alert(1)"), "script or data scheme"],
  ["a data link", swap('href="evidence.txt"', 'href="data:text/html,hi"'), "script or data scheme"],
  ["an http link", swap("https://tracker.example.com/browse/PROJ-123?focus=ac", "http://tracker.example.com/x"), "must be an https:// URL or a relative path"],
  ["an ftp link", swap('href="evidence.txt"', 'href="ftp://host/evidence.txt"'), "must be an https:// URL or a relative path"],
  ["a remote image", swap("data:image/png;base64,iVBORw0KGgo=", "https://cdn.example.com/a.png"), "src"],
  ["a protocol-relative image", swap("data:image/png;base64,iVBORw0KGgo=", "//cdn.example.com/a.png"), "src"],
  ["a data src that is not an image", swap("data:image/png;base64,iVBORw0KGgo=", "data:text/html,hi"), "src"],
  ["a relative image that exists beside the page", swap("data:image/png;base64,iVBORw0KGgo=", "evidence.txt"), "must embed its source as a data:image URI"],
  ["a remote http image", swap("data:image/png;base64,iVBORw0KGgo=", "http://cdn.example.com/a.png"), "must embed its source as a data:image URI"],
  ["an image with no src", swap(' src="data:image/png;base64,iVBORw0KGgo="', ""), "must embed its source as a data:image URI"],
  ["an image with no alt", swap('<img alt="one pixel"', "<img"), "has no alt attribute"],
  ["a criteria heading with a suffix", swap("<h2>Evidence</h2>", "<h2>How each criterion is met (preview)</h2>"), 'must read exactly "How each criterion is met"'],
  ["a criteria heading with a verdict", swap("<h2>Evidence</h2>", "<h2>How each criterion is met: 5 of 7</h2>"), 'must read exactly "How each criterion is met"'],
  ["a remote stylesheet", swap("<style>", '<link rel="stylesheet" href="https://cdn.example.com/a.css"><style>'), "must not load a remote stylesheet"],
  ["a CSS import", swap("body { font-family", "@import 'a.css'; body { font-family"), "must not load a remote stylesheet"],
  ["a remote font", swap("body { font-family: sans-serif; }", "@font-face { src: url(https://cdn.example.com/f.woff) }"), "must not load a remote stylesheet"],
  ["a link to a missing file", swap('href="evidence.txt"', 'href="missing.txt"'), "does not resolve to a file"],
  ["an anchor with no id", swap('href="#content"', 'href="#nowhere"'), "points at an id that does not exist"],
  ["a changed CSP", swap("default-src 'none'", "default-src *"), "Content-Security-Policy"],
  ["a missing CSP", swap(CSP_TAG, ""), "got 0 tags"],
  ["a duplicated CSP", swap(CSP_TAG, `${CSP_TAG}${CSP_TAG}`), "got 2 tags"],
];

test("the valid fixture passes with no problems", () => {
  const problems = lintPage(VALID, { dir: FIXTURE_DIR });
  assert.deepEqual(problems, [], `a deskcheck that follows the skill must report nothing, got ${problems.join(" | ")}`);
  assert.equal(lintPage(VALID.replace("2026-01-15", "2026-02-01"), { dir: FIXTURE_DIR }).length, 0, "changing prose must not create problems");
});

for (const [name, mutate, expected] of REJECTED) {
  test(`rejects ${name}`, () => {
    const problems = lintPage(mutate(VALID), { dir: FIXTURE_DIR });
    assert(problems.some((p) => p.includes(expected)), `expected a problem containing ${JSON.stringify(expected)}, got ${JSON.stringify(problems)}`);
    assert(problems.length > 0, `a mutated page (${name}) must not come back clean, got ${problems.length} problems`);
  });
}

const REWRITTEN = ["a script element", "a remote stylesheet", "a CSS import", "a remote font"];

test("the rewritten problems are actionable behind their file prefix", () => {
  const rewritten = REJECTED.filter(([name]) => REWRITTEN.includes(name));
  assert.equal(rewritten.length, REWRITTEN.length, `every rewritten case must exist in REJECTED, got ${rewritten.length} of ${REWRITTEN.length}`);
  for (const [, mutate, expected] of rewritten) assertActionable(`page.html: ${lintPage(mutate(VALID), { dir: FIXTURE_DIR }).find((problem) => problem.includes(expected))}`);
});

test("the unfilled template is rejected", () => {
  const problems = lintPage(TEMPLATE, { dir: dirname(TEMPLATE_PATH) });
  assert(problems.some((p) => p.includes("placeholder marker {{")), `the template's placeholders must be flagged, got ${JSON.stringify(problems)}`);
  assert(!problems.some((p) => p.includes("Content-Security-Policy")), `the template's own CSP is the reference and must not be flagged, got ${JSON.stringify(problems)}`);
});

test("a page that is not text is refused", () => {
  const lint = lintDeskcheck as (html: unknown) => string[];
  assertErrorMatchesActionable(() => lint(1), /the .html. page must be text, got number/);
});

test("a template with no Content-Security-Policy tag, or with two, is refused", () => {
  const lint = lintDeskcheck as (html: string, options: { templateHtml: string }) => string[];
  const cspTag = TEMPLATE.match(/<meta\s+http-equiv=["']Content-Security-Policy["'][^>]*>/i)?.[0] ?? "";
  assert(cspTag.length > 0, `the shipped template must carry a Content-Security-Policy tag to copy, got ${cspTag.length} characters`);
  assertErrorMatchesActionable(() => lint(VALID, { templateHtml: "<html></html>" }), /exactly one Content-Security-Policy meta tag to compare against, got 0/);
  assertErrorMatchesActionable(() => lint(VALID, { templateHtml: `${cspTag}${cspTag}` }), /exactly one Content-Security-Policy meta tag to compare against, got 2/);
});

test("a template that is not text is refused", () => {
  const lint = lintDeskcheck as (html: string, options: { templateHtml: unknown }) => string[];
  assertErrorMatchesActionable(() => lint(VALID, { templateHtml: 1 }), /the .templateHtml. must be text, got number/);
});

test("the command line exits 1 on a bad page and 0 on a good one", () => {
  const dir = mkdtempSync(join(tmpdir(), "deskcheck-lint-"));
  const bad = join(dir, "bad.html");
  writeFileSync(bad, VALID.replace("<h2>Evidence</h2>", "<h1>Evidence</h1>"));
  const failed = spawnSync("node", [LINT, bad], { encoding: "utf8" });
  assert(failed.status === 1 && failed.stdout.includes(`${bad}: the page must hold exactly one h1`), `a bad page must exit 1 naming the file, got ${failed.status} ${failed.stdout}`);
  const passed = spawnSync("node", [LINT, join(FIXTURE_DIR, "valid.html")], { encoding: "utf8" });
  assert(passed.status === 0 && passed.stdout === "", `a good page must exit 0 silently, got ${passed.status} ${passed.stdout}`);
  const usage = spawnSync("node", [LINT], { encoding: "utf8" });
  assert.equal(usage.status, 1, `no file must exit 1, got ${usage.status}`);
  assertEveryLineActionable(usage.stderr);
});

test("an embedded image with alt and the exact criteria heading pass", () => {
  const page = VALID.replace("<h2>Evidence</h2>", "<h2>How each criterion is met</h2>");
  assert(page !== VALID, `the mutation must change the fixture, got ${page.length} characters both before and after`);
  assert.deepEqual(lintPage(page, { dir: FIXTURE_DIR }), [], "an exact heading and a data:image with alt must report nothing");
});
