import assert from "node:assert";

export const NODE_END_OF_LIFE: Record<number, string> = {
  22: "2027-04-30",
  24: "2028-04-30",
  26: "2029-04-30",
};

const ENGINES_FLOOR = /(\d+)(?:\.\d+)*\s*$/;
const STATED_FLOOR = /\bNode (\d+)(?:\.\d+)* or (?:later|newer)\b/g;
const PACKAGE_FILE = "package.json";
const README_FILE = "README.md";
const SCHEDULE_URL = "https://raw.githubusercontent.com/nodejs/Release/main/schedule.json";

type Document = { file: string; text: string };

export const nodeFloorProblems = ({ engines, documents, today }: { engines: unknown; documents: Document[]; today: Date }) => {
  assert(Number.isFinite(today.getTime()), `today must be a valid date, got ${today}`);
  assert(Array.isArray(documents), `documents must be a list of files, got ${typeof documents}`);
  const floor = typeof engines === "string" ? Number(engines.match(ENGINES_FLOOR)?.[1]) : NaN;
  if (!Number.isInteger(floor)) {
    return [`${PACKAGE_FILE} engines.node is ${JSON.stringify(engines)}, which names no Node release. Hint: set it to a range such as ">=22.18".`];
  }
  const problems: string[] = [];
  const endOfLife = NODE_END_OF_LIFE[floor];
  if (endOfLife === undefined) {
    problems.push(`${PACKAGE_FILE} sets the Node floor to ${floor}, which NODE_END_OF_LIFE in scripts/audit/node-floor.ts does not list. Hint: add the release with its end-of-life date from ${SCHEDULE_URL}.`);
  } else if (today >= new Date(endOfLife)) {
    problems.push(`${PACKAGE_FILE} sets the Node floor to ${floor}, which reached end of life on ${endOfLife}. Hint: raise engines.node, the README and docs to the oldest release still in security support (${SCHEDULE_URL}).`);
  }
  for (const { file, text } of documents) {
    for (const [statement, major] of text.matchAll(STATED_FLOOR)) {
      if (Number(major) !== floor) problems.push(`${file} says "${statement}" but ${PACKAGE_FILE} sets the floor to Node ${floor}. Hint: make the document and engines.node name the same release.`);
    }
  }
  const readme = documents.find(({ file }) => file === README_FILE);
  if (readme && [...readme.text.matchAll(STATED_FLOOR)].length === 0) {
    problems.push(`${README_FILE} states no Node floor. Hint: add "Node ${floor} or later" next to the hooks sentence.`);
  }
  return problems;
};
