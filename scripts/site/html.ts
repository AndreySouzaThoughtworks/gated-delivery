import assert from "node:assert";
import type { Check } from "../audit/checks-registry.ts";
import { THEME_SCRIPT, STYLE } from "./style.ts";

export const SITE_NAME = "gated-delivery";
export const REPOSITORY_URL = "https://github.com/andrey1souza/gated-delivery";
export const MINIMUM_HEADINGS_FOR_TOC = 3;

const BACKTICK = /`([^`]+)`/g;
const H1_END = "</h1>";
const SECTION_INDEX = "/index.html";
const ROOT_INDEX = "index.html";
const SECOND_LEVEL_HEADING = /<h2 id="([^"]+)">([\s\S]*?)<\/h2>/g;
const ESCAPED_ENTITY = /&(?:amp|lt|gt|quot);/;
const SNIPPET_LENGTH = 30;
const ENTITIES: [string, string][] = [["&", "&amp;"], ["<", "&lt;"], [">", "&gt;"], ['"', "&quot;"]];

export type Page = { path: string; title: string; summary: string; body: string; source: string };
export type NavItem = { path: string; label: string };
export type CheckEntry = Check;

export const escapeHtml = (text: string) => {
  assert(typeof text === "string", `escaping needs text, got ${typeof text}; pass a string.`);
  assert(!ESCAPED_ENTITY.test(text), `the text "${text.slice(0, SNIPPET_LENGTH)}" holds an entity that is already escaped; pass the raw text to avoid double escaping.`);
  return ENTITIES.reduce((current, [character, entity]) => current.replaceAll(character, entity), text);
};

export const unescapeHtml = (text: string) => {
  assert(typeof text === "string", `unescaping needs text, got ${typeof text}; pass a string.`);
  assert(!text.includes("<"), `the text "${text.slice(0, SNIPPET_LENGTH)}" holds a raw <, so it is not escaped; pass text that escapeHtml wrote.`);
  return [...ENTITIES].reverse().reduce((current, [character, entity]) => current.replaceAll(entity, character), text);
};

export const inlineCode = (text: string) => {
  assert(typeof text === "string", `inline code needs text, got ${typeof text}; pass a string.`);
  assert(text.split("`").length % 2 === 1, `the text "${text.slice(0, SNIPPET_LENGTH)}" has an odd number of backticks; close each code span.`);
  return escapeHtml(text).replace(BACKTICK, "<code>$1</code>");
};

export const bulletList = (items: string[]) => {
  assert(Array.isArray(items), `a list needs an array of items, got ${typeof items}; pass the items.`);
  assert(items.every((item) => typeof item === "string"), `every list item must be html text, got ${JSON.stringify(items.map((item) => typeof item))}; pass strings.`);
  return items.length === 0 ? "" : `<ul>${items.map((item) => `<li>${item}</li>`).join("")}</ul>`;
};

export const relativeLink = (from: string, to: string) => {
  assert(!from.startsWith("/") && !to.startsWith("/"), `page paths must be relative to the site root, got ${from} and ${to}; drop the leading slash.`);
  assert(from !== "" && to !== "", `a link joins two named pages, got "${from}" and "${to}"; pass both paths.`);
  const depth = from.split("/").length - 1;
  return `${"../".repeat(depth)}${to}`;
};

export const callout = (html: string) => {
  assert(typeof html === "string", `a callout needs html text, got ${typeof html}; pass a string.`);
  assert(html.trim() !== "", `a callout needs content, got a blank string; write the message or drop the callout.`);
  return `<div class="callout">${html}</div>`;
};

export const terminal = (title: string, text: string) => {
  assert(title !== "", `a terminal block needs a caption, got an empty one; name what the block shows.`);
  assert(typeof text === "string", `terminal "${title}" needs text, got ${typeof text}; pass the captured output.`);
  return `<figure class="terminal"><figcaption>${escapeHtml(title)}</figcaption><pre><code>${escapeHtml(text.replace(/\n+$/, ""))}</code></pre></figure>`;
};

