import assert from "node:assert";

const TAG = /<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
const ATTRIBUTE = /([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
export const QUOTATION = /<blockquote class="quote" data-source="([^"]+)">\s*<p>([\s\S]*?)<\/p>[\s\S]*?<\/blockquote>/g;
const COMMENT = /<!--[\s\S]*?-->/g;
const DOCTYPE = /<!DOCTYPE[^>]*>/gi;
const RAW_TEXT_ELEMENTS = /<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const SNIPPET_LENGTH = 30;
const VOID_ELEMENTS = new Set(["meta", "link", "br", "hr", "img", "input", "source", "wbr", "area", "base", "col", "embed", "track"]);

export type Tag = { name: string; closing: boolean; selfClosing: boolean; attributes: Record<string, string>; line: number };

const BLANK_NON_NEWLINES = /[^\n]/g;

export const stripNonMarkup = (html: string) => {
  assert(typeof html === "string", `markup must be text, got ${typeof html}; pass the page body.`);
  assert(!html.includes("\u0000"), `markup holds a NUL character at offset ${html.indexOf("\u0000")}; remove it.`);
  return html
    .replace(COMMENT, (comment) => comment.replace(BLANK_NON_NEWLINES, " "))
    .replace(DOCTYPE, (doctype) => doctype.replace(BLANK_NON_NEWLINES, " "))
    .replace(RAW_TEXT_ELEMENTS, (element) => element.replace(/^(<[^>]*>)([\s\S]*)(<\/[^>]*>)$/, (_whole, open: string, inner: string, close: string) => open + inner.replace(BLANK_NON_NEWLINES, " ") + close));
};

export const attributesOf = (source: string) => {
  assert(typeof source === "string", `attributes come from tag text, got ${typeof source}; pass the text inside the tag.`);
  assert(!source.includes("<"), `the tag text "${source.slice(0, SNIPPET_LENGTH)}" holds a raw <; pass only the text after the tag name.`);
  const attributes: Record<string, string> = {};
  for (const [, name, double, single, bare] of source.matchAll(ATTRIBUTE)) attributes[name.toLowerCase()] = double ?? single ?? bare ?? "";
  return attributes;
};

export const tagsOf = (html: string): Tag[] => {
  assert(typeof html === "string", `markup must be text, got ${typeof html}; pass the page body.`);
  assert(!html.includes("\u0000"), `markup holds a NUL character at offset ${html.indexOf("\u0000")}; remove it.`);
  const clean = stripNonMarkup(html);
  return [...clean.matchAll(TAG)].map((match) => ({
    name: match[2].toLowerCase(),
    closing: match[1] === "/",
    selfClosing: match[3].trimEnd().endsWith("/"),
    attributes: attributesOf(match[3]),
    line: clean.slice(0, match.index).split("\n").length,
  }));
};

export const balanceProblems = (file: string, html: string) => {
  assert(file !== "", `a page needs a file name, got an empty one; pass its path.`);
  assert(typeof html === "string", `${file} must be html text, got ${typeof html}; pass the page body.`);
  const problems: string[] = [];
  const open: Tag[] = [];
  for (const tag of tagsOf(html)) {
    if (VOID_ELEMENTS.has(tag.name) || tag.selfClosing) continue;
    if (!tag.closing) {
      open.push(tag);
      continue;
    }
    const expected = open.pop();
    if (expected?.name !== tag.name) {
      problems.push(`${file}:${tag.line} closes </${tag.name}> but ${expected ? `<${expected.name}> from line ${expected.line} is still open` : "no element is open"}. Rule: the HTML must be well formed. Fix: close or remove the tag in the fragment or generator that wrote it.`);
      return problems;
    }
  }
  for (const tag of open) problems.push(`${file}:${tag.line} opens <${tag.name}> and never closes it. Rule: the HTML must be well formed. Fix: add </${tag.name}> in the fragment or generator that wrote it.`);
  return problems;
};
