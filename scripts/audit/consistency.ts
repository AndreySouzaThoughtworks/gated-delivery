#!/usr/bin/env node
// Deterministic consistency guard for the gated-delivery plugin repo.
// Catches the mechanical drift class: missing files, name/dir mismatches, dangling
// hook references, doc-vs-reality inventory drift, and wrong counts in the README.
// Zero dependencies (Node built-ins only). Exits non-zero on any ERROR.

import assert from "node:assert";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { BASE_REF_ENV, changedPaths, changedSkills, fileAtBase, stampStatus, waiverReason } from "../eval/changed-skills.ts";
import { parseChecks, scenarioIds } from "../eval/run-checks.ts";
import { BASELINE_FILE, UPDATE_COMMAND, budgetProblems, measureBudgets, readBaseline } from "./token-budget/budget.ts";
import { UNINVENTORIED_FILES_ARE_ERRORS, checkRuleInventories } from "./rule-inventory.ts";

const ROOT = process.cwd();
const PLUGIN = join(ROOT, "plugin");
const NOT_UTF8 = "\uFFFD";
const errors: string[] = [];
const warnings: string[] = [];

const read = (p: string) => { // zanity: ignore[assertion-density] -- single-invariant: only valid UTF-8 can be asserted, since every path comes from joins under the repo root
  const body = readFileSync(resolve(p), "utf8");
  assert(!body.includes(NOT_UTF8), `${p} must be valid UTF-8, got a replacement character; re-save it as UTF-8`);
  return body;
};
const MARKDOWN_EXTENSION = ".md";
const dirs = (p: string) => {
  assert(existsSync(p), `${p} must exist before its folders are listed, got none; restore it`);
  const names = readdirSync(p).filter((d) => statSync(join(p, d)).isDirectory());
  assert(names.length > 0, `${p} must hold at least one folder, got none; restore the folders it lists`);
  return names;
};

function frontmatterName(file: string) { // zanity: ignore[assertion-density] -- single-invariant: only a blank declared name can be asserted, since callers pass skill and agent markdown paths
  // Callers reach here for files they have already reported as missing; reading one threw ENOENT and
  // killed the process before the report block could print the error it had just recorded.
  if (!existsSync(file)) return null;
  const block = read(file).match(/^---\n([\s\S]*?)\n---/);
  if (!block) return null;
  const line = block[1].match(/^name:\s*(.+)$/m);
  const name = line ? line[1].trim() : null;
  assert(name === null || name.length > 0, `${file} declares a blank name; give it a frontmatter name`);
  return name;
}

// --- 1. Skills: required files + frontmatter name matches dir ---
const skillsDir = join(PLUGIN, "skills");
const skills = dirs(skillsDir);
for (const skill of skills) {
  const dir = join(skillsDir, skill);
  for (const required of ["SKILL.md", "evals.md"]) {
    if (!existsSync(join(dir, required))) errors.push(`skill "${skill}" is missing ${required}`);
  }
  const name = frontmatterName(join(dir, "SKILL.md"));
  if (name && name !== skill) errors.push(`skill "${skill}": frontmatter name "${name}" != dir name`);
}

// --- 2. Agents: frontmatter name matches filename ---
const agentsDir = join(PLUGIN, "agents");
const agents = readdirSync(agentsDir)
  .filter((f) => f.endsWith(".md"))
  .map((f) => f.replace(/\.md$/, ""));
for (const agent of agents) {
  const name = frontmatterName(join(agentsDir, `${agent}.md`));
  if (name && name !== agent) errors.push(`agent "${agent}": frontmatter name "${name}" != filename`);
}

// --- 2a. Commands: every command file carries a frontmatter description ---
const commandsDir = join(PLUGIN, "commands");
const commands = existsSync(commandsDir)
  ? readdirSync(commandsDir).filter((f) => f.endsWith(".md")).map((f) => f.replace(/\.md$/, ""))
  : [];
for (const command of commands) {
  const block = read(join(commandsDir, `${command}.md`)).match(/^---\n([\s\S]*?)\n---/);
  if (!block || !/^description:\s*\S/m.test(block[1])) errors.push(`command "${command}" has no frontmatter description`);
}

// --- 3. Hooks: valid JSON, references resolve, no orphan hook files ---
const hooksDir = join(PLUGIN, "hooks");
// A colocated `*.test.mjs` is not a hook: it must not inflate the README count, and it will never
// appear in hooks.json, so it must not warn as an orphan either.
const hookFiles = new Set(
  readdirSync(hooksDir).filter((f) => f.endsWith(".mjs") && !f.endsWith(".test.mjs")),
);
const referenced = new Set();
try {
  const raw = read(join(hooksDir, "hooks.json"));
  JSON.parse(raw); // validate
  for (const m of raw.matchAll(/hooks\/([\w.-]+\.mjs)/g)) {
    referenced.add(m[1]);
    if (!hookFiles.has(m[1])) errors.push(`hooks.json references missing hook file "${m[1]}"`);
  }
} catch (e) {
  errors.push(`hooks.json invalid JSON: ${e instanceof Error ? e.message : e}`);
}
for (const f of hookFiles) {
  if (!referenced.has(f)) warnings.push(`hook file "${f}" is not referenced in hooks.json`);
}

// --- 4. Marketplace source resolves to a real plugin ---
const marketplace = JSON.parse(read(join(ROOT, ".claude-plugin", "marketplace.json")));
for (const p of marketplace.plugins ?? []) {
  const manifest = join(ROOT, p.source, ".claude-plugin", "plugin.json");
  if (!existsSync(manifest)) errors.push(`marketplace plugin "${p.name}": source "${p.source}" has no .claude-plugin/plugin.json`);
}

// --- 5. README inventory counts match reality ---
const readme = read(join(ROOT, "README.md"));
for (const [label, actual] of [
  ["skills", skills.length],
  ["agents", agents.length],
  ["hooks", hookFiles.size],
]) {
  const m = readme.match(new RegExp(`(\\d+)\\s+${label}\\b`));
  if (m && Number(m[1]) !== actual) errors.push(`README says "${m[1]} ${label}", actual is ${actual}`);
}

