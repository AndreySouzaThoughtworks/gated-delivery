import assert from "node:assert";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { unescapeHtml } from "./html.ts";

const FEATURE_CARD = /<article class="feature" data-sources="([^"]*)"><h2 id="feature-([\w-]+)">/g;
const DIAGRAM_FIGURE = /<figure class="diagram" data-sources="([^"]*)">([\s\S]*?)<\/figure>/g;
const SVG_ELEMENT = /<svg\b[\s\S]*?<\/svg>/g;
const SVG_TITLE = /<title\b[^>]*>([^<]+)<\/title>/;
const SVG_DESCRIPTION = /<desc\b[^>]*>([^<]+)<\/desc>/;
const PAINT_ATTRIBUTE = /\s(?:fill|stroke|stop-color|color)="([^"]*)"/g;
const ALLOWED_PAINT = /^(?:none|currentColor|var\(--[\w-]+\))$/;
const HEX_COLOUR = /#[0-9a-f]{3,8}\b/i;
const STYLE_ATTRIBUTE = /\sstyle="/;
const LOCKUP = /class="(?:brand|hero-lockup)"/g;
const FOOTER_START = "<footer";
const EXPECTED_LOCKUPS = 1;
const PARENT_SEGMENT = "..";
const HOME_PAGE = "index.html";

export const PINNED_CONTENT = [
  {
    file: "docs-site-src/home.html",
    parts: ['<strong>Deterministic rules.</strong>', '<strong>Rules that can fail.</strong>', '<strong>Honest evidence.</strong>', '<ul class="cards">'],
  },
  {
    file: "docs-site-src/concepts.html",
    parts: [
      '<h2 id="harden-the-codebase">Harden the codebase, not the agent</h2>',
      '<h2 id="guidance-is-not-a-guardrail">Guidance is not a guardrail</h2>',
      '<h2 id="mistakes-become-rules">Every mistake becomes a deterministic rule</h2>',
      '<h2 id="static-and-live-evals">Static evals and live evals</h2>',
      '<h2 id="scripts-replace-prose">Why scripts replace prose</h2>',
      '<h2 id="not-verified">What is not verified</h2>',
    ],
  },
];

export const missingSources = (root: string, sources: string) => {
  assert(typeof sources === "string", `a source list is text, got ${typeof sources}; pass the data-sources value.`);
  assert(existsSync(root), `sources resolve against the repository root ${root}, got none; pass the root.`);
  return sources.split(" ").filter((path) => path === "" || path.startsWith("/") || path.split("/").includes(PARENT_SEGMENT) || !existsSync(join(root, path)));
};

export const featureCardProblems = (file: string, html: string, root: string) => {
  assert(existsSync(root), `feature sources resolve against the repository root ${root}, got none; pass the root.`);
  assert(typeof html === "string", `${file} must be html text, got ${typeof html}; pass the page body.`);
  return [...html.matchAll(FEATURE_CARD)].flatMap(([, sources, id]) =>
    missingSources(root, unescapeHtml(sources)).map((path) => `${file} feature card "${id}" cites "${path}", which is not a file of the repository. Rule: a card names the real files it comes from. Fix: correct the sources of the x-feature or restore the file.`),
  );
};

export const diagramProblems = (file: string, html: string, root: string) => {
  assert(existsSync(root), `diagram sources resolve against the repository root ${root}, got none; pass the root.`);
  assert(typeof html === "string", `${file} must be html text, got ${typeof html}; pass the page body.`);
  return [...html.matchAll(DIAGRAM_FIGURE)].flatMap(([, sources, figure]) => [
    ...missingSources(root, unescapeHtml(sources)).map((path) => `${file} diagram cites "${path}", which is not a file of the repository. Rule: a figure names the files it is drawn from. Fix: correct the sources of the x-diagram or restore the file.`),
    ...[...figure.matchAll(SVG_ELEMENT)].flatMap(([svg]) => {
      const problems: string[] = [];
      if (!SVG_TITLE.test(svg)) problems.push(`${file} holds a diagram with no <title>. Rule: every diagram has a title and a description. Fix: add <title> as the first child of the svg.`);
      if (!SVG_DESCRIPTION.test(svg)) problems.push(`${file} holds a diagram with no <desc>. Rule: every diagram has a title and a description. Fix: add <desc> after the title and say what the figure shows.`);
      const paints = [...svg.matchAll(PAINT_ATTRIBUTE)].map(([, value]) => value).filter((value) => !ALLOWED_PAINT.test(value));
      if (paints.length > 0 || HEX_COLOUR.test(svg) || STYLE_ATTRIBUTE.test(svg)) problems.push(`${file} holds a diagram with a hard-coded colour. Rule: diagram colours come from CSS variables so both themes work. Fix: use a dg- class from scripts/site/style.ts and drop the fill, stroke, style or hex value.`);
      return problems;
    }),
  ]);
};

export const lockupProblems = (file: string, html: string) => {
  assert(file !== "", `a lockup check needs a file name, got an empty one; pass the page path.`);
  assert(typeof html === "string", `${file} must be html text, got ${typeof html}; pass the page body.`);
  if (file !== HOME_PAGE) return [];
  const header = html.split(FOOTER_START)[0];
  const count = [...header.matchAll(LOCKUP)].length;
  return count === EXPECTED_LOCKUPS ? [] : [`${file} shows ${count} brand lockups above the footer. Rule: the home page shows the brand once, in the header. Fix: remove the extra lockup from docs-site-src/home.html.`];
};

export const pinnedContentProblems = (fragments: { file: string; text: string }[]) => {
  assert(Array.isArray(fragments), `the fragments are a list of files, got ${typeof fragments}; pass the fragment files.`);
  assert(fragments.every(({ text }) => typeof text === "string"), `every fragment holds text, got ${JSON.stringify(fragments.map(({ text }) => typeof text))}; pass the file bodies.`);
  return PINNED_CONTENT.flatMap(({ file, parts }) => {
    const fragment = fragments.find((candidate) => candidate.file === file);
    if (fragment === undefined) return [];
    return parts.filter((part) => !fragment.text.includes(part)).map((part) => `${file} lost the pinned content ${part}. Rule: the three home cards and the Concepts headings stay. Fix: restore the text, or change PINNED_CONTENT in scripts/site/sell-gates.ts in the same pull request with a reason.`);
  });
};
