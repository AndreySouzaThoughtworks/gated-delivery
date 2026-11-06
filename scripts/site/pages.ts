import assert from "node:assert";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { TIERS, TIER_NONE, guardSectionNumbers, warnOnlyChecks } from "./data.ts";
import type { Agent, Command, Hook, Instruction, PluginScript, SiteData, Skill } from "./data.ts";
import { FRAGMENTS_DIRECTORY, renderFragment } from "./fragments.ts";
import { bulletList, checkCard, escapeHtml, quotation, relativeLink, table } from "./html.ts";
import type { CheckEntry, NavItem, Page } from "./html.ts";

export const GENERATOR_SOURCE = "scripts/site/pages.ts";
export const HAND_WRITTEN_PAGES = [
  { fragment: "home.html", path: "index.html", title: "Home", summary: "Ship every change as small verified slices, with guardrails in the repository." },
  { fragment: "concepts.html", path: "concepts.html", title: "Concepts", summary: "The ideas behind gated-delivery: harden the codebase, turn mistakes into rules, and separate guidance from guardrails." },
];
export const SKILLS_INDEX = "skills/index.html";
export const NAVIGATION: NavItem[] = [
  { path: "index.html", label: "Home" },
  { path: "concepts.html", label: "Concepts" },
  { path: SKILLS_INDEX, label: "Skills" },
  { path: "agents.html", label: "Agents" },
  { path: "commands.html", label: "Commands" },
  { path: "hooks.html", label: "Hooks" },
  { path: "plugin-scripts.html", label: "Plugin scripts" },
  { path: "ci-checks.html", label: "CI checks" },
  { path: "eval-tiers.html", label: "Eval tiers" },
];

const NO_VALUE = "none";
const PERCENT = 100;

export const evidenceRows = ({ mutation, rules, budget }: Instruction) => {
  assert(rules === null || Number.isInteger(rules), `a rule count is a whole number or null, got ${rules}; fix the inventory file.`);
  assert(mutation === null || mutation.killed <= mutation.total, `killed mutants cannot exceed all mutants, got ${mutation?.killed} of ${mutation?.total}; rerun the mutation script.`);
  return [
    ["Rules in the inventory", rules === null ? NO_VALUE : String(rules)],
    ["Mutation score (rules killed)", mutation ? `${mutation.killed} of ${mutation.total} (${mutation.total === 0 ? PERCENT : Math.round((PERCENT * mutation.killed) / mutation.total)}%)` : NO_VALUE],
    ["Token budget", budget === null ? NO_VALUE : `${budget} estimated tokens`],
  ];
};

export const siteVariables = (data: SiteData, checks: CheckEntry[], guardNumbers: number[]) => {
  assert(Array.isArray(data.skills), `the site data must list skills, got ${typeof data.skills}; pass the collected data.`);
  assert(Array.isArray(checks), `the checks must be a list, got ${typeof checks}; pass the registry rows.`);
  const tiers = Object.fromEntries([...TIERS, TIER_NONE].map((tier) => [`tiers.${tier}`, data.skills.filter((skill) => skill.tier === tier).length]));
  return {
    skills: data.skills.length,
    agents: data.agents.length,
    commands: data.commands.length,
    hooks: data.hooks.length,
    pluginScripts: data.pluginScripts.length,
    checks: checks.length,
    guardChecks: checks.filter(({ number }) => guardNumbers.includes(number)).length,
    standaloneChecks: checks.filter(({ number }) => !guardNumbers.includes(number)).length,
    rules: [...data.skills, ...data.agents, ...data.commands].reduce((sum, { rules }) => sum + (rules ?? 0), 0),
    ...tiers,
  };
};

export const evidenceTable = (instruction: Instruction, tier?: string) => {
  assert(instruction.path !== "", `evidence names its source file, got an empty path for ${instruction.name}; pass a file path.`);
  assert(tier === undefined || tier !== "", `a tier is a word, got an empty string for ${instruction.name}; pass the tier name or omit it.`);
  const [rules, mutation, budget] = evidenceRows(instruction);
  return table(
    ["Evidence", "Value"],
    [
      rules,
      mutation,
      ...(tier === undefined ? [] : [["Stamp tier", `<span class="tier tier-${tier}">${escapeHtml(tier)}</span>`]]),
      budget,
      ["Source file", `<code>${escapeHtml(instruction.path)}</code>`],
    ],
  );
};