// --- 6. Every skill/agent is documented in the canonical inventory ---
// One place, deliberately. These tables used to be repeated in plugin/README.md, docs/skill-graph.md
// and docs/onboarding.md; the guard only ever checked that a NAME appeared, never that the three
// descriptions agreed — and they drifted (onboarding still described the format hook as running
// `pnpm exec prettier` long after the hook stopped using pnpm). The other docs now link here.
const skillGraph = read(join(ROOT, "docs", "skill-graph.md"));
for (const skill of skills) {
  if (!skillGraph.includes(skill)) errors.push(`skill "${skill}" is not documented in docs/skill-graph.md`);
}
for (const agent of agents) {
  if (!skillGraph.includes(agent)) errors.push(`agent "${agent}" is not documented in docs/skill-graph.md`);
}

// --- 6a. No doc references a skill or agent that does not exist ---
// Section 6 checks presence: every skill reaches the inventory. It never checked absence, so a
// reference SURVIVING a deletion was invisible — a merged skill's old name sat in repo-forensics for
// the rest of that release, and a later rename left the same reference in the same file. Same rot
// class as the onboarding.md drift, on the other side of the equality.
// Only names that must resolve locally are checked: a bare `Skill(x)` / `Agent(x)` / `/x`, or an
// explicit `gated-delivery:` prefix. A name carrying another plugin's prefix lives outside this repo and
// cannot be verified from here.
const NOT_LOCAL_NAMES = new Set([
  // Claude Code built-ins.
  "compact", "plugin", "goal", "reload-plugins", "security-review", "code-review",
  // Placeholders in skill-graph.md's explanation of the notation itself.
  "name", "skill-name",
]);
const markdownFiles = (dir: string): string[] => { // zanity: ignore[assertion-density] -- recursive-walker: it lists folders that readdir just returned and the earlier reads already failed on a missing docs folder
  const found = readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? markdownFiles(join(dir, e.name)) : e.name.endsWith(MARKDOWN_EXTENSION) ? [join(dir, e.name)] : [],
  );
  return found;
};
const localNames = new Set([...skills, ...agents, ...commands]);
const LOCAL_PREFIX_PATTERN = /^gated-delivery:/;
const RESOLVABLE_NAMES = new Set([...NOT_LOCAL_NAMES, ...localNames]);
const docFiles = [
  ...markdownFiles(PLUGIN),
  ...markdownFiles(join(ROOT, "docs")),
  join(ROOT, "README.md"),
];
for (const file of docFiles) {
  const body = read(file);
  const referenced = [
    // `Agent(subagent_type: x)` is the form docs/skill-graph.md documents for agents, and it is the
    // form /slice actually uses; without the optional prefix the extractor matched none of them.
    ...body.matchAll(/(?:Skill|Agent)\(\s*"?(?:subagent_type:\s*)?([\w:-]+)"?\s*\)/g),
    ...body.matchAll(/`\/([a-zA-Z][\w-]*)`/g),
    // A bare `gated-delivery:x` or `/gated-delivery:x` outside a Skill()/Agent() call — how prod-support and
    // the README name the reviewer agent, and how commands are invoked.
    ...body.matchAll(/`\/?gated-delivery:([\w-]+)`/g),
  ].map((m) => m[1]);
  const unresolved = new Set(
    referenced.map((raw) => raw.replace(LOCAL_PREFIX_PATTERN, "")).filter((name) => !name.includes(":") && !RESOLVABLE_NAMES.has(name)),
  );
  for (const name of unresolved) {
    errors.push(`${file.slice(ROOT.length + 1)} references "${name}", which is not a skill or agent in this repo`);
  }
}

// --- 6a'. Manifest descriptions advertise only what ships ---
// Both manifests kept advertising a story-rewrite skill after it was deleted; prose cannot be resolved
// against the inventory, so descriptions name skills as `/name` and every such name must resolve.
// A slash preceded by a word character, dot or slash is a path or an "and/or", not a skill.
const pluginManifest = join(PLUGIN, ".claude-plugin", "plugin.json");
const manifestDescriptions = [
  ["plugin/.claude-plugin/plugin.json", existsSync(pluginManifest) ? [JSON.parse(read(pluginManifest)).description] : []],
  [".claude-plugin/marketplace.json", (marketplace.plugins ?? []).map((p: { description: string }) => p.description)],
];
for (const [manifest, descriptions] of manifestDescriptions) {
  for (const description of descriptions.filter(Boolean)) {
    for (const [, raw] of description.matchAll(/(?<![\w./])\/([a-z][\w:-]*)/g)) {
      const name = raw.replace(LOCAL_PREFIX_PATTERN, "");
      if (!name.includes(":") && !RESOLVABLE_NAMES.has(name)) errors.push(`${manifest} description names "/${raw}", which is not a skill or command in this repo`);
    }
  }
}

// --- 6b. References: the index, the files and the skills that read them agree ---
// The asset class sections 6 and 6a could not see. Deleting a reference, then deleting
// plugin/references/ entirely, both left this guard's output byte-identical. A file with no row is
// unreachable, because a skill reaches a reference only through the index; a row with no file is a
// dangling read at the point a skill follows it.
const referencesDir = join(PLUGIN, "references");
const REFERENCE_INDEX = "reference-graph.md";
const referenceFiles = existsSync(referencesDir)
  ? readdirSync(referencesDir).filter((f) => f.endsWith(".md") && f !== REFERENCE_INDEX)
  : [];
if (existsSync(referencesDir)) {
  const indexPath = join(referencesDir, REFERENCE_INDEX);
  if (!existsSync(indexPath)) {
    errors.push(`plugin/references/ has no ${REFERENCE_INDEX}`);
  } else {
    const index = read(indexPath);
    for (const file of referenceFiles) {
      if (!index.includes(file)) errors.push(`reference "${file}" is not indexed in plugin/references/${REFERENCE_INDEX}`);
    }
    // Every bare `.md` filename the index names, whatever notation carries it. Matching the link
    // form `](./x.md)` alone left `](x.md)` and a plain-text row green over a deleted file, while
    // the file->row half above is notation-agnostic — so the two halves disagreed about what a row
    // is. A name carrying a slash is a path to another document, not a reference beside this one.
    const named = new Set([...index.matchAll(/(?:^|[^\w./-])([\w-]+\.md)\b/g)].map((m) => m[1]));
    named.delete(REFERENCE_INDEX);
    // The index tells skills to read client context from CLAUDE.md; that names a convention, not a file here.
    named.delete("CLAUDE.md");
    for (const name of named) {
      if (!existsSync(join(referencesDir, name))) {
        errors.push(`plugin/references/${REFERENCE_INDEX} names "${name}", which does not exist`);
      }
    }
    if (!skillGraph.includes(REFERENCE_INDEX)) {
      errors.push(`docs/skill-graph.md does not document plugin/references/${REFERENCE_INDEX}`);
    }
  }
} else {
  for (const file of docFiles) {
    if (read(file).includes(REFERENCE_INDEX)) {
      errors.push(`${file.slice(ROOT.length + 1)} points at ${REFERENCE_INDEX}, which no longer exists`);
    }
  }
}

