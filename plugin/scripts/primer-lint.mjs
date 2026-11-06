#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const EXIT_CLEAN = 0;
const EXIT_PROBLEMS = 1;
const EXIT_USAGE = 2;
const ENCODING = "utf8";
const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_TEMPLATE_PATH = join(HERE, "..", "skills", "primer", "templates", "primer.html");
const USAGE = "usage: primer-lint.mjs <page.html> [--template <path>]";
const STYLE_BLOCK = /^<style>[\s\S]*?^<\/style>/m;
const LINE_BREAK = /\r?\n/;
const COMMENT = /<!--[\s\S]*?-->/g;
const PLACEHOLDER_MARKER = /\{\{|\}\}/;
const BANNER_ELEMENT = /class="banner[\s"]/;
const FOOTER_ELEMENT = /<footer\b/i;
const NEUTRAL_BANNER_WORDING = "Internal only";
const NEUTRAL_FOOTER_WORDING = "Generated with Claude AI";
const PURE_BLACK = /#000(000)?\b|rgba?\(0,\s*0,\s*0/i;
const MUTED_TEXT = /color:\s*#9AA3AF|fill:#9AA3AF/;
const ACCENT_TEXT = /color:\s*#7AA7D6/;
const HIGHLIGHT_DEFINITION_LINE = /--highlight:|^\s*\.accent-bar\{|Highlight #E8590C moment/;
const HIGHLIGHT_PAINT = /#E8590C|var\(--highlight\)|class="accent-bar"/gi;
const EXPECTED_HIGHLIGHTS = 1;
const RADIUS_DECLARATION = /border-radius:\s*([^;}"]+)/gi;
const ALLOWED_RADII = ["4px", "8px"];
const SHOWN_LENGTH = 60;
const WARNING_PREFIX = "warning: ";

/** @typedef {{ html: string, uncommented: string, templateStyle: string }} Page */
/** @typedef {[isBroken: (page: Page) => boolean, describe: string]} Rule */

/** @type {Rule[]} */
const RULES = [
  [({ html, templateStyle }) => html.match(STYLE_BLOCK)?.[0] !== templateStyle, "the <style> block differs from the template's; copy it verbatim"],
  [({ uncommented }) => PLACEHOLDER_MARKER.test(uncommented.replace(STYLE_BLOCK, "")), "the file still holds a {{ or }} template placeholder; fill every placeholder"],
  [({ uncommented }) => !BANNER_ELEMENT.test(uncommented), 'the page has no element with class="banner"; keep the sensitivity banner'],
  [({ uncommented }) => !FOOTER_ELEMENT.test(uncommented), "the page has no <footer> element; keep the disclosure footer"],
];

/** @type {Rule[]} */
const ADVISORY_RULES = [
  [({ html }) => html.split(LINE_BREAK).filter((line) => !HIGHLIGHT_DEFINITION_LINE.test(line)).join("\n").match(HIGHLIGHT_PAINT)?.length !== EXPECTED_HIGHLIGHTS, `${WARNING_PREFIX}the page should paint the Highlight exactly ${EXPECTED_HIGHLIGHTS} time; keep the accent bar and add no second`],
];

/** @type {Rule[]} */
const NEUTRAL_RULES = [
  [({ uncommented }) => !uncommented.includes(NEUTRAL_BANNER_WORDING), `the banner does not say "${NEUTRAL_BANNER_WORDING}"`],
  [({ uncommented }) => !uncommented.includes(NEUTRAL_FOOTER_WORDING), `the footer does not say "${NEUTRAL_FOOTER_WORDING}"`],
  [({ html }) => PURE_BLACK.test(html), "the page uses pure black; text is Ink #1C1E21 or Ink 2 #5A6270"],
  [({ html }) => MUTED_TEXT.test(html), "the page sets text in Muted #9AA3AF; text is Ink or Ink 2"],
  [({ html }) => ACCENT_TEXT.test(html), "the page sets text in Accent #7AA7D6; Accent is non-text only"],
  [({ html }) => [...html.matchAll(RADIUS_DECLARATION)].some(([, radius]) => !ALLOWED_RADII.includes(radius.trim())), `a border-radius is not ${ALLOWED_RADII.join(" or ")}; cards 8px, chips 4px, no pills`],
];

/**
 * @param {string} html
 * @param {string} templateHtml
 * @param {boolean} [neutral]
 * @returns {string[]}
 */
export const lintPrimer = (html, templateHtml, neutral = true) => {
  assert(typeof html === "string", `the \`html\` page must be text, got ${typeof html}; pass the page as a string.`);
  const templateStyle = String(templateHtml).match(STYLE_BLOCK)?.[0];
  assert(templateStyle !== undefined, `the template must hold a <style> block to compare against, got ${JSON.stringify(String(templateHtml).slice(0, SHOWN_LENGTH))}; point --template at a page that has one.`);
  const page = { html, uncommented: html.replace(COMMENT, ""), templateStyle };
  return [...RULES, ...(neutral ? NEUTRAL_RULES : []), ...ADVISORY_RULES].filter(([isBroken]) => isBroken(page)).map(([, describe]) => describe);
};

/**
 * @param {string[]} argv
 * @returns {number}
 */
const main = (argv) => {
  try {
    const { values, positionals } = parseArgs({ args: argv, options: { template: { type: "string" } }, allowPositionals: true });
    assert(positionals.length === 1, `primer-lint needs one page to lint, got ${positionals.length}; pass exactly one path.`);
    assert(values.template !== "", `--template needs a path, got ${JSON.stringify(values.template)}; pass a path.`);
    const templatePath = values.template ?? DEFAULT_TEMPLATE_PATH;
    const problems = lintPrimer(readFileSync(positionals[0], ENCODING), readFileSync(templatePath, ENCODING), values.template === undefined);
    for (const problem of problems) console.log(problem.startsWith(WARNING_PREFIX) ? problem : `${positionals[0]}: ${problem}`);
    return problems.every((problem) => problem.startsWith(WARNING_PREFIX)) ? EXIT_CLEAN : EXIT_PROBLEMS;
  } catch (error) {
    console.error(`primer-lint: ${error instanceof Error ? error.message : String(error)}\n${USAGE}`);
    return EXIT_USAGE;
  }
};

const entryPoint = process.argv[1];
if (entryPoint !== undefined && import.meta.url === pathToFileURL(realpathSync(entryPoint)).href) process.exitCode = main(process.argv.slice(2));