export const skillPage = (skill: Skill, scriptPages: Map<string, string>): Page => {
  assert(skill.name !== "", `a skill page is named after its skill, got an empty name for ${skill.path}; fix the folder name.`);
  assert(scriptPages instanceof Map, `the script links are a Map of path to link, got ${typeof scriptPages}; pass the map.`);
  const scripts = skill.scripts.map((path) => {
    const link = scriptPages.get(path);
    return link ? `<a href="${relativeLink(`skills/${skill.name}.html`, link)}"><code>${escapeHtml(path)}</code></a>` : `<code>${escapeHtml(path)}</code>`;
  });
  const body = [
    `<h1 id="skill-${skill.name}">${escapeHtml(skill.name)}</h1>`,
    `<p class="lead">This page describes the skill <code>${escapeHtml(skill.name)}</code>. The text below comes from its own file.</p>`,
    `<h2 id="description">Description</h2>`,
    quotation(skill.path, skill.description),
    ...(skill.inputs.length ? [`<h2 id="inputs">Inputs</h2>`, bulletList(skill.inputs.map((input) => `<code>${escapeHtml(input)}</code>`))] : []),
    `<h2 id="sections">Sections of the skill</h2>`,
    bulletList(skill.sections.map((heading) => escapeHtml(heading))),
    ...(skill.steps.length ? [`<h2 id="steps">Steps</h2>`, `<ol>${skill.steps.map((step) => `<li>${escapeHtml(step.replace(/^\d+\.\s*/, ""))}</li>`).join("")}</ol>`] : []),
    ...(scripts.length ? [`<h2 id="scripts">Scripts it calls</h2>`, bulletList(scripts)] : []),
    `<h2 id="evidence">Evidence</h2>`,
    `<p>The numbers below come from <code>evals/rules</code>, <code>evals/results</code> and <code>evals/token-budget.json</code>.</p>`,
    evidenceTable(skill, skill.tier),
    `<p><a href="${relativeLink(`skills/${skill.name}.html`, SKILLS_INDEX)}">Back to all skills</a></p>`,
  ].join("\n");
  return { path: `skills/${skill.name}.html`, title: skill.name, summary: `The ${skill.name} skill: inputs, steps, scripts and evidence.`, body, source: GENERATOR_SOURCE };
};

export const skillsIndex = (data: SiteData): Page => {
  assert(Array.isArray(data.skills), `the skills index lists skills, got ${typeof data.skills}; pass the collected data.`);
  assert(new Set(data.skills.map(({ name }) => name)).size === data.skills.length, `skill names must be unique, got ${JSON.stringify(data.skills.map(({ name }) => name))}; rename one.`);
  return {
    path: SKILLS_INDEX,
    title: "Skills",
    summary: "Every skill of the plugin, with its eval tier and rule count.",
    source: GENERATOR_SOURCE,
    body: [
      `<h1>Skills</h1>`,
      `<p class="lead">The plugin ships ${data.skills.length} skills. Each skill has its own page.</p>`,
      `<h2 id="all-skills">All skills</h2>`,
      table(
        ["Skill", "Stamp tier", "Rules", "Mutation score", "Token budget"],
        data.skills.map((skill) => [
          `<a href="${skill.name}.html"><code>${escapeHtml(skill.name)}</code></a>`,
          `<span class="tier tier-${skill.tier}">${escapeHtml(skill.tier)}</span>`,
          ...evidenceRows(skill).map(([, value]) => value),
        ]),
      ),
    ].join("\n"),
  };
};

export const instructionSection = (kind: string, item: Instruction, details: [string, string][]) => {
  assert(kind !== "", `a section needs a kind for its id, got an empty one for ${item.name}; pass agent or command.`);
  assert(Array.isArray(details), `the section details are a list of rows, got ${typeof details} for ${item.name}; pass the rows.`);
  return [
    `<h2 id="${kind}-${item.name}">${escapeHtml(item.name)}</h2>`,
    quotation(item.path, item.description),
    table(["Fact", "Value"], [...details, ...evidenceRows(item), ["Source file", `<code>${escapeHtml(item.path)}</code>`]]),
  ].join("\n");
};

export const agentsPage = (agents: Agent[]): Page => {
  assert(Array.isArray(agents), `the agents page lists agents, got ${typeof agents}; pass the collected agents.`);
  assert(new Set(agents.map(({ name }) => name)).size === agents.length, `agent names must be unique, got ${JSON.stringify(agents.map(({ name }) => name))}; rename one.`);
  return {
    path: "agents.html",
    title: "Agents",
    summary: "The sub-agents the plugin ships.",
    source: GENERATOR_SOURCE,
    body: [
      `<h1>Agents</h1>`,
      `<p class="lead">The plugin ships ${agents.length} agents. A skill hands narrow work to an agent.</p>`,
      ...agents.map((agent) => instructionSection("agent", agent, [["Model", agent.model ? `<code>${escapeHtml(agent.model)}</code>` : "inherited from the session"], ["Tools", agent.tools ? `<code>${escapeHtml(agent.tools)}</code>` : NO_VALUE]])),
    ].join("\n"),
  };
};

