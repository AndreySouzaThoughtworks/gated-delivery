#!/usr/bin/env node
// Mechanical checks for a deskcheck.html written by /deskcheck (plugin/skills/deskcheck/SKILL.md, Verification
// items 1, 2, 3 and 4, and the escaping rule). Usage: node scripts/audit/deskcheck-lint.mjs <deskcheck.html>...
// Exits 1 and prints one line per problem. Browser inspection (item 5) and the report (item 6) stay manual.

import assert from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const TEMPLATE_PATH = join(HERE, "..", "..", "plugin", "skills", "deskcheck", "templates", "deskcheck.html");
const CSP_META = /<meta\s+http-equiv=["']Content-Security-Policy["'][^>]*>/gi;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const HTTPS = /^https:\/\/\S+$/i;
const DATA_IMAGE = /^data:image\//i;
const REMOTE_ASSET = /<link\b[^>]*rel\s*=\s*["']?(?:stylesheet|preload|prefetch)|@import\b|url\(\s*["']?(?:[a-z][a-z0-9+.-]*:)?\/\//i;
const ATTRIBUTE = /\s(href|src)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
const ID_ATTRIBUTE = /\sid\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
const TAG = /<[a-z][^>]*>/gi;
const QUOTED = /"[^"]*"|'[^']*'/g;
const EXIT_PROBLEMS = 1;

const SHOWN_LENGTH = 60;
const ATTRIBUTE_CHECKS = [
  [({ name, value }) => name === "href" && /^(javascript|data):/i.test(value), ({ shown }) => `href ${shown} uses a script or data scheme; use an https:// URL or a relative path`],
  [({ name, value, scheme }) => name === "href" && scheme && !HTTPS.test(value), ({ shown }) => `href ${shown} must be an https:// URL or a relative path; change its scheme`],
  [({ name, value, scheme }) => name === "src" && (/^(https?:)?\/\//i.test(value) || (scheme && !DATA_IMAGE.test(value))), ({ shown }) => `src ${shown} must be a data:image URI or a relative path; embed the asset`],
  [({ value }, { ids }) => value.startsWith("#") && value.length > 1 && !ids.has(value.slice(1)), ({ shown }) => `link ${shown} points at an id that does not exist; fix the anchor or add the id`],
  [({ value, scheme, local }, { dir }) => Boolean(dir) && local !== "" && !scheme && !value.startsWith("//") && !value.startsWith("#") && !existsSync(resolve(dir, decodeURIComponent(local))), ({ name, shown }) => `${name} ${shown} does not resolve to a file beside the page; fix the path or add the file`],
];

export const lintDeskcheck = (html, { dir, templateHtml = readFileSync(TEMPLATE_PATH, "utf8") } = {}) => {
  const tags = html.match(TAG) ?? [];
  const attributes = [...html.matchAll(ATTRIBUTE)].map((m) => ({ name: m[1].toLowerCase(), value: (m[2] ?? m[3]).trim() }));
  const ids = new Set([...html.matchAll(ID_ATTRIBUTE)].map((m) => m[1] ?? m[2]));
  const expectedCsp = (templateHtml.match(CSP_META) ?? []).map((tag) => tag.replace(/\s+/g, " ").trim());
  const csp = (html.match(CSP_META) ?? []).map((tag) => tag.replace(/\s+/g, " ").trim());
  const problems = [];

  for (const placeholder of ["{{", "}}"].filter((p) => html.includes(p))) problems.push(`the file still holds the placeholder marker ${placeholder}; fill every template placeholder`);
  const headings = (html.match(/<h1[\s>]/gi) ?? []).length;
  if (headings !== 1) problems.push(`the page must hold exactly one h1, got ${headings}; keep the template's title heading and use h2 for sections`);
  if (/<script\b/i.test(html)) problems.push("the page holds a <script> element; remove it, the page is static");
  const handlers = tags.map((tag) => ({ tag, handler: tag.replace(QUOTED, '""').match(/\s(on[a-z]+)\s*=/i)?.[1] })).filter((found) => found.handler);
  problems.push(...handlers.map(({ tag, handler }) => `the tag ${JSON.stringify(tag.slice(0, 60))} has the ${handler} event attribute; remove it`));
  if (REMOTE_ASSET.test(html)) {
    problems.push("the page loads a remote stylesheet, font or file (a link rel, @import or url(//...)); embed the CSS and assets in the file");
  }
  problems.push(
    ...attributes
      .map(({ name, value }) => ({ name, value, shown: JSON.stringify(value.slice(0, SHOWN_LENGTH)), scheme: SCHEME.test(value), local: value.split(/[?#]/)[0] }))
      .map((attribute) => ATTRIBUTE_CHECKS.find(([isBroken]) => isBroken(attribute, { ids, dir }))?.[1](attribute))
      .filter(Boolean),
  );
  if (csp.length !== 1 || csp[0] !== expectedCsp[0]) problems.push(`the page must carry the template's Content-Security-Policy meta tag exactly once and unchanged, got ${csp.length} tags; copy it from ${TEMPLATE_PATH}`);

  assert(expectedCsp.length === 1, `the template must hold exactly one Content-Security-Policy meta tag to compare against, got ${expectedCsp.length} in ${TEMPLATE_PATH}`);
  return problems;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    process.stderr.write("usage: node scripts/audit/deskcheck-lint.mjs <deskcheck.html>...\n");
    process.exit(EXIT_PROBLEMS);
  }
  let failed = false;
  for (const file of files) {
    for (const problem of lintDeskcheck(readFileSync(file, "utf8"), { dir: dirname(resolve(file)) })) {
      process.stdout.write(`${file}: ${problem}\n`);
      failed = true;
    }
  }
  process.exit(failed ? EXIT_PROBLEMS : 0);
}
