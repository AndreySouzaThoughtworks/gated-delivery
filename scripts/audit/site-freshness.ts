import assert from "node:assert";

import { SITE_BUILD_SCRIPT, SITE_SOURCES_DIRECTORY } from "./site-wiring.ts";

export const SITE_URL = "https://andrey1souza.github.io/gated-delivery/";
const README_FILE = "README.md";

type SiteInput = { buildScriptPresent: boolean; sourcesPresent: boolean; readme: string };

const QUOTED_OUTPUT = /<pre\b[\s\S]*?<\/pre>/gi;

export const statedCountProblems = (file: string, text: string, counted: [string, number][]) => {
  assert(typeof text === "string", `${file} must be text to check its counts, got ${typeof text}; pass its body.`);
  assert(Array.isArray(counted), `${file} needs a list of [label, count] pairs, got ${typeof counted}; pass the real counts.`);
  const problems: string[] = [];
  const prose = text.replace(QUOTED_OUTPUT, "");
  for (const [label, actual] of counted) {
    for (const [, stated] of prose.matchAll(new RegExp(`(\\d+)\\s+${label}\\b`, "g"))) {
      if (Number(stated) !== actual) problems.push(`${file} says "${stated} ${label}", which is not the real count of ${actual}. Hint: change it to "${actual} ${label}".`);
    }
  }
  return problems;
};

export const siteFreshnessProblems = ({ buildScriptPresent, sourcesPresent, readme }: SiteInput) => {
  assert(typeof readme === "string", `the README must be text, got ${typeof readme}; pass its body.`);
  assert(typeof buildScriptPresent === "boolean" && typeof sourcesPresent === "boolean", `the site files are present or not, got ${typeof buildScriptPresent} and ${typeof sourcesPresent}; pass booleans.`);
  const problems: string[] = [];
  if (!buildScriptPresent) problems.push(`${SITE_BUILD_SCRIPT} is missing. Rule: the README links a site that this script builds. Fix: restore the script.`);
  if (!sourcesPresent) problems.push(`${SITE_SOURCES_DIRECTORY}/ is missing. Rule: the site pages come from these sources. Fix: restore the folder.`);
  if (!readme.includes(SITE_URL)) problems.push(`${README_FILE} does not link ${SITE_URL}. Rule: the README sends readers to the site. Fix: add a link to it.`);
  return problems;
};
