import assert from "node:assert";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export const RULES_DIRECTORY = "evals/rules";
export const MARKER_PATTERN = /\b(?:STOP|NEVER|MUST|Do not|CHECKPOINT|never|Never|always|Always|must not|Must not)\b/;
export const RULE_KINDS = ["stop", "never", "must", "checkpoint", "limit", "other"];
export const UNINVENTORIED_FILES_ARE_ERRORS = true;
const HEADING = /^#{1,6} /;
const LIMITS_HEADING = /^#{1,6} .*\bNOT\b/;
const SKILL_ENTRY = "SKILL.md";
const INSTRUCTION_DIRECTORIES = [
  { directory: "plugin/skills", entry: SKILL_ENTRY },
  { directory: "plugin/agents", entry: null },
  { directory: "plugin/commands", entry: null },
];
const MARKDOWN_EXTENSION = ".md";
const JSON_EXTENSION = ".json";
const SKILLS_DIRECTORY = "plugin/skills";
const SCENARIO_FILE = "evals.md";

export type Rule = { id: string; anchor: string; kind: string; why: string };
export type Exempt = { anchor: string; reason: string };
export type Inventory = { file: string; files?: string[]; rules: Rule[]; exempt: Exempt[] };

export const markerLines = (text: string) => { // zanity: ignore[assertion-density] -- exported-and-tested: every caller passes file text, so only the line scan can fail and the tests pin it
  let inLimitsSection = false;
  return text.split("\n").flatMap((line, index) => {
    const heading = HEADING.test(line);
    if (heading) inLimitsSection = LIMITS_HEADING.test(line);
    const isMarker = MARKER_PATTERN.test(line) || (inLimitsSection && !heading && line.trim() !== "");
    return isMarker ? [{ number: index + 1, text: line }] : [];
  });
};

export function inventoryProblems(root: string, name: string, inventory: Inventory): string[] {
  assert(typeof inventory.file === "string", `${name} must name the instruction file in "file", got ${typeof inventory.file}; add it`);
  assert(Array.isArray(inventory.rules), `${name} must list its "rules" as an array, got ${typeof inventory.rules}; add the array`);
  assert(Array.isArray(inventory.exempt), `${name} must list its "exempt" entries as an array, got ${typeof inventory.exempt}; add an empty array when there are none`);
  const sources = [inventory.file, ...(inventory.files ?? [])];
  const absent = sources.filter((source) => !existsSync(join(root, source)));
  if (absent.length) return absent.map((source) => `${name}: ${source} does not exist. Hint: point "file" and "files" at the instruction file this inventory guards.`);
  const problems: string[] = [];
  const texts = new Map(sources.map((source) => [source, readFileSync(join(root, source), "utf8")]));
  const everyText = [...texts.values()].join("\n");
  const anchors = [...inventory.rules, ...inventory.exempt].map(({ anchor }) => anchor);
  const seenIds = new Set<string>();
  for (const rule of inventory.rules) {
    if (seenIds.has(rule.id)) problems.push(`${name}: rule id ${rule.id} is used twice. Hint: give every rule its own id.`);
    seenIds.add(rule.id);
    if (!RULE_KINDS.includes(rule.kind)) problems.push(`${name}: rule ${rule.id} has kind "${rule.kind}". Hint: use one of ${RULE_KINDS.join(", ")}.`);
  }
  for (const { anchor, reason } of inventory.exempt) {
    if (!reason?.trim()) problems.push(`${name}: exempt entry "${anchor}" has a blank reason. Hint: say why the line is not a rule.`);
  }
  for (const anchor of anchors) {
    if (!anchor?.trim()) problems.push(`${name}: an entry has a blank anchor, which matches every line. Hint: copy a distinctive phrase of the line.`);
    else if (!everyText.includes(anchor)) problems.push(`${name}: anchor "${anchor}" is in none of ${sources.join(", ")}. Hint: the rule line was deleted or reworded; restore it or update the anchor.`);
  }
  const usable = anchors.filter((anchor) => anchor?.trim());
  for (const [source, text] of texts) {
    for (const line of markerLines(text)) {
      if (!usable.some((anchor) => line.text.includes(anchor))) {
        problems.push(`${name}: ${source}:${line.number} ${line.text.trim()}. Hint: add a rule with an anchor or an exempt entry with a reason.`);
      }
    }
  }
  return problems;
}

export const markdownFilesUnder = (root: string, directory: string): string[] => {
  assert(directory.trim() !== "", `directory must name a folder under ${root}, got a blank; pass the folder to scan`);
  assert(existsSync(join(root, directory)), `${directory} must exist under ${root}; check before scanning it`);
  return readdirSync(join(root, directory)).flatMap((name) => {
    const path = join(directory, name);
    return statSync(join(root, path)).isDirectory() ? markdownFilesUnder(root, path) : name.endsWith(MARKDOWN_EXTENSION) ? [path] : [];
  });
};

export const unlistedSupportingFiles = (root: string, covered: Set<string>): string[] => {
  assert(root.trim() !== "", `root must name the repository root, got a blank; pass the root`);
  assert(covered instanceof Set, `covered must be a Set of file paths, got ${typeof covered}`);
  if (!existsSync(join(root, SKILLS_DIRECTORY))) return [];
  const supportingFiles = markdownFilesUnder(root, SKILLS_DIRECTORY).filter((file) => !file.endsWith(`/${SCENARIO_FILE}`) && !file.endsWith(`/${SKILL_ENTRY}`));
  return supportingFiles.sort().flatMap((file) => {
    const markers = markerLines(readFileSync(join(root, file), "utf8")).length;
    return markers > 0 && !covered.has(file) ? [`no rule inventory lists ${file} in "file" or "files": ${markers} marker lines`] : [];
  });
};

export function checkRuleInventories(root: string) { // zanity: ignore[assertion-density] -- exported-and-tested: the guard's report is the only observable result, and its tests pin each finding
  const directory = join(root, RULES_DIRECTORY);
  const names = existsSync(directory) ? readdirSync(directory).filter((name) => name.endsWith(JSON_EXTENSION)).sort() : [];
  const problems: string[] = [];
  const inventoried = new Set<string>();
  const covered = new Set<string>();
  for (const name of names) {
    const label = `${RULES_DIRECTORY}/${name}`;
    try {
      const inventory: Inventory = JSON.parse(readFileSync(join(directory, name), "utf8"));
      problems.push(...inventoryProblems(root, label, inventory));
      inventoried.add(inventory.file);
      covered.add(inventory.file);
      for (const file of inventory.files ?? []) covered.add(file);
    } catch (failure) {
      problems.push(`${label} is not a usable inventory: ${failure instanceof Error ? failure.message : failure}. Hint: fix its JSON shape.`);
    }
  }
  const uninventoried: string[] = [];
  for (const { directory: instructionDirectory, entry } of INSTRUCTION_DIRECTORIES) {
    const base = join(root, instructionDirectory);
    if (!existsSync(base)) continue;
    const files = entry
      ? readdirSync(base).map((name) => join(instructionDirectory, name, entry))
      : readdirSync(base).filter((name) => name.endsWith(MARKDOWN_EXTENSION)).map((name) => join(instructionDirectory, name));
    for (const file of files.sort()) {
      const markers = existsSync(join(root, file)) ? markerLines(readFileSync(join(root, file), "utf8")).length : 0;
      if (markers > 0 && !inventoried.has(file)) uninventoried.push(`no rule inventory for ${file}: ${markers} marker lines`);
    }
  }
  uninventoried.push(...unlistedSupportingFiles(root, covered));
  return { problems, uninventoried };
}