// --- 6c. A relative path from a skill resolves to a file that is there ---
// Skills reach shared assets by a path relative to their own SKILL.md — the templates and the
// reference index both travel that way. Nothing resolved one, so a moved asset or a wrong number
// of `../` segments failed silently at read time, in the installed plugin rather than in CI.
for (const skill of skills) {
  const skillFile = join(skillsDir, skill, "SKILL.md");
  if (!existsSync(skillFile)) continue;
  for (const m of read(skillFile).matchAll(/`((?:\.\.\/)+[\w./-]+\.(?:md|html|json))`/g)) {
    if (!existsSync(resolve(join(skillsDir, skill), m[1]))) {
      errors.push(`${skill}/SKILL.md points at "${m[1]}", which does not resolve from that directory`);
    }
  }
}

// --- 6d. Every skill's evals.md carries a runnable fence ---
// WARN, not ERROR: writing real checks for a new skill is judgment work, not drift. But without
// this, `run-checks.ts --lint` reports "all runnable across N skills" while a skill contributes
// zero checks — a green that means nothing was measured.
// Asks the runner rather than grepping for the heading: a heading with no ```bash fence under it
// parses as zero checks, and a substring test would call that skill covered.
for (const skill of skills) {
  const evalsPath = join(skillsDir, skill, "evals.md");
  if (existsSync(evalsPath) && parseChecks(read(evalsPath)).checks.length === 0) {
    warnings.push(`skill "${skill}" has no runnable "## Deterministic Checks" fence — --lint measures nothing for it`);
  }
}

for (const skill of skills) {
  const evalsPath = join(skillsDir, skill, "evals.md");
  if (!existsSync(evalsPath)) continue;
  for (const check of parseChecks(read(evalsPath)).checks.filter((c) => !c.expects.length)) {
    warnings.push(`${skill}/evals.md: check "${check.label}" has no "# expect:" line — --scenario cannot grade it`);
  }
}

// --- 6e. Skill and agent prose avoids the phrases the writing rules ban ---
// shortcut: writing.md bans these in prose, not in a machine-readable list; extend this constant when
// writing.md's "the phrases ..." line changes, or move that list into a parseable block.
// prose-writing is exempt because its own greps and rules have to name the phrases they ban.
const BANNED_PHRASES = ["earns its place", "load-bearing"];
const PHRASE_RULE_OWNER = "prose-writing";
const instructionFiles = [
  ...skills.filter((s) => s !== PHRASE_RULE_OWNER).flatMap((s) => markdownFiles(join(skillsDir, s))),
  ...agents.map((a) => join(agentsDir, `${a}.md`)),
];
for (const file of instructionFiles) {
  read(file).split("\n").forEach((line, i) => {
    for (const phrase of BANNED_PHRASES) {
      if (line.toLowerCase().includes(phrase)) {
        errors.push(`${file.slice(ROOT.length + 1)}:${i + 1} uses banned phrase "${phrase}" (plugin/skills/prose-writing/writing.md). Hint: reword the sentence.`);
      }
    }
  });
}

