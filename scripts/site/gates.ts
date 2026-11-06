import assert from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { MAX_SENTENCE_WORDS, MIN_SHORT_SENTENCE_PERCENT, asdStyleProblems, shareOf } from "../audit/asd-style.ts";
import { statedCountProblems } from "../audit/guide-freshness.ts";
import type { SiteData } from "./data.ts";
import { FRAGMENTS_DIRECTORY } from "./fragments.ts";
import { unescapeHtml } from "./html.ts";
import { SKILLS_INDEX } from "./pages.ts";
import { balanceProblems, tagsOf } from "./markup.ts";

const QUOTATION = /<blockquote class="quote" data-source="([^"]+)">\s*<p>([\s\S]*?)<\/p>[\s\S]*?<\/blockquote>/g;
const HAND_TYPED_COUNT = /(\d+)\s+(skills|agents|commands|hooks|checks)\b/g;
const CHECK_CARD = /<article class="check-card"[\s\S]*?<\/article>/g;
const TERMINAL_OUTPUT = /<x-(?:terminal|demo)\b[\s\S]*?(?:<\/x-terminal>|\/>)/g;
const HEADING = /^h([1-6])$/;
const FIRST_HEADING_LEVEL = 1;
const MAX_HEADING_STEP = 1;
const EXTERNAL_LINK = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;
const ABSOLUTE_PATHS = /\/Users\/|\/home\/[a-z]|\/private\/var\/|\/var\/folders\/|C:\\Users\\|\/tmp\//;
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const NOREPLY = /noreply/i;
const TOKEN_LIKE = /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,})|-----BEGIN [A-Z ]*PRIVATE KEY-----/;
const RESOURCE_URL = /^(?:https?:)?\/\//i;
const RESOURCE_ATTRIBUTES = ["src", "href"];
const CSS_EXTERNAL = /@import|url\(\s*["']?(?:https?:)?\/\//i;

export type SiteFiles = Map<string, string>;
export type Sources = Record<string, string>;

export const coverageProblems = (data: SiteData, files: SiteFiles) => {
  assert(Array.isArray(data.skills), `the coverage check lists skills, got ${typeof data.skills}; pass the collected data.`);
  assert(files instanceof Map, `the site files are a Map of path to html, got ${typeof files}; pass the map.`);
  const problems: string[] = [];
  const expected: [string, string, string, string | null][] = [
    ...data.skills.map((skill): [string, string, string, string | null] => ["skill", skill.name, `skills/${skill.name}.html`, `skill-${skill.name}`]),
    ...data.agents.map((agent): [string, string, string, string | null] => ["agent", agent.name, "agents.html", `agent-${agent.name}`]),
    ...data.commands.map((command): [string, string, string, string | null] => ["command", command.name, "commands.html", `command-${command.name}`]),
    ...data.hooks.map((hook): [string, string, string, string | null] => ["hook", hook.file, "hooks.html", `hook-${hook.file}`]),
    ...data.pluginScripts.map((script): [string, string, string, string | null] => ["plugin script", script.name, "plugin-scripts.html", `script-${script.name}`]),
  ];
  for (const [kind, name, page, anchor] of expected) {
    const html = files.get(page);
    if (html === undefined || (anchor !== null && !html.includes(`id="${anchor}"`))) {
      problems.push(`${kind} "${name}" is on disk but not on the site: ${page}${anchor ? `#${anchor}` : ""} is missing. Rule: every ${kind} appears on the site. Fix: render it in scripts/site/pages.ts.`);
    }
  }
  for (const skill of data.skills) {
    if (!files.get(SKILLS_INDEX)?.includes(`href="${skill.name}.html"`)) problems.push(`skill "${skill.name}" has a page but the skills index does not link it. Rule: every skill appears on the index. Fix: list it in scripts/site/pages.ts.`);
  }
  return problems;
};

export const handTypedCountProblems = (file: string, text: string) => {
  assert(file !== "", `a fragment needs a file name, got an empty one; pass its path.`);
  assert(typeof text === "string", `a fragment is text, got ${typeof text}; pass the file body.`);
  const prose = text.replace(TERMINAL_OUTPUT, "");
  return [...prose.matchAll(HAND_TYPED_COUNT)].map(
    ([phrase, , label]) => `${file} types the count "${phrase}" by hand. Rule: no count is typed; it comes from a variable. Fix: write {{${label}}} instead of the number.`,
  );
};

export const renderedCountProblems = (files: SiteFiles, counts: [string, number][]) => {
  assert(files instanceof Map, `the site files are a Map of path to html, got ${typeof files}; pass the map.`);
  assert(Array.isArray(counts), `the counts are a list of [label, number] pairs, got ${typeof counts}; pass the real counts.`);
  return [...files].flatMap(([page, html]) => statedCountProblems(page, html.replace(QUOTATION, "").replace(CHECK_CARD, ""), counts));
};

export const structureProblems = (file: string, html: string) => {
  assert(file !== "", `a page needs a file name, got an empty one; pass its path.`);
  assert(typeof html === "string", `${file} must be html text, got ${typeof html}; pass the page body.`);
  const problems: string[] = [];
  const tags = tagsOf(html).filter((tag) => !tag.closing);
  const seen = new Set<string>();
  for (const tag of tags) {
    const id = tag.attributes.id;
    if (id !== undefined) {
      if (seen.has(id)) problems.push(`${file}:${tag.line} repeats the id "${id}". Rule: an id is unique on its page. Fix: rename one of the two.`);
      seen.add(id);
    }
    if (tag.name === "img" && !("alt" in tag.attributes)) problems.push(`${file}:${tag.line} has an img with no alt attribute. Rule: every image has alt text. Fix: add alt="" for a decorative image or a description.`);
    if (tag.name !== "a" && RESOURCE_ATTRIBUTES.some((name) => RESOURCE_URL.test(tag.attributes[name] ?? ""))) {
      problems.push(`${file}:${tag.line} loads an external resource through <${tag.name}>. Rule: the site loads nothing from outside. Fix: inline it or remove it.`);
    }
  }
  const headings = tags.flatMap((tag) => {
    const level = HEADING.exec(tag.name)?.[1];
    return level ? [{ level: Number(level), line: tag.line }] : [];
  });
  const h1Count = headings.filter(({ level }) => level === FIRST_HEADING_LEVEL).length;
  if (h1Count !== FIRST_HEADING_LEVEL) problems.push(`${file} has ${h1Count} h1 headings. Rule: one h1 per page. Fix: keep one h1 and demote the others.`);
  let previous = 0;
  for (const { level, line } of headings) {
    if (level > previous + MAX_HEADING_STEP) problems.push(`${file}:${line} jumps from h${previous} to h${level}. Rule: heading levels do not skip. Fix: add the missing level or change this heading to h${previous + MAX_HEADING_STEP}.`);
    previous = level;
  }
  return problems;
};

export const linkProblems = (files: SiteFiles) => {
  assert(files instanceof Map, `the site files are a Map of path to html, got ${typeof files}; pass the map.`);
  assert(files.size > 0, `links resolve against pages, got no page; build the site first.`);
  const ids = new Map([...files].map(([page, html]) => [page, new Set(tagsOf(html).filter((tag) => !tag.closing).flatMap((tag) => tag.attributes.id ?? []))]));
  const problems: string[] = [];
  for (const [page, html] of files) {
    for (const tag of tagsOf(html).filter((candidate) => candidate.name === "a" && candidate.attributes.href !== undefined)) {
      const href = tag.attributes.href;
      if (EXTERNAL_LINK.test(href)) continue;
      const [path, anchor] = href.split("#");
      const target = path === "" ? page : posix.normalize(posix.join(posix.dirname(page), path));
      if (!files.has(target)) {
        problems.push(`${page}:${tag.line} links to ${href}, but ${target} is not a page of the site. Rule: internal links resolve. Fix: correct the path or add the page.`);
      } else if (anchor !== undefined && !ids.get(target)?.has(anchor)) {
        problems.push(`${page}:${tag.line} links to ${href}, but ${target} has no id "${anchor}". Rule: anchors resolve. Fix: add the id or correct the anchor.`);
      }
    }
  }
  return problems;
};

export const leakProblems = (file: string, html: string) => {
  assert(file !== "", `a page needs a file name, got an empty one; pass its path.`);
  assert(typeof html === "string", `${file} must be html text, got ${typeof html}; pass the page body.`);
  const problems: string[] = [];
  const path = ABSOLUTE_PATHS.exec(html)?.[0];
  if (path) problems.push(`${file} holds the local path "${path}". Rule: the site shows no machine path. Fix: run the demo with a relative path or remove the text.`);
  for (const [address] of html.matchAll(EMAIL)) {
    if (!NOREPLY.test(address)) problems.push(`${file} holds the email address "${address}". Rule: only noreply addresses may appear. Fix: remove the address.`);
  }
  if (TOKEN_LIKE.test(html)) problems.push(`${file} holds a string that looks like a secret token. Rule: the site shows no token. Fix: remove the string from the fragment or the demo output.`);
  if (CSS_EXTERNAL.test(html)) problems.push(`${file} loads a style from outside through @import or url(). Rule: the site loads nothing from outside. Fix: inline the style.`);
  return problems;
};

export const quotationProblems = (file: string, html: string, root: string) => {
  assert(existsSync(root), `quotations resolve against the repository root ${root}, got none; pass the root.`);
  assert(typeof html === "string", `${file} must be html text, got ${typeof html}; pass the page body.`);
  return [...html.matchAll(QUOTATION)].flatMap(([, source, text]) => {
    const sourcePath = join(root, unescapeHtml(source));
    if (!existsSync(sourcePath)) return [`${file} quotes ${source}, which does not exist. Rule: a quotation names a real repository file. Fix: correct data-source.`];
    return readFileSync(sourcePath, "utf8").includes(unescapeHtml(text)) ? [] : [`${file} quotes text that ${source} does not hold byte for byte. Rule: a quotation equals its source. Fix: regenerate the page, and do not edit the quoted text.`];
  });
};

export const styleProblems = (file: string, html: string, source: string) => {
  assert(source !== "", `${file} needs the file that wrote it for the fix hint, got an empty name; pass the source path.`);
  assert(typeof html === "string", `${file} must be html text, got ${typeof html}; pass the page body.`);
  return asdStyleProblems([{ file, text: html.replace(QUOTATION, "") }]).map(
    (problem) => `${problem} Rule: at least ${MIN_SHORT_SENTENCE_PERCENT}% of the sentences have ${MAX_SENTENCE_WORDS} words or fewer. Fix: edit ${source}, or move long source text into a verified quotation block.`,
  );
};

export type SiteInput = { root: string; files: SiteFiles; sources: Sources; data: SiteData; counts: [string, number][]; fragments: { file: string; text: string }[] };

export const siteProblems = ({ root, files, sources, data, counts, fragments }: SiteInput) => {
  assert(files instanceof Map, `the site files are a Map of path to html, got ${typeof files}; pass the map.`);
  assert(Array.isArray(fragments), `the fragments are a list of files, got ${typeof fragments}; pass the fragment files.`);
  return [
  ...coverageProblems(data, files),
  ...fragments.flatMap(({ file, text }) => handTypedCountProblems(file, text)),
  ...renderedCountProblems(new Map([...files].filter(([page]) => sources[page]?.startsWith(FRAGMENTS_DIRECTORY))), counts),
  ...[...files].flatMap(([page, html]) => [
    ...structureProblems(page, html),
    ...balanceProblems(page, html),
    ...leakProblems(page, html),
    ...quotationProblems(page, html, root),
    ...styleProblems(page, html, sources[page] ?? page),
  ]),
  ...linkProblems(files),
  ];
};

export const siteReport = (files: SiteFiles) => {
  assert(files instanceof Map, `the site files are a Map of path to html, got ${typeof files}; pass the map.`);
  assert(files.size > 0, `a report needs at least one page, got none; build the site first.`);
  const sizes = [...files].map(([page, html]) => ({ page, bytes: Buffer.byteLength(html), asd: shareOf({ file: page, text: html.replace(QUOTATION, "") }).percent }));
  const total = sizes.reduce((sum, { bytes }) => sum + bytes, 0);
  const largest = sizes.reduce((best, current) => (current.bytes > best.bytes ? current : best), sizes[0]);
  return [
    `site: ${sizes.length} pages, ${total} bytes in total, largest ${largest.page} (${largest.bytes} bytes)`,
    ...sizes.map(({ page, bytes, asd }) => `  ${page}: ${bytes} bytes, ${asd}% short sentences`),
  ];
};
