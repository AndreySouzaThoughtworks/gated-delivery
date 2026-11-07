import assert from "node:assert";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, posix } from "node:path";
import { BRAND_ASSETS, FONTS_SOURCE, PNG_SIZES, SITE_URL, canonicalUrl } from "./brand.ts";
import { contrastProblems } from "./contrast.ts";
import { balanceProblems, tagsOf } from "./markup.ts";
import { FONT_FAMILY, FONT_FILE } from "./style.ts";

const BYTES_PER_KIB = 1024;
export const FONT_BUDGET_BYTES = 200 * BYTES_PER_KIB;
export const PAGE_BUDGET_BYTES = 80 * BYTES_PER_KIB;
export const TOTAL_BUDGET_BYTES = 1536 * BYTES_PER_KIB;
export const HYPE_PHRASES = [
  "revolutionary", "game-changing", "game changing", "cutting-edge", "cutting edge", "world-class", "world class", "seamless", "seamlessly",
  "effortless", "effortlessly", "best-in-class", "best in class", "supercharge", "supercharged", "unleash", "unleashed", "10x",
  "blazing fast", "next-generation", "state-of-the-art",
];

const LICENCE_FILE = "OFL.txt";
const MANIFEST_FILE = "SOURCE.json";
const OFL_HEADING = /SIL OPEN FONT LICENSE Version 1\.1/i;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_WIDTH_OFFSET = 16;
const PNG_HEIGHT_OFFSET = 20;
const PNG_HEADER_BYTES = 24;
const SHA256 = /^[0-9a-f]{64}$/;
const LOCAL_REFERENCE = /^(?!(?:[a-z][a-z0-9+.-]*:|\/\/|#))/i;
const CSS_URL = /url\(\s*["']?([^"')]+)["']?\s*\)/g;
const STYLE_BLOCK = /<style>([\s\S]*?)<\/style>/g;
const INLINE_SVG = /<svg\b[^>]*>[\s\S]*?<\/svg>/g;
const FONT_FACE = /@font-face\s*\{[^}]*\}/g;
const TITLE = /<title>([^<]*)<\/title>/;
const TERMINAL_FIGURE = /<figure class="terminal">[\s\S]*?<\/figure>/g;
const QUOTED_BLOCK = /<blockquote class="quote"[\s\S]*?<\/blockquote>/g;
const REGEX_SPECIALS = /[.*+?^${}()|[\]\\]/g;
const REQUIRED_META = [
  ["name", "description"], ["property", "og:title"], ["property", "og:description"], ["property", "og:image"], ["property", "og:url"], ["name", "twitter:card"],
];
const THEME_COLOUR_COUNT = 2;
const HYPE_PATTERN = new RegExp(`(?<![\\w-])(?:${HYPE_PHRASES.map((phrase) => phrase.replace(REGEX_SPECIALS, "\\$&")).join("|")})(?![\\w-])`, "gi");

export type SiteAssets = Map<string, Buffer>;
export type SiteFiles = Map<string, string>;

export const pngSize = (bytes: Buffer) => {
  assert(Buffer.isBuffer(bytes), `a png is read as bytes, got ${typeof bytes}; pass the file buffer.`);
  assert(bytes.length > 0, `a png needs bytes, got an empty file; render the image again.`);
  if (bytes.length < PNG_HEADER_BYTES || !bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) return null;
  return { width: bytes.readUInt32BE(PNG_WIDTH_OFFSET), height: bytes.readUInt32BE(PNG_HEIGHT_OFFSET) };
};

type FontManifest = { family?: string; files?: { file: string; url: string; sha256: string }[] };

export const fontEntryProblems = (folder: string, font: string, manifest: FontManifest) => {
  assert(existsSync(folder), `the font check reads under ${folder}, got none; pass the font folder.`);
  assert(font !== "", `a font entry names a file, got an empty name; pass the font file name.`);
  const entry = manifest.files?.find(({ file }) => file === font);
  if (entry === undefined || !entry.url?.startsWith("https://") || !SHA256.test(entry.sha256 ?? "")) return [`${FONTS_SOURCE}/${MANIFEST_FILE} has no https url and sha256 for ${font}. Rule: every font file records its source. Fix: add the url and the sha256 of ${font}.`];
  if (createHash("sha256").update(readFileSync(join(folder, font))).digest("hex") !== entry.sha256) return [`${FONTS_SOURCE}/${font} does not match the sha256 in ${MANIFEST_FILE}. Rule: the file is the one the source published. Fix: download the file again from ${entry.url} or update the manifest after you verify the new file.`];
  return [];
};

export const familyProblems = (family: string | undefined) => {
  assert(family === undefined || typeof family === "string", `the family is text, got ${typeof family}; write the family name as a string in ${MANIFEST_FILE}.`);
  assert(family === undefined || family.trim() !== "", `the family names a font, got a blank one; write the family name in ${MANIFEST_FILE}.`);
  return family === FONT_FAMILY ? [] : [`${FONTS_SOURCE}/${MANIFEST_FILE} names the family "${family ?? "none"}", not "${FONT_FAMILY}". Rule: the manifest describes the font that the stylesheet loads. Fix: set "family" to ${FONT_FAMILY} in ${MANIFEST_FILE} or change FONT_FAMILY in scripts/site/style.ts.`];
};

export const fontSourceProblems = (root: string) => {
  assert(existsSync(root), `the font check reads under the repository root ${root}, got none; pass the root.`);
  assert(statSync(root).isDirectory(), `the font check reads under a folder, got the file ${root}; pass the repository root.`);
  const folder = join(root, FONTS_SOURCE);
  if (!existsSync(folder)) return [`${FONTS_SOURCE} is missing. Rule: the title font ships in the repository. Fix: restore the folder with the font, ${LICENCE_FILE} and ${MANIFEST_FILE}.`];
  const problems: string[] = [];
  const fonts = readdirSync(folder).filter((name) => name.endsWith(".woff2"));
  if (fonts.length === 0) problems.push(`${FONTS_SOURCE} holds no .woff2 file. Rule: the site self-hosts its title font. Fix: add the font file and list it in ${MANIFEST_FILE}.`);
  const licence = join(folder, LICENCE_FILE);
  if (!existsSync(licence) || !OFL_HEADING.test(readFileSync(licence, "utf8"))) problems.push(`${FONTS_SOURCE}/${LICENCE_FILE} is missing or is not the SIL Open Font License 1.1. Rule: a shipped font carries its licence text. Fix: copy the full licence from the font source.`);
  const manifestPath = join(folder, MANIFEST_FILE);
  const hasManifest = existsSync(manifestPath);
  const manifest: FontManifest = hasManifest ? JSON.parse(readFileSync(manifestPath, "utf8")) : {};
  if (!hasManifest) problems.push(`${FONTS_SOURCE}/${MANIFEST_FILE} is missing. Rule: every font file records its source url and sha256. Fix: add the manifest.`);
  problems.push(...fonts.flatMap((font) => fontEntryProblems(folder, font, manifest)));
  if (hasManifest) problems.push(...familyProblems(manifest.family));
  const bytes = readdirSync(folder).reduce((sum, name) => sum + statSync(join(folder, name)).size, 0);
  if (bytes > FONT_BUDGET_BYTES) problems.push(`${FONTS_SOURCE} weighs ${bytes} bytes, over the budget of ${FONT_BUDGET_BYTES}. Rule: fonts stay small. Fix: subset the font to Latin or drop a weight.`);
  return problems;
};

export const fontFaceProblems = (file: string, html: string) => {
  assert(file !== "", `a page needs a file name, got an empty one; pass its path.`);
  assert(typeof html === "string", `${file} must be html text, got ${typeof html}; pass the page body.`);
  const faces = [...html.matchAll(FONT_FACE)].map(([face]) => face);
  if (faces.length === 0) return [`${file} declares no @font-face. Rule: the title font loads from the site. Fix: keep the font face in scripts/site/style.ts.`];
  return faces.filter((face) => !face.includes("font-display: swap")).map(() => `${file} has an @font-face without font-display: swap. Rule: text shows at once in the fallback font. Fix: add font-display: swap in scripts/site/style.ts.`);
};

const referencesOf = (page: string, html: string) => {
  assert(page.endsWith(".html"), `a page path ends in .html, got ${page}; pass the page file name.`);
  assert(typeof html === "string", `${page} must be html text, got ${typeof html}; pass the page body.`);
  const tagged = tagsOf(html).flatMap((tag) => {
    if (tag.closing || tag.name === "a") return [];
    if (tag.name === "link" && tag.attributes.rel === "canonical") return [];
    return ["src", "href"].flatMap((name) => {
      const value = tag.attributes[name];
      return value !== undefined && LOCAL_REFERENCE.test(value) ? [{ value, line: tag.line }] : [];
    });
  });
  const styled = [...html.matchAll(STYLE_BLOCK)].flatMap(([, css]) => [...css.matchAll(CSS_URL)].map(([, value]) => ({ value, line: 0 })));
  return [...tagged, ...styled].filter(({ value }) => LOCAL_REFERENCE.test(value)).map(({ value, line }) => ({ line, target: posix.normalize(posix.join(posix.dirname(page), value)) }));
};

export const assetFileProblems = (assets: SiteAssets) => {
  assert(assets instanceof Map, `the site assets are a Map of path to bytes, got ${typeof assets}; pass the map.`);
  assert(assets.size > 0, `the site holds no asset, got an empty Map; copy the brand assets first.`);
  const problems = [...Object.values(BRAND_ASSETS), FONT_FILE]
    .filter((path) => !assets.has(path))
    .map((path) => `${path} is missing from the built site. Rule: every brand asset ships. Fix: restore the file in docs-site-src/brand or docs-site-src/fonts.`);
  for (const [path, bytes] of assets) {
    if (!path.endsWith(".svg")) continue;
    const text = bytes.toString("utf8");
    const broken = balanceProblems(path, text);
    if (broken.length > 0) problems.push(`${path} is not well formed svg. Rule: every svg parses. Fix: ${broken[0]}`);
    if (!text.includes("<title") && !text.includes("aria-label")) problems.push(`${path} has no <title> or aria-label. Rule: every svg names itself for screen readers. Fix: add a <title> as the first child.`);
  }
  return problems;
};

export const pngProblems = (assets: SiteAssets) => {
  assert(assets instanceof Map, `the site assets are a Map of path to bytes, got ${typeof assets}; pass the map.`);
  assert(assets.size > 0, `the site holds no asset, got an empty Map; copy the brand assets first.`);
  return Object.entries(PNG_SIZES).flatMap(([path, { width, height }]) => {
    const bytes = assets.get(path);
    if (bytes === undefined) return [];
    const size = pngSize(bytes);
    if (size?.width === width && size.height === height) return [];
    return [`${path} is ${size === null ? "not a png" : `${size.width}x${size.height}`}, not ${width}x${height}. Rule: icon and card sizes are fixed. Fix: render the file again at ${width}x${height}. See docs/development.md, Brand and design.`];
  });
};

export const pageAssetProblems = (files: SiteFiles, assets: SiteAssets) => {
  assert(files instanceof Map, `the site files are a Map of path to html, got ${typeof files}; pass the map.`);
  assert(assets instanceof Map, `the site assets are a Map of path to bytes, got ${typeof assets}; pass the map.`);
  const problems: string[] = [];
  for (const [page, html] of files) {
    for (const { target, line } of referencesOf(page, html)) {
      if (!assets.has(target) && !files.has(target)) problems.push(`${page}${line ? `:${line}` : ""} references ${target}, which the site does not hold. Rule: every referenced asset exists. Fix: add the file or correct the path.`);
    }
    for (const [svg] of html.matchAll(INLINE_SVG)) {
      const attributes = tagsOf(svg)[0].attributes;
      if (attributes["aria-hidden"] !== "true" && attributes["aria-label"] === undefined && !svg.includes("<title")) problems.push(`${page} holds an inline svg with no <title>, aria-label or aria-hidden. Rule: a graphic is named or hidden. Fix: add aria-hidden="true" for a decoration or a <title>.`);
    }
  }
  return problems;
};

export const assetProblems = (files: SiteFiles, assets: SiteAssets) => {
  assert(files instanceof Map, `the site files are a Map of path to html, got ${typeof files}; pass the map.`);
  assert(assets instanceof Map, `the site assets are a Map of path to bytes, got ${typeof assets}; pass the map.`);
  return [...assetFileProblems(assets), ...pngProblems(assets), ...pageAssetProblems(files, assets)];
};

export const metaContent = (html: string, attribute: string, name: string) => {
  assert(attribute === "name" || attribute === "property", `a meta tag is found by name or property, got ${attribute}; pass one of them.`);
  assert(name !== "", `a meta tag lookup needs the tag name, got an empty one; pass the name.`);
  return tagsOf(html).filter((tag) => tag.name === "meta" && tag.attributes[attribute] === name).map((tag) => tag.attributes.content);
};

export const missingMetaProblems = (page: string, html: string) => {
  assert(page !== "", `a page needs a file name, got an empty one; pass its path.`);
  assert(typeof html === "string", `${page} must be html text, got ${typeof html}; pass the page body.`);
  const tags = tagsOf(html);
  const problems = REQUIRED_META.filter(([attribute, name]) => (metaContent(html, attribute, name)[0] ?? "") === "").map(
    ([, name]) => `${page} has no ${name} meta tag. Rule: every page carries its description, Open Graph and card tags. Fix: write the tag in headTags in scripts/site/html.ts.`,
  );
  const canonical = tags.find((tag) => tag.name === "link" && tag.attributes.rel === "canonical")?.attributes.href;
  if (canonical !== canonicalUrl(page)) problems.push(`${page} has the canonical url ${canonical ?? "none"}, not ${canonicalUrl(page)}. Rule: the canonical url is built from SITE_URL. Fix: use headTags in scripts/site/html.ts.`);
  if (!metaContent(html, "property", "og:image")[0]?.startsWith(SITE_URL)) problems.push(`${page} has an og:image that does not start with ${SITE_URL}. Rule: the card image is an absolute url on the site. Fix: use headTags in scripts/site/html.ts.`);
  if (tags.filter((tag) => tag.name === "meta" && tag.attributes.name === "theme-color").length < THEME_COLOUR_COUNT) problems.push(`${page} has fewer than ${THEME_COLOUR_COUNT} theme-color tags. Rule: one tag per colour scheme. Fix: write both in headTags in scripts/site/html.ts.`);
  return problems;
};

export const metaProblems = (files: SiteFiles) => {
  assert(files instanceof Map, `the site files are a Map of path to html, got ${typeof files}; pass the map.`);
  assert(files.size > 0, `the meta check needs pages, got an empty Map; build the site first.`);
  const problems: string[] = [];
  const titles = new Map<string, string>();
  const descriptions = new Map<string, string>();
  for (const [page, html] of files) {
    const title = TITLE.exec(html)?.[1] ?? "";
    const description = metaContent(html, "name", "description")[0] ?? "";
    if (title === "") problems.push(`${page} has no title. Rule: every page has a title. Fix: name the page in scripts/site/pages.ts.`);
    if (titles.has(title)) problems.push(`${page} repeats the title of ${titles.get(title)}. Rule: titles are unique. Fix: rename one page.`);
    if (descriptions.has(description)) problems.push(`${page} repeats the description of ${descriptions.get(description)}. Rule: descriptions are unique. Fix: write a summary for this page in scripts/site/pages.ts.`);
    titles.set(title, titles.get(title) ?? page);
    descriptions.set(description, descriptions.get(description) ?? page);
    problems.push(...missingMetaProblems(page, html));
  }
  return problems;
};

export const weightProblems = (files: SiteFiles, assets: SiteAssets) => {
  assert(files instanceof Map, `the site files are a Map of path to html, got ${typeof files}; pass the map.`);
  assert(assets instanceof Map, `the site assets are a Map of path to bytes, got ${typeof assets}; pass the map.`);
  const pages = [...files].map(([page, html]) => ({ page, bytes: Buffer.byteLength(html) }));
  const fontBytes = [...assets].filter(([path]) => path.endsWith(".woff2")).reduce((sum, [, bytes]) => sum + bytes.length, 0);
  const problems = pages.filter(({ bytes }) => bytes > PAGE_BUDGET_BYTES).map(({ page, bytes }) => `${page} weighs ${bytes} bytes of html and css, over the budget of ${PAGE_BUDGET_BYTES}. Rule: pages stay light. Fix: trim the css in scripts/site/style.ts or split the page.`);
  const total = pages.reduce((sum, { bytes }) => sum + bytes, fontBytes);
  if (total > TOTAL_BUDGET_BYTES) problems.push(`the pages and fonts weigh ${total} bytes together, over the budget of ${TOTAL_BUDGET_BYTES}. Rule: the whole site stays small. Fix: trim pages or fonts.`);
  return problems;
};

export const themeProblems = (files: SiteFiles) => {
  assert(files instanceof Map, `the site files are a Map of path to html, got ${typeof files}; pass the map.`);
  assert(files.size > 0, `the theme check needs pages, got an empty Map; build the site first.`);
  const styles = new Map<string, string>();
  for (const [page, html] of files) for (const [, css] of html.matchAll(STYLE_BLOCK)) if (!styles.has(css)) styles.set(css, page);
  return [...styles].flatMap(([css, page]) => contrastProblems(page, css));
};

export const hypeProblems = (file: string, text: string) => {
  assert(file !== "", `a text check needs a file name, got an empty one; pass its path.`);
  assert(typeof text === "string", `${file} must be text, got ${typeof text}; pass the file body.`);
  const copy = text.replace(QUOTED_BLOCK, (block) => block.replace(/[^\n]/g, " ")).replace(TERMINAL_FIGURE, (block) => block.replace(/[^\n]/g, " "));
  return copy.split("\n").flatMap((line, index) => [...line.matchAll(HYPE_PATTERN)].map(([phrase]) => `${file}:${index + 1} uses the hype word "${phrase}": ${line.trim().slice(0, 80)}. Rule: copy states facts, not marketing claims. Fix: replace it with a number, a file name or a check that shows the claim.`));
};
