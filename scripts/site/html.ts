import assert from "node:assert";
import type { Check } from "../audit/checks-registry.ts";
import { AUTHOR_NAME, BRAND_ASSETS, INLINE_MARK, LICENCE_LINE, SITE_NAME, SITE_URL, SOCIAL_CARD_ALT, TAGLINE, canonicalUrl } from "./brand.ts";
import { DARK_TOKENS, FONT_FILE, LIGHT_TOKENS, THEME_SCRIPT, styleSheet } from "./style.ts";

export { SITE_NAME };
export const REPOSITORY_URL = "https://github.com/andrey1souza/gated-delivery";
export const MINIMUM_HEADINGS_FOR_TOC = 3;

const MENU_GROUP_NAME = "site-menu";
const BACKTICK =/`([^`]+)`/g;
const H1_END = "</h1>";
const HERO_END = "</section>";
const HERO_MARKER = 'class="hero"';
const SECTION_INDEX = "/index.html";
const ROOT_INDEX = "index.html";
const SECOND_LEVEL_HEADING = /<h2 id="([^"]+)">([\s\S]*?)<\/h2>/g;
const ESCAPED_ENTITY = /&(?:amp|lt|gt|quot);/;
const SNIPPET_LENGTH = 30;
const ENTITIES: [string, string][] = [["&", "&amp;"], ["<", "&lt;"], [">", "&gt;"], ['"', "&quot;"]];

export type Page = { path: string; title: string; summary: string; body: string; source: string };
export type NavItem = { path: string; label: string };
export type NavGroup = { label: string; items: NavItem[] };
export type NavEntry = NavItem | NavGroup;
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

export const rootPrefix = (from: string) => {
  assert(!from.startsWith("/"), `a page path must be relative to the site root, got ${from}; drop the leading slash.`);
  assert(from !== "", `a page path names a page, got an empty one; pass the page path.`);
  return "../".repeat(from.split("/").length - 1);
};

export const relativeLink = (from: string, to: string) => {
  assert(!from.startsWith("/") && !to.startsWith("/"), `page paths must be relative to the site root, got ${from} and ${to}; drop the leading slash.`);
  assert(from !== "" && to !== "", `a link joins two named pages, got "${from}" and "${to}"; pass both paths.`);
  return `${rootPrefix(from)}${to}`;
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

export const stackedTable = (headers: string[], rows: string[][]) => {
  assert(headers.length > 0, `a stacked table needs at least one column, got none; pass the headers.`);
  assert(rows.every((row) => row.length === headers.length), `every row needs ${headers.length} cells, got ${JSON.stringify(rows.map((row) => row.length))}; pad or trim the rows.`);
  return `<div class="table-scroll"><table class="stacked"><thead><tr>${headers.map((header) => `<th scope="col">${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${rows
    .map((row) => `<tr>${row.map((cell, index) => `<td data-label="${escapeHtml(headers[index])}">${cell}</td>`).join("")}</tr>`)
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

const isCurrent = (pagePath: string, path: string) => {
  assert(pagePath !== "", `the current page needs a path, got an empty one; pass the page path.`);
  assert(!path.startsWith("/"), `a menu link path is relative to the site root, got ${path}; drop the leading slash.`);
  return pagePath === path || (path.endsWith(SECTION_INDEX) && pagePath.startsWith(path.slice(0, path.length - ROOT_INDEX.length)));
};

const navLink = (pagePath: string, { path, label }: NavItem) => {
  assert(label !== "", `a menu link needs a label, got an empty one for ${path}; name the link.`);
  assert(path.endsWith(".html"), `a menu link points at a page, got ${path}; name an .html file.`);
  const current = isCurrent(pagePath, path);
  return `<a href="${relativeLink(pagePath, path)}"${current ? ' aria-current="page"' : ""}>${escapeHtml(label)}</a>`;
};

export const menuMarkup = (pagePath: string, navigation: NavEntry[]) => {
  assert(navigation.length > 0, `the menu needs navigation links, got none for ${pagePath}; pass the menu items.`);
  assert(navigation.every((entry) => !("items" in entry) || entry.items.length > 0), `a menu group needs at least one link, got an empty group in ${JSON.stringify(navigation.map(({ label }) => label))}; add links or drop the group.`);
  return navigation
    .map((entry) => {
      if (!("items" in entry)) return `<li>${navLink(pagePath, entry)}</li>`;
      const holdsCurrent = entry.items.some(({ path }) => isCurrent(pagePath, path));
      return `<li class="menu-group"><details name="${MENU_GROUP_NAME}"><summary${holdsCurrent ? ' class="has-current"' : ""}>${escapeHtml(entry.label)}</summary><ul>${entry.items.map((item) => `<li>${navLink(pagePath, item)}</li>`).join("")}</ul></details></li>`;
    })
    .join("");
};

export const meta = (attribute: string, name: string, content: string) => {
  assert(attribute === "name" || attribute === "property", `a meta tag is keyed by name or property, got ${attribute}; pass one of them.`);
  assert(content !== "", `the meta tag ${name} needs content, got an empty string; pass the text.`);
  return `<meta ${attribute}="${name}" content="${content}">`;
};

export const headTags = (page: Page, assetPrefix: string) => {
  assert(page.title !== "" && page.summary !== "", `a page head needs a title and a description, got "${page.title}" and "${page.summary}" for ${page.path}; fill both.`);
  assert(assetPrefix === "" || assetPrefix.endsWith("/"), `the asset prefix is empty or ends with a slash, got "${assetPrefix}"; pass the relative path to the site root.`);
  const [title, description, url, image] = [escapeHtml(page.title), escapeHtml(page.summary), canonicalUrl(page.path), `${SITE_URL}${BRAND_ASSETS.socialCard}`];
  return [
    `<link rel="icon" href="${assetPrefix}${BRAND_ASSETS.favicon}" type="image/svg+xml">`,
    `<link rel="icon" href="${assetPrefix}${BRAND_ASSETS.faviconPng}" type="image/png" sizes="32x32">`,
    `<link rel="apple-touch-icon" href="${assetPrefix}${BRAND_ASSETS.appleTouchIcon}">`,
    `<link rel="preload" href="${assetPrefix}${FONT_FILE}" as="font" type="font/woff2" crossorigin>`,
    `<meta name="theme-color" content="${DARK_TOKENS.bg}" media="(prefers-color-scheme: dark)">`,
    `<meta name="theme-color" content="${LIGHT_TOKENS.bg}" media="(prefers-color-scheme: light)">`,
    meta("name", "description", description),
    `<link rel="canonical" href="${url}">`,
    meta("property", "og:type", "website"),
    meta("property", "og:site_name", SITE_NAME),
    meta("property", "og:title", title),
    meta("property", "og:description", description),
    meta("property", "og:url", url),
    meta("property", "og:image", image),
    meta("property", "og:image:alt", escapeHtml(SOCIAL_CARD_ALT)),
    meta("name", "twitter:card", "summary_large_image"),
    meta("name", "twitter:title", title),
    meta("name", "twitter:description", description),
    meta("name", "twitter:image", image),
  ].join("\n");
};

export const footerMarkup = (pagePath: string, navigation: NavEntry[]) => {
  assert(navigation.length > 0, `the footer needs navigation links, got none for ${pagePath}; pass the menu items.`);
  assert(pagePath.endsWith(".html"), `a page path must end in .html, got ${pagePath}; name the page file.`);
  const groups = navigation.flatMap((entry) => ("items" in entry ? [entry] : []));
  const columns = groups.map(({ label, items }) => `<nav aria-label="${escapeHtml(label)} pages"><p class="footer-title">${escapeHtml(label)}</p><ul>${items.map(({ path, label: name }) => `<li><a href="${relativeLink(pagePath, path)}">${escapeHtml(name)}</a></li>`).join("")}</ul></nav>`);
  return `<footer class="site-footer"><div class="footer-grid"><div><a class="footer-brand" href="${relativeLink(pagePath, "index.html")}"><img src="${relativeLink(pagePath, BRAND_ASSETS.mark)}" alt="" width="28" height="28">${SITE_NAME}</a><p>${TAGLINE}</p><p>Made by <a href="${REPOSITORY_URL}">${AUTHOR_NAME}</a>. ${LICENCE_LINE}</p></div>${columns.join("")}</div><div class="footer-note"><p>Generated from the repository files by <code>scripts/site/build.ts</code>. <a href="${REPOSITORY_URL}">Source on GitHub</a>.</p></div></footer>`;
};

export const layout = (page: Page, navigation: NavEntry[]) => {
  assert(page.path.endsWith(".html"), `a page path must end in .html, got ${page.path}; name the page file.`);
  assert(navigation.length > 0, `the layout needs navigation links, got none for ${page.path}; pass the menu items.`);
  const home = relativeLink(page.path, "index.html");
  const assetPrefix = rootPrefix(page.path);
  const links = menuMarkup(page.path, navigation);
  const tocAnchor = page.body.includes(HERO_MARKER) ? HERO_END : H1_END;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark light">
<title>${escapeHtml(page.title)} - ${SITE_NAME}</title>
${headTags(page, assetPrefix)}
<style>${styleSheet(`${assetPrefix}${FONT_FILE}`)}</style>
</head>
<body>
<a class="skip-link" href="#main">Skip to the content</a>
<header class="site-header">
<div class="bar"><a class="brand" href="${home}">${INLINE_MARK}${SITE_NAME}</a><nav aria-label="Main"><ul class="menu">${links}</ul></nav><button type="button" id="theme-toggle" aria-label="Switch colour theme">Theme</button></div>
</header>
<main id="main">
${page.body.replace(tocAnchor, () => `${tocAnchor}${tableOfContents(page.body)}`)}
</main>
${footerMarkup(page.path, navigation)}
<script>${THEME_SCRIPT}</script>
</body>
</html>
`;
};
