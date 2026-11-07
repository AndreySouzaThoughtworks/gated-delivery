import assert from "node:assert";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { NODE_END_OF_LIFE } from "../audit/node-floor.ts";
import { ASSERTION_DENSITY_REASON_CODE_MEANINGS } from "../audit/suppression-reason-codes.ts";
import type { SiteData } from "./data.ts";
import { REPOSITORY_URL, escapeHtml, inlineCode, quotation, stackedTable, table, terminal } from "./html.ts";
import type { CheckEntry } from "./html.ts";

export const MISTAKES_FILE = "docs/mistakes-to-rules.md";
export const ONBOARDING_FILE = "docs/onboarding.md";
export const DEVELOPMENT_FILE = "docs/development.md";
export const RULES_FOLDER = "evals/rules";
export const BUDGET_FILE = "evals/token-budget.json";
export const SUPPRESSION_COUNT_FILE = "scripts/audit/suppressions.count";
export const ZANITY_BASELINE = "zanity-baseline.json";
export const MESSAGE_BASELINE = "message-actionability-baseline.json";
export const ASSERTION_BASELINE = "assertion-effectiveness-baseline.json";
export const BASELINE_FILES = [ZANITY_BASELINE, MESSAGE_BASELINE, ASSERTION_BASELINE];
export const PLUGIN_MANIFEST = "plugin/.claude-plugin/plugin.json";
export const MARKETPLACE_MANIFEST = ".claude-plugin/marketplace.json";
const PACKAGE_FILE = "package.json";
const WORKFLOWS_FOLDER = ".github/workflows";
const RUNS_ON = /^\s*runs-on:\s*(\S+)/gm;
const CAUGHT_HEADING = "Mistakes caught by a rule";
const OPEN_HEADING = "Mistakes with no deterministic rule yet";
const KNOBS_HEADING = "Knobs (environment variables)";
const TESTS_HEADING = "Tests";
const CAUGHT_COLUMNS = ["Mistake", "Category", "Rule", "Test"];
const OPEN_COLUMNS = ["Mistake", "Why no rule catches it"];
const KNOB_COLUMNS = ["Variable", "Default", "Effect"];
const COMMAND_COLUMNS = ["Command", "Needs a login", "Proves"];
const HEADER_ROWS = 2;
const CHECK_CODE = /<code>check (\d+)[a-z]?<\/code>/g;
const KNOB_NAME = /^`GATED_DELIVERY_[A-Z0-9_]+`$/;
const FILE_REFERENCE = /[\w./*-]+\.(?:sh|ts|mjs)\b/g;
const SUPPRESSION_MARKER = ["zanity:", "ignore[assertion-density]"].join(" ");
const CODED_SUPPRESSION = new RegExp(`${SUPPRESSION_MARKER.replace(/[[\]]/g, "\\$&")} -- ([a-z-]+):`, "g");
const SCANNED_FOLDERS = ["plugin", "scripts", "tests"];
const SCANNED_EXTENSIONS = [".ts", ".mjs", ".js", ".sh"];
const SKIPPED_FOLDER = "node_modules";
const ENGINES_VERSION = /(\d+)(?:\.(\d+))?\s*$/;
const TABLE_ROW = /^\|(.+)\|\s*$/;
const TABLE_CELL_SPLIT = /\s*\|\s*/;
const MINIMUM_ROW_CELLS = 3;
const PERCENT = 100;
const TRAILING_PERIOD = /\.$/;
const SECTION_END = "\n## ";
const NO_LOGIN = "No";
const NONE = "none";

export type FactContext = { root: string; variables: Record<string, number | string>; checks: CheckEntry[]; data?: SiteData };
export type Inventory = { name: string; file: string; files: string[]; rules: { id: string; anchor: string; kind: string; why: string }[] };

export const mistakeRows = (markdown: string, minimumCells = MINIMUM_ROW_CELLS) => {
  assert(typeof markdown === "string", `mistake rows come from markdown text, got ${typeof markdown}; pass the file body.`);
  assert(markdown.includes("|"), `${MISTAKES_FILE} must hold a markdown table, got no pipe character; restore the mistakes table.`);
  return markdown
    .split("\n")
    .flatMap((line) => TABLE_ROW.exec(line)?.[1] ?? [])
    .map((row) => row.split(TABLE_CELL_SPLIT).map((cell) => cell.trim()).filter((cell) => cell !== ""))
    .filter((cells) => cells.length >= minimumCells);
};

export const sectionOf = (markdown: string, heading: string) => {
  assert(heading !== "", `a section is found by its heading, got an empty one; pass the heading text.`);
  const start = markdown.indexOf(`## ${heading}\n`);
  assert(start >= 0, `the document has no section "## ${heading}", got ${markdown.length} characters without it; restore the heading.`);
  return markdown.slice(start + heading.length).split(SECTION_END)[0];
};

export const readSource = (root: string, path: string) => {
  assert(!path.startsWith("/"), `a source path is relative to the repository root, got ${path}; drop the leading slash.`);
  assert(existsSync(join(root, path)), `${path} must exist under the repository root, got none; restore the file the page reads.`);
  return readFileSync(join(root, path), "utf8");
};

export const tableUnder = (root: string, file: string, heading: string, columns: number) => {
  assert(columns >= 1, `a table has at least one column, got ${columns}; pass the column count.`);
  const rows = mistakeRows(sectionOf(readSource(root, file), heading), columns).slice(HEADER_ROWS);
  assert(rows.length > 0 && rows.every((cells) => cells.length === columns), `${file} section "${heading}" must hold rows of ${columns} cells, got ${JSON.stringify(rows.map((cells) => cells.length))}; fix the table.`);
  return rows;
};

export const ruleInventories = (root: string): Inventory[] => {
  assert(existsSync(join(root, RULES_FOLDER)), `${RULES_FOLDER} must exist under ${root}, got none; restore the rule inventories.`);
  const names = readdirSync(join(root, RULES_FOLDER)).filter((name) => name.endsWith(".json")).toSorted();
  assert(names.length > 0, `${RULES_FOLDER} must hold inventories, got none; restore them.`);
  return names.map((name) => {
    const parsed = JSON.parse(readSource(root, `${RULES_FOLDER}/${name}`));
    return { name: name.replace(/\.json$/, ""), file: parsed.file, files: parsed.files ?? [], rules: parsed.rules };
  });
};

export const ruleQuotation = (root: string, id: string) => {
  assert(id !== "", `a rule is found by its id, got an empty one; pass an id from ${RULES_FOLDER}.`);
  const found = ruleInventories(root).flatMap((inventory) => inventory.rules.filter((rule) => rule.id === id).map((rule) => ({ inventory, rule })))[0];
  assert(found, `no inventory in ${RULES_FOLDER} holds the rule "${id}". Fix: copy an id from a real inventory.`);
  const { inventory, rule } = found;
  const { anchor, kind, why } = rule;
  const source = [inventory.file, ...inventory.files].find((file) => existsSync(join(root, file)) && readFileSync(join(root, file), "utf8").includes(anchor));
  assert(source, `the anchor of rule "${id}" is in none of its files. Fix: run the consistency guard and restore the anchor.`);
  return `${quotation(source, anchor)}<p class="source">Rule <code>${escapeHtml(id)}</code>, kind <code>${escapeHtml(kind)}</code>. Reason in the inventory: ${escapeHtml(why.replace(TRAILING_PERIOD, ""))}.</p>`;
};

export const excerptBlock = (root: string, file: string, start: string, lines: number) => {
  assert(Number.isInteger(lines) && lines > 0, `an excerpt has a positive number of lines, got ${lines}; pass how many lines to show.`);
  const all = readSource(root, file).split("\n");
  const first = all.findIndex((line) => line.startsWith(start));
  assert(first >= 0, `${file} has no line that starts with "${start}". Fix: copy the start of a real line.`);
  return terminal(`${file}, from the line that starts with "${start}"`, all.slice(first, first + lines).join("\n"));
};

export const percentOf = (part: number, whole: number) => {
  assert(whole >= 0, `a share has a whole of zero or more, got ${whole}; pass the total.`);
  assert(part >= 0 && part <= whole, `a share has a part between zero and its whole, got ${part} of ${whole}; pass a smaller part.`);
  return whole === 0 ? PERCENT : Math.round((PERCENT * part) / whole);
};

export const inventoryTable = (data: SiteData) => {
  assert(Array.isArray(data.skills), `the inventory table lists skills, got ${typeof data.skills}; pass the collected data.`);
  assert(data.skills.every(({ mutation }) => mutation === null || mutation.killed <= mutation.total), `killed mutants cannot exceed all mutants, got ${JSON.stringify(data.skills.map(({ mutation }) => mutation))}; rerun the mutation script.`);
  return table(
    ["Inventory", "Rules", "Mutation score", "Lines with no rule anchor"],
    [
      ...data.skills.map(({ name, rules, mutation }) => [`skill-${name}`, rules, mutation] as const),
      ...data.agents.map(({ name, rules, mutation }) => [`agent-${name}`, rules, mutation] as const),
      ...data.commands.map(({ name, rules, mutation }) => [`command-${name}`, rules, mutation] as const),
    ].flatMap(([name, rules, mutation]) => {
      if (rules === null) return [];
      const share = mutation?.unprotected;
      return [[`<code>${escapeHtml(`${RULES_FOLDER}/${name}.json`)}</code>`, String(rules), mutation ? `${mutation.killed} of ${mutation.total} (${percentOf(mutation.killed, mutation.total)}%)` : NONE, share ? `${share.lines} of ${share.nonBlank} (${percentOf(share.lines, share.nonBlank)}%)` : NONE]];
    }),
  );
};

export const kindTable = (root: string) => {
  const rules = ruleInventories(root).flatMap(({ rules: held }) => held);
  const kinds = [...new Set(rules.map(({ kind }) => kind))].toSorted();
  assert(rules.length > 0, `the kind table counts rules, got none in ${RULES_FOLDER}; restore the inventories.`);
  assert(kinds.every((kind) => typeof kind === "string" && kind !== ""), `every rule has a kind, got ${JSON.stringify(kinds)}; fix the inventory.`);
  return table(["Kind", "Rules"], kinds.map((kind) => [`<code>${escapeHtml(kind)}</code>`, String(rules.filter((rule) => rule.kind === kind).length)]));
};

export const budgetRows = (root: string) => {
  const budgets: Record<string, number> = JSON.parse(readSource(root, BUDGET_FILE)).budgets;
  assert(Object.keys(budgets).length > 0, `${BUDGET_FILE} must hold budgets, got none; restore the file.`);
  assert(Object.values(budgets).every((budget) => Number.isInteger(budget) && budget > 0), `every budget is a positive whole number, got ${JSON.stringify(Object.values(budgets))}; fix ${BUDGET_FILE}.`);
  return Object.entries(budgets).toSorted((a, b) => b[1] - a[1]);
};

export const budgetTable = (root: string) => {
  assert(typeof root === "string", `a page reads the repository root as text, got ${typeof root}; pass the root path.`);
  assert(root !== "", `a page reads files under the repository root, got an empty path; pass the root.`);
  return table(["File", "Budget in estimated tokens"], budgetRows(root).map(([file, budget]) => [`<code>${escapeHtml(file)}</code>`, String(budget)]));
};

const STAMP_TIERS = ["live", "static", "waived", "none"];

export const stampCounts = (data: SiteData) => {
  assert(Array.isArray(data.skills), `the stamp counts list skills, got ${typeof data.skills}; pass the collected data.`);
  assert(data.skills.length > 0, `the stamp counts need skills, got none; pass the collected data.`);
  const counts = STAMP_TIERS.map((tier) => ({ tier, count: data.skills.filter((skill) => skill.tier === tier).length }));
  assert(counts.reduce((sum, { count }) => sum + count, 0) === data.skills.length, `every skill needs a known tier of ${STAMP_TIERS.join(", ")}, got ${JSON.stringify(data.skills.map(({ tier }) => tier))}; fix the stamp file.`);
  return counts;
};

export const stampsTable = (data: SiteData) => {
  assert(Array.isArray(data.skills), `the stamp table lists skills, got ${typeof data.skills}; pass the collected data.`);
  assert(data.skills.length > 0, `the stamp table needs skills, got none; pass the collected data.`);
  return table(["Tier", "Skills"], stampCounts(data).map(({ tier, count }) => [`<span class="tier tier-${tier}">${tier}</span>`, String(count)]));
};

export const liveEvidence = (data: SiteData) => {
  assert(Array.isArray(data.skills), `the live evidence reads skills, got ${typeof data.skills}; pass the collected data.`);
  assert(data.skills.length > 0, `the live evidence needs skills, got none; pass the collected data.`);
  const live = stampCounts(data).find(({ tier }) => tier === "live")?.count ?? 0;
  return `<p>${live === 0 ? "No skill holds a live stamp, so no recorded model run backs any skill today." : `${live} skills hold a live stamp. A recorded model run backs them. The rest hold no live stamp.`}</p>`;
};

export const filesUnder = (root: string, folder: string): string[] => {
  assert(!folder.startsWith("/"), `a folder is relative to the repository root, got ${folder}; drop the leading slash.`);
  assert(root !== "", `folders are listed under the repository root, got an empty path; pass the root.`);
  if (!existsSync(join(root, folder))) return [];
  return readdirSync(join(root, folder), { recursive: true, encoding: "utf8" })
    .filter((name) => !name.split("/").includes(SKIPPED_FOLDER) && SCANNED_EXTENSIONS.some((extension) => name.endsWith(extension)))
    .map((name) => `${folder}/${name}`);
};

export const suppressionCounts = (root: string) => {
  assert(root !== "", `a page reads files under the repository root, got an empty path; pass the root.`);
  const total = Number.parseInt(readSource(root, SUPPRESSION_COUNT_FILE).trim(), 10);
  assert(Number.isInteger(total) && total >= 0, `${SUPPRESSION_COUNT_FILE} must hold one whole number, got ${total}; write the current count.`);
  const codes = SCANNED_FOLDERS.flatMap((folder) => filesUnder(root, folder)).flatMap((file) => [...readSource(root, file).matchAll(CODED_SUPPRESSION)].map(([, code]) => code));
  return { total, byCode: Object.keys(ASSERTION_DENSITY_REASON_CODE_MEANINGS).map((code) => ({ code, count: codes.filter((found) => found === code).length })), coded: codes.length };
};

export const suppressionTable = (root: string) => {
  assert(root !== "", `a page reads files under the repository root, got an empty path; pass the root.`);
  const { total, byCode, coded } = suppressionCounts(root);
  assert(coded <= total, `${coded} coded suppressions exceed the ${total} that ${SUPPRESSION_COUNT_FILE} records; run node scripts/audit/suppressions.ts.`);
  const meanings: Record<string, string> = ASSERTION_DENSITY_REASON_CODE_MEANINGS;
  return table(["Reason code", "Meaning", "Suppressions"], [
    ...byCode.map(({ code, count }) => [`<code>${code}</code>`, escapeHtml(meanings[code]), String(count)]),
    ["other markers", "Any other lint, type or coverage suppression, each with a reason of four or more words", String(total - coded)],
    ["<strong>total</strong>", `Recorded in <code>${SUPPRESSION_COUNT_FILE}</code>`, String(total)],
  ]);
};

export const findingsIn = (root: string, file: string) => {
  assert(file.endsWith(".json"), `a baseline is a json file, got ${file}; pass a baseline file name.`);
  const findings: unknown = JSON.parse(readSource(root, file)).findings;
  assert(Array.isArray(findings), `${file} must hold a findings list, got ${typeof findings}; restore the baseline file.`);
  return findings.length;
};

export const ratchetTable = (root: string) => {
  assert(typeof root === "string", `a page reads the repository root as text, got ${typeof root}; pass the root path.`);
  assert(root !== "", `a page reads files under the repository root, got an empty path; pass the root.`);
  const baselines = BASELINE_FILES.map((file) => [file, findingsIn(root, file)] as const);
  return table(["Ratchet file", "Holds now", "What it blocks"], [
    ...baselines.map(([file, held]) => [`<code>${file}</code>`, `${held} findings`, "A pull request that makes the list longer than its base"]),
    [`<code>${SUPPRESSION_COUNT_FILE}</code>`, `${suppressionCounts(root).total} suppressions`, "A suppression added without a reviewed rise of the count file"],
    [`<code>${BUDGET_FILE}</code>`, `${budgetRows(root).length} budgets`, "An instruction file that grows past its budget"],
  ]);
};

export const checkLinks = (html: string, checks: CheckEntry[]) => {
  assert(Array.isArray(checks), `the check links resolve against registry rows, got ${typeof checks}; pass the registry.`);
  assert(typeof html === "string", `check links are added to html text, got ${typeof html}; pass the cell html.`);
  return html.replace(CHECK_CODE, (match, digits: string) => {
    assert(checks.some(({ number }) => number === Number(digits)), `${MISTAKES_FILE} names check ${digits}, but the registry has no such check. Fix: correct the row or add the registry row.`);
    return `<a href="ci-checks.html#check-${digits}">${match}</a>`;
  });
};

export const mistakesTable = (root: string, checks: CheckEntry[]) => {
  assert(root !== "", `a page reads files under the repository root, got an empty path; pass the root.`);
  assert(Array.isArray(checks), `the mistakes table links to registry rows, got ${typeof checks}; pass the registry.`);
  return stackedTable(CAUGHT_COLUMNS, tableUnder(root, MISTAKES_FILE, CAUGHT_HEADING, CAUGHT_COLUMNS.length).map((cells) => cells.map((cell, index) => (index === CAUGHT_COLUMNS.indexOf("Rule") ? checkLinks(inlineCode(cell), checks) : inlineCode(cell)))));
};

export const openMistakesTable = (root: string) => {
  assert(typeof root === "string", `a page reads the repository root as text, got ${typeof root}; pass the root path.`);
  assert(root !== "", `a page reads files under the repository root, got an empty path; pass the root.`);
  return stackedTable(OPEN_COLUMNS, tableUnder(root, MISTAKES_FILE, OPEN_HEADING, OPEN_COLUMNS.length).map((cells) => cells.map(inlineCode)));
};

export const knobsTable = (root: string) => {
  assert(root !== "", `a page reads files under the repository root, got an empty path; pass the root.`);
  const rows = tableUnder(root, ONBOARDING_FILE, KNOBS_HEADING, KNOB_COLUMNS.length);
  assert(rows.every(([name]) => KNOB_NAME.test(name)), `every knob is named in backticks with the GATED_DELIVERY_ prefix, got ${JSON.stringify(rows.map(([name]) => name))}; fix ${ONBOARDING_FILE}.`);
  return stackedTable(KNOB_COLUMNS, rows.map((cells) => cells.map(inlineCode)));
};

export const missingReferences = (root: string, command: string) => {
  assert(root !== "", `references are checked under the repository root, got an empty path; pass the root.`);
  assert(typeof command === "string", `a command is text, got ${typeof command}; pass the table cell.`);
  return [...command.matchAll(FILE_REFERENCE)].map(([reference]) => reference).filter((reference) => !existsSync(join(root, reference.includes("*") ? reference.slice(0, reference.lastIndexOf("/")) : reference)));
};

export const commandsTable = (root: string) => {
  assert(root !== "", `a page reads files under the repository root, got an empty path; pass the root.`);
  const rows = tableUnder(root, DEVELOPMENT_FILE, TESTS_HEADING, COMMAND_COLUMNS.length);
  const missing = rows.flatMap(([command]) => missingReferences(root, command));
  assert(missing.length === 0, `${DEVELOPMENT_FILE} lists commands that name files which do not exist: ${missing.join(", ")}. Fix: correct the command or restore the file.`);
  return stackedTable(COMMAND_COLUMNS, rows.filter(([, login]) => login === NO_LOGIN).map((cells) => cells.map(inlineCode)));
};

export const nodeFloors = (root: string) => {
  const engines: unknown = JSON.parse(readSource(root, PACKAGE_FILE)).engines?.node;
  const match = typeof engines === "string" ? ENGINES_VERSION.exec(engines) : null;
  assert(match, `${PACKAGE_FILE} engines.node is ${JSON.stringify(engines)}, which names no Node release. Fix: set it to a range such as ">=22.18".`);
  const [, major, minor] = match;
  const endOfLife = NODE_END_OF_LIFE[Number(major)];
  assert(endOfLife !== undefined, `${PACKAGE_FILE} sets Node ${major}, which NODE_END_OF_LIFE in scripts/audit/node-floor.ts does not list. Fix: add the release with its end-of-life date.`);
  return { major, dev: minor === undefined ? major : `${major}.${minor}`, endOfLife };
};

export const nodeTable = (root: string) => {
  assert(typeof root === "string", `a page reads the repository root as text, got ${typeof root}; pass the root path.`);
  assert(root !== "", `a page reads files under the repository root, got an empty path; pass the root.`);
  const { major } = nodeFloors(root);
  return table(["Release", "End of life", "Plugin floor"], Object.entries(NODE_END_OF_LIFE).map(([release, date]) => [`Node ${release}`, date, release === major ? "yes" : "no"]));
};

export const versionPolicy = (root: string) => {
  assert(root !== "", `a page reads files under the repository root, got an empty path; pass the root.`);
  const marketplace = JSON.parse(readSource(root, MARKETPLACE_MANIFEST));
  const plugin = JSON.parse(readSource(root, PLUGIN_MANIFEST));
  assert(Array.isArray(marketplace.plugins), `${MARKETPLACE_MANIFEST} must list plugins, got ${typeof marketplace.plugins}; restore the list.`);
  const pinned = [marketplace.metadata?.version, ...marketplace.plugins.map((entry: { version?: string }) => entry.version), plugin.version].filter((version) => version !== undefined);
  return `<p>${pinned.length === 0 ? `<code>${MARKETPLACE_MANIFEST}</code> and <code>${PLUGIN_MANIFEST}</code> hold no <code>version</code> field.` : `A version field exists: ${escapeHtml(pinned.join(", "))}. Check 15 fails on a pinned version, so remove it.`}</p>`;
};

export const ciPlatforms = (root: string) => {
  assert(existsSync(join(root, WORKFLOWS_FOLDER)), `${WORKFLOWS_FOLDER} must exist under ${root}, got none; restore the workflow files.`);
  const names = readdirSync(join(root, WORKFLOWS_FOLDER)).filter((name) => name.endsWith(".yml"));
  const platforms = [...new Set(names.flatMap((name) => [...readSource(root, `${WORKFLOWS_FOLDER}/${name}`).matchAll(RUNS_ON)].map(([, platform]) => platform)))].toSorted();
  assert(platforms.length > 0, `${WORKFLOWS_FOLDER} must name a runner with runs-on, got none; restore the jobs.`);
  const windows = platforms.some((platform) => platform.startsWith("windows"));
  return `<p>Every CI job runs on ${platforms.map((platform) => `<code>${escapeHtml(platform)}</code>`).join(", ")}. ${windows ? "A Windows job exists. Read the workflow files for its scope." : "No CI job runs on Windows, so behaviour on Windows is untested."}</p>`;
};

export const factVariables = (root: string) => {
  assert(typeof root === "string", `a page reads the repository root as text, got ${typeof root}; pass the root path.`);
  assert(root !== "", `a page reads files under the repository root, got an empty path; pass the root.`);
  const { major, dev, endOfLife } = nodeFloors(root);
  const marketplace = JSON.parse(readSource(root, MARKETPLACE_MANIFEST));
  const plugin = JSON.parse(readSource(root, PLUGIN_MANIFEST));
  return {
    repository: REPOSITORY_URL.replace(/^https:\/\/github\.com\//, ""),
    pluginId: `${plugin.name}@${marketplace.name}`,
    nodeFloor: major,
    nodeDevFloor: dev,
    nodeFloorEndOfLife: endOfLife,
    inventories: ruleInventories(root).length,
    budgetFiles: budgetRows(root).length,
    budgetTotal: budgetRows(root).reduce((sum, [, budget]) => sum + budget, 0),
    suppressionTotal: suppressionCounts(root).total,
    zanityBaseline: findingsIn(root, ZANITY_BASELINE),
    messageBaseline: findingsIn(root, MESSAGE_BASELINE),
    assertionBaseline: findingsIn(root, ASSERTION_BASELINE),
    requiredChecks: tableUnder(root, DEVELOPMENT_FILE, CHECKS_HEADING, CHECK_COLUMNS.length).length,
    mistakesCaught: tableUnder(root, MISTAKES_FILE, CAUGHT_HEADING, CAUGHT_COLUMNS.length).length,
    mistakesOpen: tableUnder(root, MISTAKES_FILE, OPEN_HEADING, OPEN_COLUMNS.length).length,
  };
};

export const CHECKS_HEADING = "Checks every change passes";
export const CHECK_COLUMNS = ["Required check", "What it runs"];
const LICENSE_FILE = "LICENSE";

export const requiredChecksTable = (root: string) => {
  assert(typeof root === "string", `a page reads the repository root as text, got ${typeof root}; pass the root path.`);
  assert(root !== "", `a page reads files under the repository root, got an empty path; pass the root.`);
  return stackedTable(CHECK_COLUMNS, tableUnder(root, DEVELOPMENT_FILE, CHECKS_HEADING, CHECK_COLUMNS.length).map((cells) => cells.map(inlineCode)));
};

export const licenseLine = (root: string) => {
  const name = readSource(root, LICENSE_FILE).split("\n")[0].trim();
  assert(name !== "", `${LICENSE_FILE} must start with the licence name, got an empty first line; restore the file.`);
  assert(!name.includes("<"), `the licence name is plain text, got "${name}"; fix the first line of ${LICENSE_FILE}.`);
  return `<p>The repository carries the <a href="${REPOSITORY_URL}/blob/main/${LICENSE_FILE}">${escapeHtml(name)}</a>. Reuse is allowed under its terms.</p>`;
};

const BLOCKS: Record<string, (context: FactContext) => string> = {
  "rule-inventories": ({ data }) => inventoryTable(data as SiteData),
  "rule-kinds": ({ root }) => kindTable(root),
  "token-budgets": ({ root }) => budgetTable(root),
  stamps: ({ data }) => stampsTable(data as SiteData),
  "live-evidence": ({ data }) => liveEvidence(data as SiteData),
  suppressions: ({ root }) => suppressionTable(root),
  ratchets: ({ root }) => ratchetTable(root),
  mistakes: ({ root, checks }) => mistakesTable(root, checks),
  "open-mistakes": ({ root }) => openMistakesTable(root),
  "env-vars": ({ root }) => knobsTable(root),
  "audit-commands": ({ root }) => commandsTable(root),
  "node-releases": ({ root }) => nodeTable(root),
  "version-policy": ({ root }) => versionPolicy(root),
  "ci-platforms": ({ root }) => ciPlatforms(root),
  "required-checks": ({ root }) => requiredChecksTable(root),
  license: ({ root }) => licenseLine(root),
};

export const dataBlock = (name: string, context: FactContext) => {
  assert(Object.hasOwn(BLOCKS, name), `the fragment asks for the data block "${name}", which does not exist. Fix: use one of ${Object.keys(BLOCKS).join(", ")}.`);
  assert(context.data !== undefined || !["rule-inventories", "stamps", "live-evidence"].includes(name), `the data block "${name}" needs the collected site data, got none; build the page through buildPages.`);
  return BLOCKS[name](context);
};
