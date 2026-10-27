#!/usr/bin/env node
// Deterministic consistency guard for the gated-delivery plugin repo.
// Catches the mechanical drift class: missing files, name/dir mismatches, dangling
// hook references, doc-vs-reality inventory drift, and wrong counts in the README.
// Zero dependencies (Node built-ins only). Exits non-zero on any ERROR.

import assert from "node:assert";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { parseChecks } from "../eval/run-checks.mjs";

const ROOT = process.cwd();
const PLUGIN = join(ROOT, "plugin");
const errors = [];
const warnings = [];

const read = (p) => {
  const inside = resolve(p);
  assert(inside.startsWith(ROOT + sep), `${p} lies outside the repo root ${ROOT}`);
  const body = readFileSync(inside, "utf8");
  assert(typeof body === "string", `${p} did not read as text`);
  return body;
};
const dirs = (p) => {
  assert(existsSync(p), `${p} must exist to list its subdirectories`);
  const names = readdirSync(p).filter((d) => statSync(join(p, d)).isDirectory());
  assert(Array.isArray(names), `${p} must list as an array`);
  return names;
};

function frontmatterName(file) {
  // Callers reach here for files they have already reported as missing; reading one threw ENOENT and
  // killed the process before the report block could print the error it had just recorded.
  assert(typeof file === "string", "frontmatterName needs a file path");
  if (!existsSync(file)) return null;
  const block = read(file).match(/^---\n([\s\S]*?)\n---/);
  if (!block) return null;
  const line = block[1].match(/^name:\s*(.+)$/m);
  const name = line ? line[1].trim() : null;
  assert(name === null || typeof name === "string", `${file} yielded a non-string frontmatter name`);
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
  errors.push(`hooks.json invalid JSON: ${e.message}`);
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
const markdownFiles = (dir) => {
  assert(typeof dir === "string", "markdownFiles needs a directory path");
  const found = readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? markdownFiles(join(dir, e.name)) : e.name.endsWith(".md") ? [join(dir, e.name)] : [],
  );
  assert(found.every((file) => file.endsWith(".md")), `${dir} yielded a non-markdown file`);
  return found;
};
const localNames = new Set([...skills, ...agents, ...commands]);
const LOCAL_PREFIX = "gated-delivery:";
const isDangling = (raw) => {
  assert(typeof raw === "string", "isDangling needs a referenced name");
  const name = raw.startsWith(LOCAL_PREFIX) ? raw.slice(LOCAL_PREFIX.length) : raw;
  const dangling = !name.includes(":") && !NOT_LOCAL_NAMES.has(name) && !localNames.has(name);
  assert(!dangling || !localNames.has(name), `${name} is both dangling and a local name`);
  return dangling;
};
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
    referenced.filter(isDangling).map((raw) => (raw.startsWith(LOCAL_PREFIX) ? raw.slice(LOCAL_PREFIX.length) : raw)),
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
  [".claude-plugin/marketplace.json", (marketplace.plugins ?? []).map((p) => p.description)],
];
for (const [manifest, descriptions] of manifestDescriptions) {
  for (const description of descriptions.filter(Boolean)) {
    for (const [, raw] of description.matchAll(/(?<![\w./])\/([a-z][\w:-]*)/g)) {
      if (isDangling(raw)) errors.push(`${manifest} description names "/${raw}", which is not a skill or command in this repo`);
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
// this, `run-checks.mjs --lint` reports "all runnable across N skills" while a skill contributes
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
// WARN, not ERROR: a hit can be a quotation that needs a human to judge. prose-writing is exempt
// because its own greps and rules have to name the phrases they ban.
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
        warnings.push(`${file.slice(ROOT.length + 1)}:${i + 1} uses banned phrase "${phrase}" (plugin/skills/prose-writing/writing.md)`);
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
// is the escape hatch an agent reaches for, so the guard fails on each one.
const ZANITY_CONFIG = "zanity.toml";
const ZANITY_ALLOWED_EXCLUDES = ["tests/fixtures/", "evals/fixtures/"];
const QUOTED_ITEM = /"([^"]*)"/g;

const quotedItems = (list) => {
  assert(typeof list === "string", `a TOML list body is text, got ${typeof list}`);
  const items = [...list.matchAll(QUOTED_ITEM)].map((match) => match[1]);
  assert(items.every((item) => typeof item === "string"), `every quoted item is text, got ${items.map((item) => typeof item)}`);
  return items;
};

function zanityConfigErrors(text) {
  assert(typeof text === "string", `${ZANITY_CONFIG} must be read as text, got ${typeof text}`);
  const config = text.replace(/#.*$/gm, "");
  const found = [];
  if (!/^select\s*=\s*\["all"\]/m.test(config)) {
    found.push(`${ZANITY_CONFIG} must keep select = ["all"] under [rules]. Hint: restore it and fix the findings in code.`);
  }
  for (const [, list] of config.matchAll(/^\s*disable\s*=\s*\[([^\]]*)\]/gm)) {
    const rules = quotedItems(list);
    if (rules.length) found.push(`${ZANITY_CONFIG} disables ${rules.join(", ")}. Hint: fix the findings in code instead of turning the rule off.`);
  }
  const excluded = quotedItems(config.match(/^exclude\s*=\s*\[([^\]]*)\]/m)?.[1] ?? "");
  for (const path of excluded.filter((p) => !ZANITY_ALLOWED_EXCLUDES.includes(p))) {
    found.push(`${ZANITY_CONFIG} excludes ${path}, which hides it from every check. Hint: only ${ZANITY_ALLOWED_EXCLUDES.join(", ")} may be excluded.`);
  }
  assert(Array.isArray(found), `the config problems must collect as an array, got ${typeof found}`);
  return found;
}

const zanityConfigPath = join(ROOT, ZANITY_CONFIG);
if (existsSync(zanityConfigPath)) errors.push(...zanityConfigErrors(read(zanityConfigPath)));
else errors.push(`${ZANITY_CONFIG} is missing. Hint: zanity is a required check, so the repo must configure it.`);

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