export const commandsPage = (commands: Command[]): Page => {
  assert(Array.isArray(commands), `the commands page lists commands, got ${typeof commands}; pass the collected commands.`);
  assert(new Set(commands.map(({ name }) => name)).size === commands.length, `command names must be unique, got ${JSON.stringify(commands.map(({ name }) => name))}; rename one.`);
  return {
    path: "commands.html",
    title: "Commands",
    summary: "The slash commands the plugin ships.",
    source: GENERATOR_SOURCE,
    body: [
      `<h1>Commands</h1>`,
      `<p class="lead">The plugin ships ${commands.length} commands. A command can limit the tools it may use.</p>`,
      ...commands.map((command) => instructionSection("command", command, [["Allowed tools", command.allowedTools ? `<code>${escapeHtml(command.allowedTools)}</code>` : NO_VALUE]])),
    ].join("\n"),
  };
};

export const hooksPage = (hooks: Hook[]): Page => {
  assert(Array.isArray(hooks), `the hooks page lists hooks, got ${typeof hooks}; pass the collected hooks.`);
  assert(hooks.every(({ file }) => file !== undefined), `every hook needs a file name, got ${JSON.stringify(hooks.map(({ file }) => file))}; fix the hook registry command.`);
  return {
    path: "hooks.html",
    title: "Hooks",
    summary: "The hooks the plugin registers.",
    source: GENERATOR_SOURCE,
    body: [
      `<h1>Hooks</h1>`,
      `<p class="lead">The plugin registers ${hooks.length} hooks. Claude Code runs them with no model call.</p>`,
      ...hooks.flatMap((hook) => [
        `<h2 id="hook-${hook.file}">${escapeHtml(hook.file)}</h2>`,
        table(["Fact", "Value"], [["Event", `<code>${escapeHtml(hook.event)}</code>`], ["Tool matcher", `<code>${escapeHtml(hook.matcher)}</code>`], ["Behaviour test", hook.tested ? "present" : "missing"], ["Source file", `<code>${escapeHtml(hook.path)}</code>`]]),
      ]),
    ].join("\n"),
  };
};

export const pluginScriptsPage = (scripts: PluginScript[]): Page => {
  assert(Array.isArray(scripts), `the scripts page lists scripts, got ${typeof scripts}; pass the collected scripts.`);
  assert(new Set(scripts.map(({ name }) => name)).size === scripts.length, `script names must be unique, got ${JSON.stringify(scripts.map(({ name }) => name))}; rename one.`);
  return {
    path: "plugin-scripts.html",
    title: "Plugin scripts",
    summary: "The Node scripts that skills call, with their usage lines and exit codes.",
    source: GENERATOR_SOURCE,
    body: [
      `<h1>Plugin scripts</h1>`,
      `<p class="lead">The plugin ships ${scripts.length} Node scripts. Skills call them so that a script, not a prompt, does the exact work.</p>`,
      `<p>The build ran each script with no arguments in an empty folder. The usage lines below are the real output.</p>`,
      ...scripts.flatMap((script) => [
        `<h2 id="script-${script.name}">${escapeHtml(script.name)}</h2>`,
        script.usage.length ? `<pre><code>${escapeHtml(script.usage.join("\n"))}</code></pre>` : `<p>This script is a library. It has no command line.</p>`,
        script.exitCodes.length ? table(["Exit code", "Meaning"], script.exitCodes.map(({ code, name }) => [String(code), escapeHtml(name)])) : "",
        `<p>With no arguments it exits with code ${script.exitWithoutArguments}. Source: <code>${escapeHtml(script.path)}</code>.</p>`,
      ]),
    ].join("\n"),
  };
};

export const checksPage = (checks: CheckEntry[], warnOnly: number[], guardNumbers: number[]): Page => {
  assert(Array.isArray(checks), `the checks page lists checks, got ${typeof checks}; pass the registry rows.`);
  assert(warnOnly.every((number) => checks.some((check) => check.number === number)), `every warn-only check needs a registry row, got ${JSON.stringify(warnOnly)} against ${JSON.stringify(checks.map(({ number }) => number))}; fix the guard sections or the registry.`);
  assert(new Set(checks.map(({ number }) => number)).size === checks.length, `check numbers must be unique, got ${JSON.stringify(checks.map(({ number }) => number))}; renumber the repeat.`);
  return {
    path: "ci-checks.html",
    title: "CI checks",
    summary: "Every numbered CI check, with its rule, its fix and a real message.",
    source: GENERATOR_SOURCE,
    body: [
      `<h1>CI checks</h1>`,
      `<p class="lead">CI runs ${checks.length} numbered checks: ${checks.filter(({ number }) => guardNumbers.includes(number)).length} inside the consistency guard and ${checks.filter(({ number }) => !guardNumbers.includes(number)).length} standalone scripts. Each one is a rule that a script enforces.</p>`,
      `<p>The registry has no severity field. The page reads severity from the guard source.</p>`,
      `<div class="callout"><p>Most checks fail the pull request. ${warnOnly.length === 0 ? "No check only warns." : `These checks only warn: ${warnOnly.join(", ")}.`}</p></div>`,
      `<h2 id="checks">All checks</h2>`,
      table(["Number", "Title"], checks.map(({ number, title }) => [`<a href="#check-${number}">${number}</a>`, escapeHtml(title)])),
      ...checks.map((check) => checkCard(check)),
    ].join("\n"),
  };
};

