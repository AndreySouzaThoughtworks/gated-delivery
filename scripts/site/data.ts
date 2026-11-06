import assert from "node:assert";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GUARD_FILE, sectionsOf } from "../audit/checks-registry-parity.ts";

export const PLUGIN_DIRECTORY = "plugin";
export const RESULTS_DIRECTORY = "evals/results";
export const RULES_DIRECTORY = "evals/rules";
export const TOKEN_BUDGET_FILE = "evals/token-budget.json";
export const MUTATION_SCRIPT = "scripts/audit/rule-inventory-mutation.ts";
export const TIERS = ["live", "static", "waived"] as const;
export const TIER_NONE = "none";

const FRONTMATTER = /^---\n([\s\S]*?)\n---/;
const FRONTMATTER_LINE = /^([\w-]+):\s*(.*)$/;
const SCRIPT_REFERENCE = /[\w./-]+\.(?:mjs|sh)\b/g;
const MUTATION_LINE = /mutation score: (\d+)\/(\d+)/;
const USAGE_LINE = /^usage:/;
const USAGE_PREFIX = /^usage:/i;
const USAGE_CONTINUATION = /^\s+\S/;
const USAGE_LITERAL = /"(usage: [^"]+)"/;
const EXIT_CONSTANT = /^const (EXIT_[A-Z_]+) = (\d+);/gm;
const SCRIPT_TIMEOUT_MS = 10000;
const NOT_FOUND = -1;
const UNKNOWN_EXIT = -1;
const SCRIPT_EXTENSIONS = [".mjs", ".sh"];
const NODE_EXTENSION = ".mjs";
const BOOTSTRAP_DIRECTORY = `${PLUGIN_DIRECTORY}/bootstrap`;
const SOURCE_USAGE_COMMENT = /^(?:\/\/|#).*?\bUsage:\s*(.+)$/m;
const SOURCE_USAGE_LITERAL = /["'`](usage: [^"'`]+)["'`]/;
const COMMENT_LINE = /^(?:\/\/|#)(?!!)\s?(.*)$/;
const TEST_MARKER = ".test.";
const SUPPORT_MARKER = ".support.";

export type Tier = (typeof TIERS)[number] | typeof TIER_NONE;
export type Mutation = { killed: number; total: number };
export type Instruction = { name: string; path: string; description: string; rules: number | null; mutation: Mutation | null; budget: number | null };
export type Skill = Instruction & { inputs: string[]; sections: string[]; steps: string[]; scripts: string[]; tier: Tier; stampedAt: string | null };
export type Agent = Instruction & { model: string | null; tools: string | null };
export type Command = Instruction & { allowedTools: string | null };
export type Hook = { file: string; path: string; event: string; matcher: string; tested: boolean };
export type ExitCode = { code: number; name: string };
export type ScriptGroup = "shared" | "skill" | "bootstrap";
export type UsageFrom = "run" | "source" | "output" | "header" | "none";
export type PluginScript = { name: string; path: string; group: ScriptGroup; usage: string[]; usageFrom: UsageFrom; exitCodes: ExitCode[]; exitWithoutArguments: number | null };
export type SiteData = {
  skills: Skill[];
  agents: Agent[];
  commands: Command[];
  hooks: Hook[];
  pluginScripts: PluginScript[];
};

export const readText = (root: string, path: string) => {
  assert(root !== "", `a file is read under the repository root, got an empty root for ${path}; pass the root.`);
  assert(!path.startsWith("/"), `a file path is relative to the root, got ${path}; drop the leading slash.`);
  return readFileSync(join(root, path), "utf8");
};

type InventoryContext = { root: string; budgets: Record<string, number>; mutations: Map<string, Mutation> };

export const frontmatter = (source: string, label: string): Record<string, string> => {
  const block = FRONTMATTER.exec(source)?.[1];
  assert(block !== undefined, `${label} must open with a --- frontmatter block, got none; add name and description.`);
  const fields: Record<string, string> = {};
  for (const line of block.split("\n")) {
    const match = FRONTMATTER_LINE.exec(line);
    if (match) fields[match[1]] = match[2];
  }
  assert(fields.description, `${label} must set a description in its frontmatter, got ${Object.keys(fields).join(", ") || "no field"}; add one.`);
  return fields;
};

export const headingsOf = (source: string, pattern: RegExp) => {
  assert(typeof source === "string", `headings come from text, got ${typeof source}; pass the file body.`);
  assert(pattern.global, `the heading pattern ${pattern} must be global, got flags "${pattern.flags}"; add the g flag.`);
  return [...source.matchAll(pattern)].map((match) => match[1].trim());
};

export const exitCodesOf = (source: string): ExitCode[] => {
  assert(typeof source === "string", `exit codes come from script text, got ${typeof source}; pass the script body.`);
  assert(!source.includes("\u0000"), `the script text holds a NUL character at offset ${source.indexOf("\u0000")}; pass a text file.`);
  return [...source.matchAll(EXIT_CONSTANT)].map(([, name, code]) => ({ code: Number(code), name: name.replace("EXIT_", "").toLowerCase().replaceAll("_", " ") })).sort((a, b) => a.code - b.code);
};

export const usageOf = (output: string, source: string): string[] => {
  assert(typeof output === "string", `usage comes from script output text, got ${typeof output}; pass stdout and stderr joined.`);
  assert(typeof source === "string", `the usage fallback reads script text, got ${typeof source}; pass the script body.`);
  const lines = output.split("\n");
  const start = lines.findIndex((line) => USAGE_LINE.test(line));
  if (start === NOT_FOUND) return [USAGE_LITERAL.exec(source)?.[1]].flatMap((literal) => literal ?? []);
  const usage = [lines[start]];
  for (const line of lines.slice(start + 1)) {
    if (!USAGE_CONTINUATION.test(line)) break;
    usage.push(line);
  }
  return usage;
};

export const fieldsOf = (root: string, path: string) => {
  assert(path.endsWith(".md"), `frontmatter is read from a markdown file, got ${path}; pass an agent or command file.`);
  assert(existsSync(join(root, path)), `${path} must exist under ${root}, got none; restore the file.`);
  return frontmatter(readText(root, path), path);
};

export const inventoryOf = ({ root, budgets, mutations }: InventoryContext, ruleName: string, path: string) => {
  assert(ruleName !== "", `an inventory is named after its instruction file, got an empty name for ${path}; pass the rule name.`);
  assert(path.startsWith(`${PLUGIN_DIRECTORY}/`), `an instruction file lives under ${PLUGIN_DIRECTORY}/, got ${path}; pass its repository path.`);

  const rulesPath = `${RULES_DIRECTORY}/${ruleName}.json`;
  const rules = existsSync(join(root, rulesPath)) ? JSON.parse(readText(root, rulesPath)).rules.length : null;
  return { rules, mutation: mutations.get(ruleName) ?? null, budget: budgets[path] ?? null };
};

export const scoreMutations = async (root: string, ruleNames: string[]): Promise<Map<string, Mutation>> => {
  assert(existsSync(join(root, MUTATION_SCRIPT)), `${MUTATION_SCRIPT} must exist under ${root} to score rule inventories, got none; pass the repository root.`);
  assert(Array.isArray(ruleNames), `rule names must be a list, got ${typeof ruleNames}; pass the inventory names.`);
  const scores = await Promise.all(
    ruleNames.map(
      (ruleName) =>
        new Promise<[string, Mutation | null]>((resolve) => {
          const child = spawn(process.execPath, [MUTATION_SCRIPT, `${RULES_DIRECTORY}/${ruleName}.json`], { cwd: root });
          let output = "";
          child.stdout.on("data", (chunk) => (output += chunk));
          child.on("close", () => {
            const match = MUTATION_LINE.exec(output);
            resolve([ruleName, match ? { killed: Number(match[1]), total: Number(match[2]) } : null]);
          });
        }),
    ),
  );
  return new Map(scores.flatMap(([ruleName, score]) => (score ? [[ruleName, score] as [string, Mutation]] : [])));
};

export const tierOf = (root: string, skill: string): { tier: Tier; stampedAt: string | null } => {
  assert(skill !== "", `a stamp is read for a named skill, got an empty name; pass the skill folder name.`);
  assert(!skill.includes("/"), `a skill is a folder name, got ${skill}; drop the path.`);
  const stampPath = `${RESULTS_DIRECTORY}/${skill}.json`;
  if (!existsSync(join(root, stampPath))) return { tier: TIER_NONE, stampedAt: null };
  const stamp = JSON.parse(readText(root, stampPath));
  if (Object.hasOwn(stamp, "waived")) return { tier: "waived", stampedAt: stamp.waived?.at ?? null };
  if (Object.hasOwn(stamp, "static")) return { tier: "static", stampedAt: stamp.static?.ranAt ?? null };
  return { tier: "live", stampedAt: stamp.ranAt ?? null };
};

export const listScripts = (root: string, folder: string, group: ScriptGroup, recursive: boolean): { path: string; group: ScriptGroup }[] => {
  assert(folder.startsWith(`${PLUGIN_DIRECTORY}/`), `scripts are listed from a folder under ${PLUGIN_DIRECTORY}/, got ${folder}; pass a plugin folder.`);
  assert(["shared", "skill", "bootstrap"].includes(group), `a script group is shared, skill or bootstrap, got ${group}; pass one of them.`);
  if (!existsSync(join(root, folder))) return [];
  return readdirSync(join(root, folder), { recursive, encoding: "utf8" })
    .filter((name) => SCRIPT_EXTENSIONS.some((extension) => name.endsWith(extension)) && !name.includes(TEST_MARKER) && !name.includes(SUPPORT_MARKER) && !name.split("/").includes("fixtures"))
    .map((name) => ({ path: `${folder}/${name}`, group }));
};

export const shippedScriptFiles = (root: string): { path: string; group: ScriptGroup }[] => {
  assert(root !== "", `scripts are listed under the repository root, got an empty path; pass the root.`);
  assert(existsSync(root), `the repository root ${root} must exist to list scripts, got none; pass the root.`);
  const skills = directoryNames(root, "skills").flatMap((skill) => listScripts(root, `${PLUGIN_DIRECTORY}/skills/${skill}/scripts`, "skill", false));
  return [...listScripts(root, `${PLUGIN_DIRECTORY}/scripts`, "shared", false), ...skills, ...listScripts(root, BOOTSTRAP_DIRECTORY, "bootstrap", true)].toSorted((a, b) => a.path.localeCompare(b.path));
};

export const scriptIndex = (root: string) => {
  assert(root !== "", `scripts are indexed under the repository root, got an empty path; pass the root.`);
  assert(existsSync(root), `the repository root ${root} must exist to index scripts, got none; pass the root.`);
  return new Map(shippedScriptFiles(root).map(({ path }) => [path.split("/").at(-1) as string, path]));
};

export const sourceUsageOf = (source: string): string[] => {
  assert(typeof source === "string", `usage text is read from script text, got ${typeof source}; pass the script body.`);
  assert(!source.includes("\u0000"), `the script text holds a NUL character at offset ${source.indexOf("\u0000")}; pass a text file.`);
  const commented = SOURCE_USAGE_COMMENT.exec(source)?.[1];
  if (commented) return [`usage: ${commented}`];
  const literal = SOURCE_USAGE_LITERAL.exec(source)?.[1];
  if (literal) return [literal];
  const header: string[] = [];
  for (const line of source.split("\n").slice(source.startsWith("#!") ? 1 : 0)) {
    const text = COMMENT_LINE.exec(line)?.[1];
    if (text === undefined) break;
    if (text !== "") header.push(text);
  }
  return header;
};

export const scriptsCalled = (skillText: string, index: Map<string, string>) => {
  assert(typeof skillText === "string", `script names come from skill text, got ${typeof skillText}; pass the SKILL.md body.`);
  assert(index instanceof Map, `the script index must be a Map of name to path, got ${typeof index}; pass the map from the scripts folders.`);
  const names = new Set([...skillText.matchAll(SCRIPT_REFERENCE)].map(([reference]) => reference.split("/").at(-1) as string));
  return [...names].flatMap((name) => index.get(name) ?? []).toSorted();
};

export const pluginScripts = (root: string): PluginScript[] => {
  assert(root !== "", `plugin scripts live under the repository root, got an empty path; pass the root.`);
  assert(existsSync(join(root, PLUGIN_DIRECTORY, "scripts")), `${PLUGIN_DIRECTORY}/scripts must exist under ${root}, got none; pass the repository root.`);
  const scratch = mkdtempSync(join(tmpdir(), "site-scripts-"));
  try {
    return shippedScriptFiles(root).map(({ path, group }) => {
      const source = readText(root, path);
      const name = path.split("/").at(-1) as string;
      const exitCodes = exitCodesOf(source);
      const fromSource = sourceUsageOf(source);
      const sourceKind: UsageFrom = fromSource.length === 0 ? "none" : USAGE_PREFIX.test(fromSource[0]) ? "source" : "header";
      if (group === "bootstrap" || !path.endsWith(NODE_EXTENSION)) return { name, path, group, usage: fromSource, usageFrom: sourceKind, exitCodes, exitWithoutArguments: null };
      const run = spawnSync(process.execPath, [join(root, path)], { cwd: scratch, encoding: "utf8", timeout: SCRIPT_TIMEOUT_MS, input: "" });
      const output = `${run.stdout}${run.stderr}`;
      const fromRun = usageOf(output, "");
      const printed = output.split("\n").filter((line) => line.trim() !== "");
      const [usage, usageFrom] = fromRun.length ? [fromRun, "run" as UsageFrom] : sourceKind === "source" ? [fromSource, "source" as UsageFrom] : printed.length ? [printed, "output" as UsageFrom] : [fromSource, sourceKind];
      return { name, path, group, usage, usageFrom, exitCodes, exitWithoutArguments: run.status ?? UNKNOWN_EXIT };
    });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
};

export const directoryNames = (root: string, folder: string) => {
  assert(folder !== "", `a plugin folder needs a name, got an empty one under ${root}; pass skills, agents or commands.`);
  assert(!folder.includes(".."), `a plugin folder name must not climb out of the plugin, got ${folder}; drop the dots.`);
  const path = join(root, PLUGIN_DIRECTORY, folder);
  return existsSync(path) ? readdirSync(path, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).toSorted() : [];
};

export const markdownNames = (root: string, folder: string) => {
  assert(folder !== "", `a plugin folder needs a name, got an empty one under ${root}; pass agents or commands.`);
  assert(!folder.includes(".."), `a plugin folder name must not climb out of the plugin, got ${folder}; drop the dots.`);
  const path = join(root, PLUGIN_DIRECTORY, folder);
  return existsSync(path) ? readdirSync(path).filter((name) => name.endsWith(".md")).toSorted().map((name) => name.replace(/\.md$/, "")) : [];
};

export const hooksOf = (root: string): Hook[] => {
  assert(root !== "", `hooks are read under the repository root, got an empty path; pass the root.`);
  assert(existsSync(root), `the repository root ${root} must exist to read hooks, got none; pass the root.`);
  const hooksPath = `${PLUGIN_DIRECTORY}/hooks/hooks.json`;
  if (!existsSync(join(root, hooksPath))) return [];
  const registered = JSON.parse(readText(root, hooksPath)).hooks as Record<string, { matcher: string; hooks: { command: string }[] }[]>;
  return Object.entries(registered).flatMap(([event, entries]) =>
    entries.flatMap(({ matcher, hooks }) =>
      hooks.map(({ command }) => {
        const file = /hooks\/([\w-]+\.mjs)/.exec(command)?.[1] as string;
        const path = `${PLUGIN_DIRECTORY}/hooks/${file}`;
        return { file, path, event, matcher, tested: existsSync(join(root, path.replace(/\.mjs$/, ".test.mjs"))) };
      }),
    ),
  );
};

export const collectSiteData = async (root: string): Promise<SiteData> => {
  assert(existsSync(join(root, PLUGIN_DIRECTORY)), `the repository root ${root} must hold ${PLUGIN_DIRECTORY}/, got none; pass the repository root.`);
  assert(existsSync(join(root, TOKEN_BUDGET_FILE)), `the repository root ${root} must hold ${TOKEN_BUDGET_FILE}, got none; restore the budget file.`);
  const budgets: Record<string, number> = JSON.parse(readFileSync(join(root, TOKEN_BUDGET_FILE), "utf8")).budgets;
  const ruleNames = existsSync(join(root, RULES_DIRECTORY)) ? readdirSync(join(root, RULES_DIRECTORY)).filter((name) => name.endsWith(".json")).map((name) => name.replace(/\.json$/, "")) : [];
  const mutations = await scoreMutations(root, ruleNames);
  const index = scriptIndex(root);
  const context: InventoryContext = { root, budgets, mutations };
  const skills = directoryNames(root, "skills").map((name): Skill => {
    const path = `${PLUGIN_DIRECTORY}/skills/${name}/SKILL.md`;
    const text = readText(root, path);
    return {
      name,
      path,
      description: frontmatter(text, path).description,
      inputs: headingsOf(text.split(/^## Inputs$/m)[1]?.split(/^## /m)[0] ?? "", /^[-*] `?([^`\n—:]+)/gm),
      sections: headingsOf(text, /^## (.+)$/gm),
      steps: headingsOf(text, /^### (\d+\. .+)$/gm),
      scripts: scriptsCalled(text, index),
      ...tierOf(root, name),
      ...inventoryOf(context, `skill-${name}`, path),
    };
  });
  const agents = markdownNames(root, "agents").map((name): Agent => {
    const path = `${PLUGIN_DIRECTORY}/agents/${name}.md`;
    const fields = fieldsOf(root, path);
    return { name, path, description: fields.description, model: fields.model ?? null, tools: fields.tools ?? null, ...inventoryOf(context, `agent-${name}`, path) };
  });
  const commands = markdownNames(root, "commands").map((name): Command => {
    const path = `${PLUGIN_DIRECTORY}/commands/${name}.md`;
    const fields = fieldsOf(root, path);
    return { name, path, description: fields.description, allowedTools: fields["allowed-tools"] ?? null, ...inventoryOf(context, `command-${name}`, path) };
  });
  return { skills, agents, commands, hooks: hooksOf(root), pluginScripts: pluginScripts(root) };
};

const WARNING_PUSH = /warnings\.push/;
const ERROR_PUSH = /errors\.push/;

export const guardSectionNumbers = (root: string): number[] => {
  assert(root !== "", `the guard source is read under the repository root, got an empty path; pass the root.`);
  assert(existsSync(join(root, GUARD_FILE)), `${GUARD_FILE} must exist under ${root} to count the guard checks, got none; pass the repository root.`);
  return [...sectionsOf(readText(root, GUARD_FILE)).keys()].toSorted((a, b) => a - b);
};

export const warnOnlyChecks = (root: string): number[] => {
  assert(root !== "", `the guard source is read under the repository root, got an empty path; pass the root.`);
  assert(existsSync(join(root, GUARD_FILE)), `${GUARD_FILE} must exist under ${root} to tell which checks only warn, got none; pass the repository root.`);
  return [...sectionsOf(readText(root, GUARD_FILE))].filter(([, text]) => WARNING_PUSH.test(text) && !ERROR_PUSH.test(text)).map(([number]) => number).toSorted((a, b) => a - b);
};
