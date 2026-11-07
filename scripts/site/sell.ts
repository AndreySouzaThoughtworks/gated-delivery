import assert from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { escapeHtml } from "./html.ts";

export const DIAGRAMS_DIRECTORY = "docs-site-src/diagrams";
const PATH_SEPARATOR = " ";
const LINK_SEPARATOR = ";";
const LINK_FIELD_SEPARATOR = "|";
const LINK_FIELDS = 2;
const DIAGRAM_NAME = /^[\w-]+$/;
const FEATURE_ID = /^[\w-]+$/;

export type FeatureAttributes = { id: string; title: string; sources: string; links: string };

export const sourcePaths = (sources: string) => {
  assert(typeof sources === "string", `a source list is text, got ${typeof sources}; pass the paths joined by a space.`);
  assert(sources.trim() !== "", `a source list names at least one repository file, got an empty list; copy a real path.`);
  return sources.trim().split(PATH_SEPARATOR);
};

export const sourceLine = (paths: string[]) => {
  assert(Array.isArray(paths), `a source line lists paths, got ${typeof paths}; pass the path list.`);
  assert(paths.length > 0, `a source line names at least one path, got none; pass the sources.`);
  return `<p class="source">Source: ${paths.map((path) => `<code>${escapeHtml(path)}</code>`).join(", ")}.</p>`;
};

export const linkLine = (links: string) => {
  assert(typeof links === "string", `a link list is text, got ${typeof links}; pass page|label pairs joined by a semicolon.`);
  const pairs = links.split(LINK_SEPARATOR).map((pair) => pair.split(LINK_FIELD_SEPARATOR));
  assert(pairs.every((pair) => pair.length === LINK_FIELDS && pair.every((field) => field.trim() !== "")), `every link is a page and a label joined by a bar, got "${links}"; write page.html|label.`);
  return `<p class="source">Read more: ${pairs.map(([page, label]) => `<a href="${escapeHtml(page)}">${escapeHtml(label)}</a>`).join(", ")}.</p>`;
};

export const featureCard = ({ id, title, sources, links }: FeatureAttributes, inner: string) => {
  assert(FEATURE_ID.test(id), `a feature card id is one word with dashes, got "${id}"; fix the id of the x-feature.`);
  assert(inner.trim() !== "", `the feature card "${title}" needs its parts, got an empty body; write the Problem, Idea, How it works and Why it beats a prompt parts.`);
  const paths = sourcePaths(sources);
  return `<article class="feature" data-sources="${escapeHtml(paths.join(PATH_SEPARATOR))}"><h2 id="feature-${id}">${escapeHtml(title)}</h2>${inner}${sourceLine(paths)}${linkLine(links)}</article>`;
};

export const diagramFigure = (root: string, names: string, caption: string, sources: string) => {
  assert(names.split(PATH_SEPARATOR).every((name) => DIAGRAM_NAME.test(name)), `a diagram is named by file stem, got "${names}"; list stems joined by a space.`);
  assert(caption.trim() !== "", `a diagram needs a caption, got an empty one; say what the figure shows.`);
  const paths = sourcePaths(sources);
  const panels = names.split(PATH_SEPARATOR).map((name) => {
    const file = `${DIAGRAMS_DIRECTORY}/${name}.svg`;
    assert(existsSync(join(root, file)), `${file} is missing, so the diagram "${name}" cannot render. Fix: add the svg file or correct the name.`);
    return readFileSync(join(root, file), "utf8").trim();
  });
  return `<figure class="diagram" data-sources="${escapeHtml(paths.join(PATH_SEPARATOR))}"><div class="diagram-panels">${panels.join("")}</div><figcaption>${escapeHtml(caption)}${sourceLine(paths)}</figcaption></figure>`;
};
