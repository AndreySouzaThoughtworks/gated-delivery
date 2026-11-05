import assert from "node:assert";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export const BASELINE_FILE = "evals/token-budget.json";
export const LISTING_ENTRY = "always-in-context listing";
export const UPDATE_COMMAND = "node scripts/audit/token-budget.ts --update-baseline";
export const GAIN_TOLERANCE = 0.02;
const CHARACTERS_PER_TOKEN = 4;
const PERCENT = 100;
const SKILLS = "plugin/skills";
const SKILL_FILE = "SKILL.md";
const SKILL_RESOURCE_FOLDERS = ["templates", "workflows", "trackers"];
const MARKDOWN_EXTENSION = ".md";
const FRONTMATTER = /^---\n([\s\S]*?)\n---/;
const FRONTMATTER_FIELD = /^([a-z-]+):\s*(.*)$/gm;
const LISTED_GROUPS = ["skill", "agent", "command"];

export type Measurement = { path: string; group: string; tokens: number };

export const estimateTokens = (text: string) => Math.ceil(text.length / CHARACTERS_PER_TOKEN); // zanity: ignore[assertion-density] -- exported-and-tested: the estimate is a pure division over any text with no second invariant to state

export const measureBudgets = (root: string): Measurement[] => { // zanity: ignore[assertion-density] -- single-invariant: only a missing repo root can be asserted, since every folder below it is optional
  assert(existsSync(root), `${root} must exist to measure its instruction files, got none; pass --repo <repo root>`);
  const skills = existsSync(join(root, SKILLS))
    ? readdirSync(join(root, SKILLS)).filter((name) => statSync(join(root, SKILLS, name)).isDirectory())
    : [];
  const folders = [
    ...skills.flatMap((skill) => SKILL_RESOURCE_FOLDERS.map((folder) => ({ group: "skill-resource", folder: `${SKILLS}/${skill}/${folder}` }))),
    { group: "agent", folder: "plugin/agents" },
    { group: "command", folder: "plugin/commands" },
    { group: "reference", folder: "plugin/references" },
  ];
  const files = [
    ...skills.map((skill) => ({ group: "skill", path: `${SKILLS}/${skill}/${SKILL_FILE}` })),
    ...folders.filter(({ folder }) => existsSync(join(root, folder))).flatMap(({ group, folder }) =>
      readdirSync(join(root, folder), { recursive: true, encoding: "utf8" }).filter((name) => name.endsWith(MARKDOWN_EXTENSION)).map((name) => ({ group, path: `${folder}/${name}` })),
    ),
  ].filter(({ path }) => existsSync(join(root, path)));
  const texts = files.map((file) => ({ ...file, text: readFileSync(join(root, file.path), "utf8") }));
  const listing = texts.filter(({ group }) => LISTED_GROUPS.includes(group)).map(({ path, text }) => {
    const fields = Object.fromEntries([...(text.match(FRONTMATTER)?.[1] ?? "").matchAll(FRONTMATTER_FIELD)].map(([, key, value]) => [key, value]));
    return `${fields.name ?? path}: ${fields.description ?? ""}`;
  }).join("\n");
  return [
    ...texts.map(({ group, path, text }) => ({ group, path, tokens: estimateTokens(text) })),
    { group: "listing", path: LISTING_ENTRY, tokens: estimateTokens(listing) },
  ];
};

export const readBaseline = (root: string): Record<string, number> | null => { // zanity: ignore[assertion-density] -- single-invariant: only a baseline without a budgets table can be asserted, since a missing file is a normal answer
  const file = join(root, BASELINE_FILE);
  if (!existsSync(file)) return null;
  const { budgets } = JSON.parse(readFileSync(file, "utf8"));
  assert(typeof budgets === "object" && budgets !== null, `${BASELINE_FILE} must hold a "budgets" object of path to tokens, got ${typeof budgets}; regenerate it with ${UPDATE_COMMAND}`);
  return budgets;
};

export const budgetProblems = (measured: Measurement[], baseline: Record<string, number>) => { // zanity: ignore[assertion-density] -- exported-and-tested: each budget comparison is a plain branch whose outcome the tests assert
  const problems = measured.flatMap(({ path, tokens }) => {
    const budget = baseline[path];
    if (budget === undefined) return [`${path} is a new instruction file: add its budget (${tokens} estimated tokens) to ${BASELINE_FILE}. Hint: run ${UPDATE_COMMAND}.`];
    if (tokens > budget) return [`${path} grew to ${tokens} estimated tokens, over its budget of ${budget}. Hint: trim the text, or raise the budget in ${BASELINE_FILE} in a PR that says why.`];
    if (tokens < budget * (1 - GAIN_TOLERANCE)) return [`${path} shrank to ${tokens} estimated tokens, more than ${GAIN_TOLERANCE * PERCENT} percent below its budget of ${budget}. Hint: lock in the gain: run ${UPDATE_COMMAND}.`];
    return [];
  });
  const measuredPaths = new Set(measured.map(({ path }) => path));
  const stale = Object.keys(baseline).filter((path) => !measuredPaths.has(path));
  return [...problems, ...stale.map((path) => `${BASELINE_FILE} budgets ${path}, which no longer exists. Hint: run ${UPDATE_COMMAND} to drop the entry.`)];
};