export const quotation = (source: string, text: string) => {
  assert(source !== "", `a quotation names its source file, got an empty name; pass the repository path.`);
  assert(text !== "", `a quotation from ${source} needs text, got an empty string; pass the quoted text.`);
  return `<blockquote class="quote" data-source="${escapeHtml(source)}"><p>${escapeHtml(text)}</p><footer>From <code>${escapeHtml(source)}</code></footer></blockquote>`;
};

export const table = (headers: string[], rows: string[][]) => {
  assert(headers.length > 0, `a table needs at least one column, got none; pass the headers.`);
  assert(rows.every((row) => row.length === headers.length), `every row needs ${headers.length} cells, got ${JSON.stringify(rows.map((row) => row.length))}; pad or trim the rows.`);
  return `<div class="table-scroll"><table><thead><tr>${headers.map((header) => `<th scope="col">${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${rows
    .map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`)
    .join("")}</tbody></table></div>`;
};

export const checkCard = ({ number, id, title, rule, fix, example, mistake, source }: CheckEntry) => {
  assert(Number.isInteger(number) && number > 0, `a check number is a positive integer, got ${number}; fix the registry row.`);
  assert(title !== "" && id !== "", `check ${number} needs an id and a title, got "${id}" and "${title}"; fix the registry row.`);
  return (
    `<article class="check-card" id="check-${number}"><h3>Check ${number}: ${escapeHtml(title)}</h3>` +
    `<p><strong>Rule.</strong> ${inlineCode(rule)}</p><p><strong>Fix.</strong> ${inlineCode(fix)}</p>` +
    `${mistake === null ? "" : `<p><strong>Mistake category.</strong> ${inlineCode(mistake)}</p>`}${terminal(`Message from ${id}`, example)}` +
    `<p class="source">Source: <code>${escapeHtml(source)}</code></p></article>`
  );
};

export const tableOfContents = (body: string) => {
  assert(typeof body === "string", `a table of contents is built from html text, got ${typeof body}; pass the page body.`);
  assert(!body.includes("<html"), `a page body is a fragment, got a whole document; pass the content inside main.`);
  const headings = [...body.matchAll(SECOND_LEVEL_HEADING)];
  if (headings.length < MINIMUM_HEADINGS_FOR_TOC) return "";
  return `<nav class="toc" aria-label="On this page"><p class="toc-title">On this page</p><ol>${headings.map(([, id, text]) => `<li><a href="#${id}">${text}</a></li>`).join("")}</ol></nav>`;
};

export const layout = (page: Page, navigation: NavItem[]) => {
  assert(page.path.endsWith(".html"), `a page path must end in .html, got ${page.path}; name the page file.`);
  assert(navigation.length > 0, `the layout needs navigation links, got none for ${page.path}; pass the menu items.`);
  const home = relativeLink(page.path, "index.html");
  const links = navigation
    .map(({ path, label }) => {
      const current = page.path === path || (path.endsWith(SECTION_INDEX) && page.path.startsWith(path.slice(0, path.length - ROOT_INDEX.length)));
      return `<li><a href="${relativeLink(page.path, path)}"${current ? ' aria-current="page"' : ""}>${escapeHtml(label)}</a></li>`;
    })
    .join("");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="description" content="${escapeHtml(page.summary)}">
<title>${escapeHtml(page.title)} - ${SITE_NAME}</title>
<style>${STYLE}</style>
</head>
<body>
<a class="skip-link" href="#main">Skip to the content</a>
<header class="site-header">
<div class="bar"><a class="brand" href="${home}">${SITE_NAME}</a><button type="button" id="theme-toggle" aria-label="Switch colour theme">Theme</button></div>
<nav aria-label="Main"><ul class="menu">${links}</ul></nav>
</header>
<main id="main">
${page.body.replace(H1_END, () => `${H1_END}${tableOfContents(page.body)}`)}
</main>
<footer class="site-footer"><p>Generated from the repository files by <code>scripts/site/build.ts</code>. <a href="${REPOSITORY_URL}">Source on GitHub</a>.</p></footer>
<script>${THEME_SCRIPT}</script>
</body>
</html>
`;
};