export const evalTiersPage = (data: SiteData): Page => {
  assert(Array.isArray(data.skills), `the eval tiers page lists skills, got ${typeof data.skills}; pass the collected data.`);
  assert(data.skills.every(({ tier }) => [...TIERS, TIER_NONE].includes(tier)), `every skill needs a known tier, got ${JSON.stringify(data.skills.map(({ tier }) => tier))}; fix the stamp file.`);
  const tierCounts = Object.fromEntries([...TIERS, TIER_NONE].map((tier) => [tier, data.skills.filter((skill) => skill.tier === tier).length]));
  return {
    path: "eval-tiers.html",
    title: "Eval tiers",
    summary: "How each skill proves that it still works: live, static or waived.",
    source: GENERATOR_SOURCE,
    body: [
      `<h1>Eval tiers</h1>`,
      `<p class="lead">Each skill carries one stamp. The stamp says how the skill was last proven.</p>`,
      `<h2 id="tiers">The three tiers</h2>`,
      table(["Tier", "Skills", "Meaning"], [
        ['<span class="tier tier-live">live</span>', String(tierCounts.live), "A real model session ran the scenarios of the skill. Such a run costs money."],
        ['<span class="tier tier-static">static</span>', String(tierCounts.static), "No model ran. The scripts, the lint and the rule anchors of the skill all passed."],
        ['<span class="tier tier-waived">waived</span>', String(tierCounts.waived), "A person waived the eval and wrote down the reason."],
      ]),
      `<p>A stamp holds a hash of the skill files. The guard fails when a skill changes and its stamp does not match.</p>`,
      `<h2 id="by-skill">Tier of each skill</h2>`,
      table(["Skill", "Tier", "Stamped at"], data.skills.map((skill) => [`<a href="skills/${skill.name}.html"><code>${escapeHtml(skill.name)}</code></a>`, `<span class="tier tier-${skill.tier}">${escapeHtml(skill.tier)}</span>`, skill.stampedAt ? escapeHtml(skill.stampedAt) : NO_VALUE])),
    ].join("\n"),
  };
};

export const buildPages = (root: string, data: SiteData, checks: CheckEntry[]): Page[] => {
  assert(checks.length > 0, `the checks page needs registry rows, got none; pass the registry.`);
  const guardNumbers = guardSectionNumbers(root);
  const variables = siteVariables(data, checks, guardNumbers);
  const scriptPages = new Map(data.pluginScripts.map((script) => [script.path, `plugin-scripts.html#script-${script.name}`]));
  const handWritten = HAND_WRITTEN_PAGES.map(({ fragment, path, title, summary }): Page => {
    const source = `${FRAGMENTS_DIRECTORY}/${fragment}`;
    assert(existsSync(join(root, source)), `${source} is missing, so the page ${path} cannot render. Fix: add the fragment file.`);
    return { path, title, summary, source, body: renderFragment(readFileSync(join(root, source), "utf8"), { root, file: source, variables, checks }) };
  });
  return [
    ...handWritten,
    skillsIndex(data),
    ...data.skills.map((skill) => skillPage(skill, scriptPages)),
    agentsPage(data.agents),
    commandsPage(data.commands),
    hooksPage(data.hooks),
    pluginScriptsPage(data.pluginScripts),
    checksPage(checks, warnOnlyChecks(root), guardNumbers),
    evalTiersPage(data),
  ];
};

export const fragmentFiles = (root: string) => {
  assert(root !== "", `fragments live under the repository root, got an empty path; pass the root.`);
  assert(!root.endsWith(FRAGMENTS_DIRECTORY), `pass the repository root, got the fragment folder ${root}.`);
  const path = join(root, FRAGMENTS_DIRECTORY);
  return existsSync(path) ? readdirSync(path).filter((name) => name.endsWith(".html")).sort().map((name) => `${FRAGMENTS_DIRECTORY}/${name}`) : [];
};