// --- 7. Eval measures: the traps that scored a broken check as a passing one ---
// All WARN, not ERROR: each needs a human to confirm it's a real collision.
for (const skill of skills) {
  const evalsPath = join(skillsDir, skill, "evals.md");
  const skillPath = join(skillsDir, skill, "SKILL.md");
  if (!existsSync(evalsPath) || !existsSync(skillPath)) continue;
  const lines = read(evalsPath).split("\n");
  // Headings the skill emits. A measure keyed on one of these can pass without the behaviour.
  const headings = read(skillPath)
    .split("\n")
    .filter((l) => /^#{2,4}\s/.test(l))
    .map((l) => l.replace(/^#+\s*/, "").toLowerCase());

  // (c) The same collision inside the ## Deterministic Checks fence. Trap (b) only reads table
  //     cells, so a fence check keyed on a heading word went unseen — `grep -iEc "draft"` scored a
  //     run that refused to open the draft PR. Only a bare word is flagged: a pattern carrying
  //     structure, like `route (a|b|c)`, is scoped by that structure and is not this trap.
  // Walk the section with fence state. A `## ` boundary alone was wrong: a `## ...` shell comment
  //  inside the bash fence ended the section early, so every check after it went unscanned.
  const evalLines = read(evalsPath).split("\n");
  const sectionStart = evalLines.findIndex((l) => l.startsWith("## Deterministic Checks"));
  const section = [];
  for (let j = sectionStart + 1, inFence = false; sectionStart !== -1 && j < evalLines.length; j++) {
    const line = evalLines[j];
    if (line.trimStart().startsWith("```")) {
      inFence = !inFence;
      section.push({ line: "", at: j });
      continue;
    }
    if (!inFence && /^## /.test(line)) break;
    section.push({ line: inFence ? line : "", at: j });
  }
  section.forEach(({ line, at: lineNo }) => {
    if (!line.trim() || line.trimStart().startsWith("#")) return;
    // Some collisions are the point: a check can assert the skill emitted that very heading.
    // `# heading-match-intended` says so on the line, so the warning keeps meaning something.
    if (line.includes("heading-match-intended")) return;
    for (const m of line.matchAll(/"([^"]*)"/g)) {
      for (const alt of m[1].split("|")) {
        const term = alt.trim().toLowerCase();
        if (!/^[a-z][a-z ]{3,}$/.test(term)) continue;
        const clash = headings.find((h) => h.includes(term));
        if (clash) {
          warnings.push(
            `${skill}/evals.md:${lineNo + 1}: check keyed on "${term}", also in SKILL.md heading "${clash}" — it may match a failing run`,
          );
        }
      }
    }
  });

  lines.forEach((line, i) => {
    if (!line.trimStart().startsWith("|")) return;
    const at = `${skill}/evals.md:${i + 1}`;

    // (a) An unescaped pipe inside a code span splits the table cell, so the command renders
    //     truncated. Escaping it as \| fixes rendering but breaks the raw text an agent copies.
    //     Multiple -e flags are correct in both.
    for (const span of line.match(/`[^`]*`/g) ?? []) {
      if (span.includes("|") && !span.includes("\\|")) {
        warnings.push(`${at}: unescaped "|" in a table-cell code span — use repeated -e flags instead`);
      }
    }

    // (b) A measure keyed on a word that is also one of the skill's own headings fires on any
    //     output of that shape, including a run that failed the scenario.
    for (const m of line.matchAll(/-e\s+(?:"([^"]+)"|([A-Za-z][\w./-]{3,}))/g)) {
      const term = (m[1] ?? m[2]).toLowerCase();
      if (term.length < 4) continue;
      const clash = headings.find((h) => h.includes(term));
      if (clash) {
        warnings.push(`${at}: measure "${term}" also appears in SKILL.md heading "${clash}" — it may match a failing run`);
      }
    }
  });
}

// --- 8. zanity stays at its strictest: the rules about the rules ---
// A red zanity run is fixed in code. Narrowing `select`, adding a `disable`, or excluding a path
// is the escape hatch an agent reaches for, so the guard fails on each one. The only exception is
// the test-file table: tests spawn processes and use temp folders.
const ZANITY_CONFIG = "zanity.toml";
const ZANITY_ALLOWED_EXCLUDES = ["tests/fixtures/", "evals/fixtures/"];
const ZANITY_TEST_FILES_TABLES = ['paths."**/*.test.mjs"', 'paths."**/*.test.ts"'];
const ZANITY_TEST_FILES_RELAXED_RULES = ["filesystem-in-test", "process-in-test"];
const ZANITY_ALLOWED_DISABLES: Record<string, string[]> = Object.fromEntries(
  ZANITY_TEST_FILES_TABLES.map((table) => [table, ZANITY_TEST_FILES_RELAXED_RULES]),
);
const ZANITY_TEST_FILES_TABLE_LIST = ZANITY_TEST_FILES_TABLES.map((table) => `[${table}]`).join(" or ");
const QUOTED_ITEM = /"([^"]*)"/g;
const LIST_FILLER = /[\s,]/g;
const TOML_TABLE_HEADER = /^\[([^\]]+)\]\s*$/m;
const DISABLE_LIST = /^\s*disable\s*=\s*\[([^\]]*)\]/gm;
const PATHS_KEY = /^\s*paths\b/m;
const BYTE_ORDER_MARK = "\uFEFF";

const quotedItems = (list: string) => {
  assert(list.replace(QUOTED_ITEM, "").replace(LIST_FILLER, "") === "", `${ZANITY_CONFIG} lists must hold only double-quoted strings, got ${list.trim()}; quote each item with double quotes`);
  const items = [...list.matchAll(QUOTED_ITEM)].map((match) => match[1]);
  assert(items.every((item) => item.length > 0), `${ZANITY_CONFIG} lists must not hold blank items, got ${JSON.stringify(items)}; remove the empty string`);
  return items;
};

const zanityConfigPath = join(ROOT, ZANITY_CONFIG);
if (!existsSync(zanityConfigPath)) {
  errors.push(`${ZANITY_CONFIG} is missing. Hint: zanity is a required check, so the repo must configure it.`);
} else if (read(zanityConfigPath).startsWith(BYTE_ORDER_MARK)) {
  errors.push(`${ZANITY_CONFIG} starts with a byte order mark, which hides its first line from the guard. Hint: re-save it without one.`);
} else {
  const config = read(zanityConfigPath).replace(/#.*$/gm, "");
  if (!/^select\s*=\s*\["all"\]/m.test(config)) {
    errors.push(`${ZANITY_CONFIG} must keep select = ["all"] under [rules]. Hint: restore it and fix the findings in code.`);
  }
  const [topLevel, ...headersAndBodies] = config.split(TOML_TABLE_HEADER);
  const tables = [{ header: "", body: topLevel }];
  for (let i = 0; i < headersAndBodies.length; i += 2) tables.push({ header: headersAndBodies[i].trim(), body: headersAndBodies[i + 1] });
  for (const { header, body } of tables) {
    const scopesPaths = header === "paths" || header.startsWith("paths.");
    const expected = ZANITY_ALLOWED_DISABLES[header] ?? [];
    const disabled = [...body.matchAll(DISABLE_LIST)].flatMap(([, list]) => quotedItems(list));
    if (scopesPaths && !ZANITY_TEST_FILES_TABLES.includes(header)) {
      errors.push(`${ZANITY_CONFIG} scopes rules off in [${header}]. Hint: only ${ZANITY_TEST_FILES_TABLE_LIST} may do that, so fix the findings in code instead.`);
    } else if (!scopesPaths && PATHS_KEY.test(body)) {
      errors.push(`${ZANITY_CONFIG} sets a paths key outside a [paths...] table. Hint: only ${ZANITY_TEST_FILES_TABLE_LIST} may scope rules off, written as its own table.`);
    } else if (disabled.length !== expected.length || !expected.every((rule) => disabled.includes(rule))) {
      errors.push(`${ZANITY_CONFIG} disables ${disabled.join(", ") || "nothing"} under [${header || "top level"}]. Hint: only ${Object.entries(ZANITY_ALLOWED_DISABLES).map(([table, rules]) => `[${table}] may disable exactly ${rules.join(", ")}`).join(" and ")}; fix the findings in code instead.`);
    }
  }
  const excluded = quotedItems(config.match(/^exclude\s*=\s*\[([^\]]*)\]/m)?.[1] ?? "");
  for (const path of excluded.filter((p) => !ZANITY_ALLOWED_EXCLUDES.includes(p))) {
    errors.push(`${ZANITY_CONFIG} excludes ${path}, which hides it from every check. Hint: only ${ZANITY_ALLOWED_EXCLUDES.join(", ")} may be excluded.`);
  }
}

// --- 9. Skills and agents state what they are for: a non-empty frontmatter description ---
// The description is the only text a model sees before it decides to load a skill or call an agent,
// so a blank one hides the asset. Commands got this check in 2a; skills and agents never did.
const DESCRIPTION_LINE = /^description:[ \t]*\S/m;
const FRONTMATTER_BLOCK = /^---\n([\s\S]*?)\n---/;
const describedAssets = [
  ...skills.map((skill) => ({ label: `skill "${skill}"`, file: join(skillsDir, skill, "SKILL.md") })),
  ...agents.map((agent) => ({ label: `agent "${agent}"`, file: join(agentsDir, `${agent}.md`) })),
];
for (const { label, file } of describedAssets.filter(({ file }) => existsSync(file))) {
  const block = read(file).match(FRONTMATTER_BLOCK);
  if (!block || !DESCRIPTION_LINE.test(block[1])) {
    errors.push(`${label} has no frontmatter description. Hint: add a "description:" line saying what it does and when to use it.`);
  }
}

// --- 10. Scenario ids in an evals.md are unique ---
// run-scenarios.ts and `# expect: ... on <id>` address a scenario by its id; scenarioIds() returns a
// Set, so a repeated id collapses silently and one scenario is never run or graded.
const SCENARIOS_HEADING = "## Test Scenarios";
const SCENARIO_ROW_ID = /^\|\s*(\d+)\s*\|/;
for (const skill of skills) {
  const evalsPath = join(skillsDir, skill, "evals.md");
  if (!existsSync(evalsPath)) continue;
  const seen = new Set();
  let inScenarios = false;
  for (const line of read(evalsPath).split("\n")) {
    if (line.startsWith("## ")) inScenarios = line.startsWith(SCENARIOS_HEADING);
    const id = inScenarios ? line.match(SCENARIO_ROW_ID)?.[1] : undefined;
    if (id && seen.has(id)) errors.push(`${skill}/evals.md repeats scenario id ${id}. Hint: ids stay stable, so give the newer row the next unused number.`);
    if (id) seen.add(id);
  }
}

// --- 10a. Every skill's evals.md carries at least one scenario row ---
// A runner given an evals.md with no rows runs nothing and exits 0, and evals.md sits outside the
// eval stamp hash, so deleting every row stays green everywhere else.
for (const skill of skills) {
  const evalsPath = join(skillsDir, skill, "evals.md");
  if (existsSync(evalsPath) && scenarioIds(read(evalsPath)).size === 0) {
    errors.push(`${skill}/evals.md has no scenario row under "${SCENARIOS_HEADING}". Hint: add one table row with a stable id, a prompt and its pass criteria.`);
  }
}

// --- 11. A script path in the docs resolves, and a skill script it names is executable ---
// Skills call their scripts as "<skill base directory>/scripts/x.sh", which needs the exec bit, and
// docs name them by the same path. A renamed script left the prose pointing at nothing, and a lost
// mode bit fails only when an agent runs it.
const SCRIPT_REFERENCE = /\bscripts\/([\w-]+\.(?:sh|mjs))/g;
const EXECUTE_BITS = 0o111;
const skillScripts = new Map(
  skills.flatMap((skill) => {
    const scriptsDir = join(skillsDir, skill, "scripts");
    return existsSync(scriptsDir) ? readdirSync(scriptsDir).map((name) => [name, join(scriptsDir, name)]) : [];
  }),
);
const repoScriptsDir = join(ROOT, "scripts");
for (const file of docFiles) {
  const shown = file.slice(ROOT.length + 1);
  for (const name of new Set([...read(file).matchAll(SCRIPT_REFERENCE)].map((m) => m[1]))) {
    const skillScript = skillScripts.get(name);
    if (!skillScript && !existsSync(join(repoScriptsDir, name))) {
      errors.push(`${shown} names scripts/${name}, which exists under no skill and not in scripts/. Hint: fix the path or restore the script.`);
    } else if (skillScript && !(statSync(skillScript).mode & EXECUTE_BITS)) {
      errors.push(`${shown} names ${skillScript.slice(ROOT.length + 1)}, which is not executable. Hint: chmod +x it and commit the mode.`);
    }
  }
}

// --- 12. Every reference is read by a skill, agent or command ---
// The index lists a reference, but a row proves nothing reads it: a reference nothing points at is
// dead weight a model never loads. The index itself is the entry point and is exempt.
const readers = [
  ...skills.flatMap((skill) => markdownFiles(join(skillsDir, skill))),
  ...agents.map((agent) => join(agentsDir, `${agent}.md`)),
  ...commands.map((command) => join(commandsDir, `${command}.md`)),
].filter((file) => existsSync(file));
const readerText = readers.map((file) => read(file)).join("\n");
for (const file of referenceFiles) {
  if (!readerText.includes(file)) errors.push(`reference "${file}" is read by no skill, agent or command. Hint: link it from the skill that needs it, or delete it.`);
}

// --- 13. Every hook has a colocated behaviour test ---
// docs/development.md tells contributors `node --test plugin/hooks/*.test.mjs` covers hook behaviour; a hook with
// no test file is outside that run, so its failure mode is only ever found in a client's session.
for (const hook of hookFiles) {
  if (!existsSync(join(hooksDir, hook.replace(/\.mjs$/, ".test.mjs")))) {
    errors.push(`hook "${hook}" has no colocated ${hook.replace(/\.mjs$/, ".test.mjs")}. Hint: add a test that runs the hook and asserts its decision.`);
  }
}

// --- 14. Every hook is documented in the canonical inventory ---
// Section 6 covers skills and agents. A hook whose file name is absent from docs/skill-graph.md ships
// behaviour that no doc tells a user about.
for (const hook of hookFiles) {
  if (!skillGraph.includes(hook)) errors.push(`hook "${hook}" is not documented in docs/skill-graph.md. Hint: add a row naming it and what it does.`);
}

// --- 15. The two manifests carry one version ---
// plugin.json and marketplace.json each state a version; a release that bumps one leaves installs
// resolving different versions depending on the path they came through.
const manifestVersions = [
  ["plugin/.claude-plugin/plugin.json", existsSync(pluginManifest) ? JSON.parse(read(pluginManifest)).version : undefined],
  [".claude-plugin/marketplace.json", marketplace.metadata?.version],
].filter(([, version]) => version !== undefined);
if (new Set(manifestVersions.map(([, version]) => version)).size > 1) {
  errors.push(`manifest versions disagree: ${manifestVersions.map(([file, version]) => `${file} says ${version}`).join(", ")}. Hint: bump both in the same commit.`);
}

// --- 16. Every GATED_DELIVERY_ variable the code reads is documented ---
// A knob nobody can find is not a knob: run-scenarios once read a variable that
// no markdown named until this check existed.
const ENV_VAR = /GATED_DELIVERY_[A-Z0-9_]+/g;
const SOURCE_EXTENSIONS = [".mjs", ".ts", ".sh"];
const SCRIPT_SOURCE_EXTENSIONS = [".mjs", ".ts"];
const TEST_FILE_SUFFIXES = [".test.mjs", ".test.ts"];
const sourceFiles = [PLUGIN, join(ROOT, "scripts")]
  .filter((dir) => existsSync(dir))
  .flatMap((dir) =>
    readdirSync(dir, { recursive: true, encoding: "utf8" })
      .filter((name) => SOURCE_EXTENSIONS.some((extension) => name.endsWith(extension)) && !TEST_FILE_SUFFIXES.some((suffix) => name.endsWith(suffix)))
      .map((name) => join(dir, name)),
  );
const documentedVars = new Set(docFiles.flatMap((file) => read(file).match(ENV_VAR) ?? []));
for (const file of sourceFiles) {
  for (const name of new Set(read(file).match(ENV_VAR) ?? [])) {
    if (!documentedVars.has(name)) {
      errors.push(`${file.slice(ROOT.length + 1)} reads ${name}, which no markdown names. Hint: add it to the knobs table in docs/onboarding.md.`);
    }
  }
}

// --- 17. No condition that is always true or always false ---
// A check whose outcome never varies tests nothing: `assert(true, ...)`, `if (1 === 1)`, or a check on
// a constant declared in the same file. Making a rule pass with one is never a fix, so the guard fails.
// Only conditions decidable from the text alone are caught: every name in the condition is a keyword,
// a pure global, or a same-file `const` bound to a number, string, boolean or null (an array or object
// literal can be mutated, so it is not constant).
const CHECK_OPENER = /\b(?:console\.assert|assert\.ok|assert|if|while)\s*\(/g;
const LITERAL_CONST = /^\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(-?\d[\d_.]*|"[^"\n]*"|'[^'\n]*'|true|false|null)\s*;?\s*$/gm;
const STRING_LITERAL = /"[^"\n]*"|'[^'\n]*'|`[^`\n]*`/g;
const BARE_NAME = /(?<![.\w$])[A-Za-z_$][\w$]*/g;
const CONSTANT_KEYWORDS = new Set(["typeof", "true", "false", "null", "undefined", "void", "in", "instanceof"]);
const PURE_GLOBALS = new Set(["Number", "String", "Boolean", "Array", "Math", "Object"]);

for (const file of sourceFiles.filter((name) => SCRIPT_SOURCE_EXTENSIONS.some((extension) => name.endsWith(extension)))) {
  const text = read(file)
    .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "))
    .replace(/(^|\s)\/\/.*$/gm, (comment) => comment.replace(/[^\n]/g, " "));
  const constants = new Set([...text.matchAll(LITERAL_CONST)].map(([, name]) => name));
  for (const opener of text.matchAll(CHECK_OPENER)) {
    const callee = opener[0].replace(/\s*\($/, "");
    const firstArgumentOnly = callee !== "if" && callee !== "while";
    const openIndex = opener.index + opener[0].length - 1;
    let condition = "";
    let depth = 1;
    let quote = "";
    for (let index = openIndex + 1; index < text.length; index++) {
      const char = text[index];
      if (quote) {
        if (char === "\\") index++;
        else if (char === quote) quote = "";
      } else if (char === '"' || char === "'" || char === "`") quote = char;
      else if ("([{".includes(char)) depth++;
      else if (")]}".includes(char)) depth--;
      if (depth === 0 || (firstArgumentOnly && depth === 1 && char === ",")) {
        condition = text.slice(openIndex + 1, index);
        break;
      }
    }
    const names = condition.replace(STRING_LITERAL, "").match(BARE_NAME) ?? [];
    const decidable = condition.trim() !== "" && names.every((name) => CONSTANT_KEYWORDS.has(name) || PURE_GLOBALS.has(name) || constants.has(name));
    if (decidable) {
      const line = text.slice(0, opener.index).split("\n").length;
      errors.push(`${file.slice(ROOT.length + 1)}:${line} ${callee}(${condition.trim()}) has a condition that never varies. Hint: delete it, or test a value that can change.`);
    }
  }
}

// --- 18. A skill changed against the base ref carries a matching eval stamp ---
const STAMP_PROBLEM = {
  missing: "has no stamp",
  stale: "has a stamp for different content",
  "blank-waiver": "has a waiver with no reason",
  "waived-and-static": "has a stamp that is both a waiver and a static stamp",
  "static-incomplete": "has a static stamp that is empty, holds a check that did not pass, or lacks a registered check",
};
const baseRef = process.env[BASE_REF_ENV] || null;
if (baseRef) {
  for (const skill of changedSkills(ROOT, baseRef)) {
    const status = stampStatus(ROOT, skill);
    if (status === "waived") {
      warnings.push(`skill ${skill} ships on a waiver: ${waiverReason(ROOT, skill)}. Hint: run node scripts/eval/changed-skills.ts and replace evals/results/${skill}.json once credentials exist`);
    } else if (status !== "ok" && status !== "static") {
      errors.push(`skill ${skill} ${STAMP_PROBLEM[status]}. Hint: skill ${skill} changed since its evals last passed; run node scripts/eval/changed-skills.ts --static ${skill} (no model run) or the live run, and commit evals/results/${skill}.json`);
    }
  }
}

// --- 19. A change to shipped plugin files against the base ref carries a version bump ---
// Installs cache the plugin by version. Behaviour merged under a version that did not change never
// reaches an install, so a hook deleted from main kept firing from the cached copy and failed every
// Stop event with MODULE_NOT_FOUND.
const PLUGIN_PREFIX = "plugin/";
const VERSION_FILE = "plugin/.claude-plugin/plugin.json";
const TEST_FILE_NAME = /\.test\.[^/]+$/;
const MAX_NAMED_FILES = 3;
if (baseRef) {
  const shipped = [...changedPaths(ROOT, baseRef)]
    .filter((path) => path.startsWith(PLUGIN_PREFIX) && path !== VERSION_FILE && !TEST_FILE_NAME.test(path))
    .sort();
  const versionAtBase = JSON.parse(fileAtBase(ROOT, baseRef, VERSION_FILE) ?? "{}").version;
  const versionNow = existsSync(pluginManifest) ? JSON.parse(read(pluginManifest)).version : undefined;
  if (shipped.length && versionAtBase !== undefined && versionAtBase === versionNow) {
    const named = shipped.slice(0, MAX_NAMED_FILES).join(", ");
    const more = shipped.length > MAX_NAMED_FILES ? ` and ${shipped.length - MAX_NAMED_FILES} more` : "";
    errors.push(`plugin files changed (${named}${more}) but the version is still ${versionNow}. Installs cache the plugin by version, so they never receive these changes. Hint: bump the version in ${VERSION_FILE} and .claude-plugin/marketplace.json in this PR`);
  }
}

// --- 20. Shipped plugin code imports no TypeScript file ---
// Plugin code and its tests run on Node 18 and 20, which cannot load .ts: a test importing a dev
// helper from scripts/ failed there with ERR_UNKNOWN_FILE_EXTENSION.
const PLUGIN_SCRIPT_EXTENSIONS = [".mjs", ".js", ".cjs", ".ts", ".mts", ".cts"];
const TYPESCRIPT_IMPORT = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["'][^"'\n]*\.[cm]?ts["']/g;
const pluginScripts = existsSync(PLUGIN)
  ? readdirSync(PLUGIN, { recursive: true, encoding: "utf8" })
      .filter((name) => !name.split(sep).includes("node_modules") && PLUGIN_SCRIPT_EXTENSIONS.some((extension) => name.endsWith(extension)))
      .map((name) => join(PLUGIN, name))
  : [];
for (const file of pluginScripts) {
  for (const specifier of read(file).match(TYPESCRIPT_IMPORT) ?? []) {
    errors.push(`${file.slice(ROOT.length + 1)} imports TypeScript (${specifier.trim()}). Hint: plugin code and tests run on Node 18 and 20, which cannot load .ts; import a .mjs file instead.`);
  }
}

// --- 21. Cursor config and AGENTS.md point at real files, and the shell guard fails closed ---
const CURSOR_HOOKS_FILE = ".cursor/hooks.json";
const CURSOR_RULES_DIR = ".cursor/rules";
const AGENTS_FILE = "AGENTS.md";
const HOOK_SCRIPT_REFERENCE = /[\w./-]+\.(?:mjs|ts|sh|js)\b/g;
const BACKTICKED_FILE = /`([\w./-]+\.(?:mjs|ts|json|md|mdc|toml|yml))`/g;
const SHELL_GUARD_EVENT = "beforeShellExecution";
const cursorHooksPath = join(ROOT, CURSOR_HOOKS_FILE);
const cursorRulesPath = join(ROOT, CURSOR_RULES_DIR);
const agentsPath = join(ROOT, AGENTS_FILE);
if (existsSync(cursorHooksPath)) {
  const events: Record<string, { command?: string; failClosed?: boolean }[]> = JSON.parse(read(cursorHooksPath)).hooks ?? {};
  for (const [event, hooks] of Object.entries(events)) {
    for (const hook of hooks) {
      for (const script of hook.command?.match(HOOK_SCRIPT_REFERENCE) ?? []) {
        if (!existsSync(join(ROOT, script))) errors.push(`${CURSOR_HOOKS_FILE}: ${event} runs ${script}, which does not exist. Hint: point the hook at a real script or remove it.`);
      }
      if (event === SHELL_GUARD_EVENT && hook.failClosed !== true) {
        errors.push(`${CURSOR_HOOKS_FILE}: the ${event} hook "${hook.command}" must set "failClosed": true. Hint: Cursor lets the command run when a hook crashes unless failClosed is set.`);
      }
    }
  }
}
if (existsSync(cursorRulesPath)) {
  for (const name of readdirSync(cursorRulesPath)) {
    if (!name.endsWith(".mdc")) errors.push(`${CURSOR_RULES_DIR}/${name} is not .mdc, so Cursor ignores it. Hint: rename it to .mdc.`);
    else if (!read(join(cursorRulesPath, name)).includes(AGENTS_FILE)) errors.push(`${CURSOR_RULES_DIR}/${name} does not point at ${AGENTS_FILE}. Hint: keep the rules in ${AGENTS_FILE} and have this file refer to it.`);
  }
}
if (existsSync(cursorHooksPath) || existsSync(cursorRulesPath)) {
  if (!existsSync(agentsPath)) errors.push(`${AGENTS_FILE} is missing but .cursor/ points at it. Hint: restore ${AGENTS_FILE}.`);
}
if (existsSync(agentsPath)) {
  for (const [, path] of read(agentsPath).matchAll(BACKTICKED_FILE)) {
    if (!existsSync(join(ROOT, path))) errors.push(`${AGENTS_FILE} names ${path}, which does not exist. Hint: fix the path or drop the rule's reference.`);
  }
}

// --- 22. The numbered checks of this guard are unique and run from 1 with no gap ---
const GUARD_SOURCE = "scripts/audit/consistency.ts";
const CHECK_HEADER = /^\/\/ --- (\d+)\. /gm;
const guardSourcePath = join(ROOT, GUARD_SOURCE);
if (existsSync(guardSourcePath)) {
  const checksPerNumber = new Map<number, number>();
  for (const [, digits] of read(guardSourcePath).matchAll(CHECK_HEADER)) {
    checksPerNumber.set(Number(digits), (checksPerNumber.get(Number(digits)) ?? 0) + 1);
  }
  const lastNumber = Math.max(0, ...checksPerNumber.keys());
  for (let number = 1; number <= lastNumber; number++) {
    const count = checksPerNumber.get(number) ?? 0;
    if (count === 0) errors.push(`${GUARD_SOURCE} has no check ${number} but numbers up to ${lastNumber}. Hint: renumber so the checks run from 1 to ${lastNumber} with no gap.`);
    if (count > 1) errors.push(`${GUARD_SOURCE} numbers ${count} checks ${number}. Hint: two branches added a check at once; renumber the later one.`);
  }
}

// --- 23. tsc keeps the flags that find dead and unchecked code ---
const TSCONFIG_FILE = "tsconfig.json";
const REQUIRED_TSC_FLAGS = ["strict", "checkJs", "noUnusedLocals", "noUnusedParameters"];
const tsconfigPath = join(ROOT, TSCONFIG_FILE);
if (!existsSync(tsconfigPath)) {
  errors.push(`${TSCONFIG_FILE} is missing. Hint: restore it; the typecheck job and this guard rely on it.`);
} else {
  const compilerOptions = JSON.parse(read(tsconfigPath)).compilerOptions ?? {};
  for (const flag of REQUIRED_TSC_FLAGS) {
    if (compilerOptions[flag] !== true) errors.push(`${TSCONFIG_FILE} must set compilerOptions.${flag} to true, got ${JSON.stringify(compilerOptions[flag])}. Hint: fix the code the flag reports instead of turning the flag off.`);
  }
}

// --- 24. The repo carries a license and the README links it ---
const LICENSE_FILE = "LICENSE";
const README_FILE = "README.md";
const licensePath = join(ROOT, LICENSE_FILE);
const readmeFilePath = join(ROOT, README_FILE);
if (!existsSync(licensePath) || read(licensePath).trim() === "") {
  errors.push(`${LICENSE_FILE} is missing or empty. Hint: add the license text; without one nobody may reuse the code.`);
} else if (existsSync(readmeFilePath) && !read(readmeFilePath).includes(`](${LICENSE_FILE})`)) {
  errors.push(`${README_FILE} does not link ${LICENSE_FILE}. Hint: add a License section that links it.`);
}

// --- 25. The README states how many skill stamps are live, static and waived, and the numbers are true ---
const STAMPS_DIRECTORY = "evals/results";
const STAMP_STATEMENT = /\*\*(\d+) live, (\d+) static, (\d+) waived\*\* of (\d+) skill stamps/;
const STAMP_STATEMENT_FORM = "**L live, S static, W waived** of N skill stamps";
const stampsDirectoryPath = join(ROOT, STAMPS_DIRECTORY);
if (existsSync(stampsDirectoryPath) && existsSync(readmeFilePath)) {
  const stamps = readdirSync(stampsDirectoryPath).filter((name) => name.endsWith(".json")).map((name) => JSON.parse(read(join(stampsDirectoryPath, name))));
  const waivedCount = stamps.filter((stamp) => Object.hasOwn(stamp, "waived")).length;
  const staticCount = stamps.filter((stamp) => Object.hasOwn(stamp, "static")).length;
  const liveCount = stamps.length - waivedCount - staticCount;
  const actual = `${liveCount} live, ${staticCount} static, ${waivedCount} waived of ${stamps.length}`;
  const stated = read(readmeFilePath).match(STAMP_STATEMENT);
  if (!stated) {
    errors.push(`${README_FILE} has no "${STAMP_STATEMENT_FORM}" line, and ${STAMPS_DIRECTORY} holds ${actual} skill stamps. Hint: state the numbers so a reader sees the eval status.`);
  } else if (stated.slice(1).map(Number).join() !== [liveCount, staticCount, waivedCount, stamps.length].join()) {
    errors.push(`${README_FILE} says ${stated[1]} live, ${stated[2]} static, ${stated[3]} waived of ${stated[4]} skill stamps, but ${STAMPS_DIRECTORY} holds ${actual}. Hint: update the README line when a stamp changes.`);
  }
}

// --- 26. Only allow-listed agents pin a model, and to the value the list names ---
const MODEL_PINNING_AGENTS: Record<string, string> = { scout: "haiku" };
const MODEL_POLICY_HINT = "only the scout pins a model; every other agent inherits the session model";
const MODEL_LINE = /^model:\s*(.*)$/m;
for (const agent of agents) {
  const frontmatter = read(join(agentsDir, `${agent}.md`)).match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
  const pinned = frontmatter.match(MODEL_LINE)?.[1].trim();
  const expected = Object.hasOwn(MODEL_PINNING_AGENTS, agent) ? MODEL_PINNING_AGENTS[agent] : undefined;
  if (pinned === undefined && expected !== undefined) errors.push(`agent "${agent}" has no model, but must pin "${expected}". Hint: ${MODEL_POLICY_HINT}.`);
  if (pinned !== undefined && pinned !== expected) errors.push(`agent "${agent}" pins model "${pinned}"${expected === undefined ? ", but is not allowed to pin one" : `, but must pin "${expected}"`}. Hint: ${MODEL_POLICY_HINT}.`);
}

// --- 27. Every rule in an inventoried instruction file is still present, and every marker line is accounted for ---
const ruleInventories = checkRuleInventories(ROOT);
errors.push(...ruleInventories.problems);
(UNINVENTORIED_FILES_ARE_ERRORS ? errors : warnings).push(...ruleInventories.uninventoried);

// --- 28. Instruction files stay within their token budget ---
const TOKEN_BUDGET_SCRIPT = "scripts/audit/token-budget.ts";
if (existsSync(join(ROOT, TOKEN_BUDGET_SCRIPT))) {
  const tokenBaseline = readBaseline(ROOT);
  if (tokenBaseline === null) errors.push(`${BASELINE_FILE} is missing. Hint: run ${UPDATE_COMMAND}.`);
  else errors.push(...budgetProblems(measureBudgets(ROOT), tokenBaseline));
}

// --- report ---
console.log(
  `gated-delivery audit: ${skills.length} skills, ${agents.length} agents, ${hookFiles.size} hooks` +
    (commands.length ? `, ${commands.length} commands` : "") +
    (referenceFiles.length ? `, ${referenceFiles.length} references` : ""),
);
for (const w of warnings) console.log(`  WARN  ${w}`);
for (const e of errors) console.log(`  ERROR ${e}`);
if (errors.length) {
  console.error(`\n${errors.length} consistency error(s) — fix before merge.`);
  process.exit(1);
}
console.log(warnings.length ? `\nOK (${warnings.length} warning(s)).` : "\nOK.");
