import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { skillHash } from "../eval/changed-skills.ts";
import { BASELINE_FILE as MESSAGE_BASELINE_FILE, BASELINE_RULE, baselineText } from "../audit/message-actionability/baseline.ts";
import { BASELINE_FILE as TOKEN_BASELINE_FILE, measureBudgets } from "../audit/token-budget/budget.ts";
import { PROSE_SCAN_SCRIPT } from "../audit/prose-tic-drift.ts";
import { LIVE_OPT_IN_FILE, LIVE_GH_OPT_IN_FILE } from "../audit/ci-parity.ts";
import { gitRepo } from "./git-fixture.test.support.ts";
import { ONE_SCENARIO, STRICT_TSC_FLAGS, STRICT_ZANITY_CONFIG, runGuard, validRepo, write } from "./consistency-fixtures.test.support.ts";

const AUDIT_DIRECTORY = join(dirname(fileURLToPath(import.meta.url)), "..", "audit");
const PROBLEM_LINE = /^\s+(?:ERROR|WARN)\s+(.*)$/;
const SKILL_HEADER = "---\nname: alpha\ndescription: x\n---\n\n## Heading One\n\n";
const README_COUNTS = "The plugin — 1 skills, 1 agents, 1 hooks.\n\n[MIT](LICENSE)\n";
const GIT_IDENTITY = ["-c", "user.name=t", "-c", "user.email=t@t"];
const BASE_BRANCH = "main";
const FEATURE_BRANCH = "feature";
const FILLER_CHARACTERS = 4000;
const LONG_SENTENCE = "This sentence is deliberately made much longer than twenty words so that the share of short sentences in this small document falls below the limit that the style check enforces.\n";
const TIC_LIST = 'export const TICS = [{ phrases: ["worth noting", "honestly", "not just"] }];\nexport const ORDINARY_PHRASES = [];\n';
const MATRIX_WORKFLOW = "name: audit\njobs:\n  consistency:\n    name: ${{ matrix.name }}\n    strategy:\n      matrix:\n        include:\n          - name: consistency\n            node-version: 22\n          - name: node 26\n            node-version: 26\n    steps:\n      - run: node scripts/audit/consistency.ts\n  node-26:\n    name: node 26\n    steps:\n      - run: node scripts/audit/consistency.ts\n";
const SUBJECT = 'import assert from "node:assert";\nexport const shout = (text) => {\n  assert(typeof text === "string", "text must be a string");\n  return text.toUpperCase();\n};\n';
const STRINGS_ONLY_TEST = 'import { test } from "node:test";\nimport assert from "node:assert";\nimport { shout } from "./subject.mjs";\ntest("shouts", () => assert.equal(shout("a"), "A"));\n';
const UNDOCUMENTED_VARIABLE = ["GATED_DELIVERY", "UNDOCUMENTED"].join("_");
const CONSTANT_CONDITION_SOURCE = ["if", " (1 === 1) {\n  console.log(1);\n}\n"].join("");
const ESLINT_DISABLE = ["eslint", "disable-next-line"].join("-");

type RepoEdit = { files?: Record<string, string>; remove?: string[]; baseRef?: string };
export type Plant = RepoEdit & { match: RegExp };

const SKILL_WITH_INVENTORY = { file: "plugin/skills/alpha/SKILL.md", rules: [{ id: "alpha.no-merge", anchor: "Auto-merge PRs", kind: "never", why: "a person merges" }], exempt: [] };

export const GUARD_PLANTS: Record<number, Plant> = {
  1: { remove: ["plugin/skills/alpha/evals.md"], match: /skill "alpha" is missing evals\.md/ },
  2: { files: { "plugin/agents/bot.md": "---\nname: other\ndescription: x\n---\n" }, match: /agent "bot": frontmatter name/ },
  3: { files: { "plugin/hooks/hooks.json": JSON.stringify({ hooks: [{ command: "node hooks/h.mjs hooks/gone.mjs" }] }) }, match: /hooks\.json references missing hook file/ },
  4: { files: { ".claude-plugin/marketplace.json": JSON.stringify({ plugins: [{ name: "p", source: "nowhere" }] }) }, match: /marketplace plugin "p"/ },
  5: { files: { "README.md": README_COUNTS.replace("1 skills", "3 skills") }, match: /README\.md says "3 skills"/ },
  6: { files: { "docs/skill-graph.md": "| `bot` | an agent |\n| `h.mjs` | a hook |\n" }, match: /skill "alpha" is not documented in docs\/skill-graph\.md/ },
  7: { files: { "plugin/skills/alpha/evals.md": `${ONE_SCENARIO}| x | \`grep -c -e "Heading One" out\` |\n` }, match: /measure "heading one" must not also appear/ },
  8: { files: { "zanity.toml": STRICT_ZANITY_CONFIG.replace('["all"]', '["correctness"]') }, match: /zanity\.toml must keep select/ },
  9: { files: { "plugin/skills/alpha/SKILL.md": "---\nname: alpha\ndescription:\n---\n" }, match: /skill "alpha" has no frontmatter description/ },
  10: { files: { "plugin/skills/alpha/evals.md": "## Test Scenarios\n\n| # | Prompt |\n|---|---|\n| 1 | a |\n| 1 | b |\n" }, match: /alpha\/evals\.md repeats scenario id 1/ },
  11: { files: { "docs/notes.md": "Run scripts/gone.sh now.\n" }, match: /names scripts\/gone\.sh/ },
  12: {
    files: {
      "plugin/references/reference-graph.md": "| `lonely.md` | a reference |\n",
      "plugin/references/lonely.md": "text\n",
      "docs/skill-graph.md": "| `/alpha` | a skill |\n| `bot` | an agent |\n| `h.mjs` | a hook |\n| `reference-graph.md` | the index |\n",
    },
    match: /reference "lonely\.md" is read by no skill/,
  },
  13: { remove: ["plugin/hooks/h.test.mjs"], match: /hook "h\.mjs" has no colocated/ },
  14: { files: { "docs/skill-graph.md": "| `/alpha` | a skill |\n| `bot` | an agent |\n" }, match: /hook "h\.mjs" is not documented/ },
  15: { files: { ".claude-plugin/marketplace.json": JSON.stringify({ metadata: { version: "1.0.0" }, plugins: [{ name: "p", source: "plugin" }] }) }, match: /marketplace\.json carries a version/ },
  16: { files: { "scripts/x.ts": `export const name = '${UNDOCUMENTED_VARIABLE}';\n` }, match: /reads GATED_DELIVERY.UNDOCUMENTED, which no markdown names/ },
  17: { files: { "scripts/x.ts": CONSTANT_CONDITION_SOURCE }, match: /has a condition that never varies/ },
  19: { files: { "plugin/.claude-plugin/plugin.json": JSON.stringify({ name: "p", version: "1.0.0" }) }, match: /plugin\.json carries a version/ },
  20: { files: { "plugin/hooks/h.mjs": 'import "./a.ts";\n' }, match: /must not import TypeScript/ },
  21: { files: { ".cursor/hooks.json": JSON.stringify({ hooks: { beforeShellExecution: [{ command: "node gone.mjs", failClosed: true }] } }) }, match: /runs gone\.mjs, which does not exist/ },
  22: { files: { "scripts/audit/consistency.ts": "// --- 1. a\n// --- 1. b\n" }, match: /must not repeat check number 1/ },
  23: { files: { "tsconfig.json": JSON.stringify({ compilerOptions: { ...STRICT_TSC_FLAGS, noUnusedLocals: false } }) }, match: /tsconfig\.json must set compilerOptions\.noUnusedLocals/ },
  24: { remove: ["LICENSE"], match: /LICENSE is missing or empty/ },
  25: { files: { "evals/results/alpha.json": JSON.stringify({ hash: "x" }) }, match: /README\.md has no "/ },
  26: { files: { "plugin/agents/bot.md": "---\nname: bot\ndescription: x\nmodel: opus\n---\n" }, match: /agent "bot" pins model "opus"/ },
  27: {
    files: { "plugin/skills/alpha/SKILL.md": `${SKILL_HEADER}Never merge a pull request.\n`, "evals/rules/skill-alpha.json": JSON.stringify(SKILL_WITH_INVENTORY) },
    match: /anchor "Auto-merge PRs" is in none of/,
  },
  29: { files: { ".github/workflows/audit.yml": MATRIX_WORKFLOW }, match: /node-26|consistency guard|second job/ },
  30: { files: { [`tests/${LIVE_OPT_IN_FILE}`]: "exit 64\n", [`tests/${LIVE_GH_OPT_IN_FILE}`]: "exit 64\n", "tests/live.test.sh": "#!/usr/bin/env bash\nclaude -p ping\n" }, match: /tests\/live\.test\.sh/ },
  31: { files: { "package.json": JSON.stringify({ engines: { node: ">=22.18" } }), "README.md": `${README_COUNTS}\nHooks run on Node 18 or later.\n` }, match: /README\.md says "Node 18 or later"/ },
  33: { files: { "scripts/audit/asd-style.ts": "", "docs/long.md": LONG_SENTENCE }, match: /docs\/long\.md has/ },
  34: { files: { "scripts/audit/guide-freshness.ts": "" }, match: /docs\/guide\.html is missing/ },
  35: {
    files: {
      "plugin/skills/prose-writing/SKILL.md": SKILL_HEADER.replace("alpha", "prose-writing"),
      "plugin/skills/prose-writing/evals.md": `${ONE_SCENARIO}## Deterministic Checks\n\n\`\`\`bash\n# expect: manual\ngrep -c foo output.md\n\`\`\`\n`,
      "README.md": README_COUNTS.replace("1 skills", "2 skills"),
      "plugin/README.md": "| `/alpha` | a skill |\n| `/prose-writing` | a skill |\n| `bot` | an agent |\n",
      "docs/skill-graph.md": "| `/alpha` | a skill |\n| `/prose-writing` | a skill |\n| `bot` | an agent |\n| `h.mjs` | a hook |\n",
      [PROSE_SCAN_SCRIPT]: TIC_LIST,
      "plugin/skills/alpha/SKILL.md": `${SKILL_HEADER}grep -nEi 'worth noting|honestly' <path>\n`,
    },
    match: /lists the tic phrases/,
  },
};

const problemLine = (output: string, match: RegExp) => {
  assert(output.length > 0, `the tool printed nothing, got ${JSON.stringify(output)}; run it on a planted repo that fails`);
  const line = output.split("\n").map((candidate) => PROBLEM_LINE.exec(candidate)?.[1] ?? candidate.trim()).find((candidate) => match.test(candidate));
  assert(line !== undefined, `the output must hold a line matching ${match}, got: ${output}`);
  return line;
};

const git = (dir: string, args: string[]) => {
  assert(dir.length > 0, `git runs in a repo folder, got ${JSON.stringify(dir)}; pass one`);
  assert(args.length > 0, `git needs a subcommand, got none; pass one`);
  return execFileSync("git", [...GIT_IDENTITY, ...args], { cwd: dir, encoding: "utf8" });
};

const plantedRepo = ({ files = {}, remove = [] }: RepoEdit) => {
  const dir = validRepo();
  for (const path of remove) rmSync(join(dir, path));
  for (const [path, body] of Object.entries(files)) write(dir, path, body);
  assert(Object.keys(files).length + remove.length > 0, `a planted repo must change something, got an empty edit; name a file`);
  assert(remove.every((path) => !existsSync(join(dir, path))), `every removed file must be gone, got ${remove}; remove it`);
  return dir;
};

const stampPlant = () => {
  const dir = validRepo();
  git(dir, ["init", "-q", "-b", BASE_BRANCH]);
  git(dir, ["add", "."]);
  git(dir, ["commit", "-q", "-m", "base"]);
  git(dir, ["checkout", "-q", "-b", FEATURE_BRANCH]);
  write(dir, "plugin/skills/alpha/SKILL.md", `${SKILL_HEADER}Edited.\n`);
  git(dir, ["add", "."]);
  git(dir, ["commit", "-q", "-m", "change"]);
  assert(git(dir, ["rev-parse", "--abbrev-ref", "HEAD"]).trim() === FEATURE_BRANCH, `the edit must sit on ${FEATURE_BRANCH}; check out that branch`);
  assert(skillHash(dir, "alpha").length > 0, `the changed skill must have a hash, got none`);
  return runGuard(dir, { GATED_DELIVERY_BASE_REF: BASE_BRANCH }).out;
};

const tokenBudgetPlant = () => {
  const dir = validRepo();
  write(dir, "scripts/audit/token-budget.ts", "");
  write(dir, "plugin/skills/alpha/SKILL.md", `${SKILL_HEADER}${"a".repeat(FILLER_CHARACTERS)}\n`);
  const budgets = Object.fromEntries(measureBudgets(dir).map(({ path, tokens }) => [path, tokens - (path === "plugin/skills/alpha/SKILL.md" ? 1 : 0)]));
  write(dir, TOKEN_BASELINE_FILE, JSON.stringify({ budgets }));
  assert(Object.keys(budgets).length > 0, `the budget table must list files, got none`);
  assert(Object.hasOwn(budgets, "plugin/skills/alpha/SKILL.md"), `the budget table must list the grown skill, got ${Object.keys(budgets)}`);
  return runGuard(dir).out;
};

const messageActionabilityPlant = () => {
  const dir = validRepo();
  write(dir, "scripts/audit/message-actionability.ts", "");
  write(dir, "plugin/scripts/a.mjs", 'assert(ok, "something went wrong here");\n');
  write(dir, MESSAGE_BASELINE_FILE, baselineText([{ path: "plugin/scripts/a.mjs", rule: BASELINE_RULE, message: "other message here" }]));
  git(dir, ["init", "-q"]);
  git(dir, ["add", "-A"]);
  assert(git(dir, ["ls-files", "plugin/scripts/a.mjs"]).trim() === "plugin/scripts/a.mjs", `the fixture must track its source file`);
  assert(git(dir, ["ls-files", MESSAGE_BASELINE_FILE]).trim() === MESSAGE_BASELINE_FILE, `the fixture must track its baseline`);
  return runGuard(dir).out;
};

const standalone = (script: string, dir: string, extra: string[] = []) => {
  assert(script.endsWith(".ts"), `a standalone check is a .ts script, got ${script}; name the script file`);
  const result = spawnSync("node", [join(AUDIT_DIRECTORY, script), "--repo", dir, ...extra], { encoding: "utf8" });
  assert(result.status !== null, `${script} must exit on its own, got signal ${result.signal}; rerun it`);
  return result.stdout + result.stderr;
};

const COMMENTS_FILES = { "plugin/hooks/h.mjs": "// Until now nothing ran those fences.\nexport const answer = 1;\n" };
const SUPPRESSIONS_FILES = { "src/a.mjs": `// ${ESLINT_DISABLE} no-console\nconsole.log(1);\n`, "scripts/audit/suppressions.count": "1\n" };
const JSDOC_FILES = { "plugin/a.mjs": "/**\n * Does a thing.\n */\nexport const f = 1;\n" };
const ASSERTION_FILES = { "scripts/subject.mjs": SUBJECT, "scripts/subject.test.mjs": STRINGS_ONLY_TEST };
const ASSERTION_TEST_COMMAND = ["--test-command", "node --test scripts/subject.test.mjs"];

type Run = { output: string; match: RegExp };
const SPECIAL_PLANTS: Record<number, () => Run> = {
  18: () => ({ output: stampPlant(), match: /skill alpha has no stamp/ }),
  28: () => ({ output: tokenBudgetPlant(), match: /grew to \d+ estimated tokens/ }),
  32: () => ({ output: messageActionabilityPlant(), match: /must not hold the non-actionable message/ }),
  36: () => ({ output: standalone("comments.ts", gitRepo(COMMENTS_FILES, "plant-comments-")), match: /temporal-contrast/ }),
  37: () => ({ output: standalone("suppressions.ts", gitRepo(SUPPRESSIONS_FILES, "plant-suppressions-")), match: /has no reason/ }),
  38: () => ({ output: standalone("jsdoc-types-only.ts", gitRepo(JSDOC_FILES, "plant-jsdoc-")), match: /plugin\/a\.mjs:\d+/ }),
  39: () => ({ output: standalone("assertion-effectiveness.ts", gitRepo(ASSERTION_FILES, "plant-assertions-"), ASSERTION_TEST_COMMAND), match: /never false shout:3/ }),
};

export const PLANTED_NUMBERS = [...Object.keys(GUARD_PLANTS), ...Object.keys(SPECIAL_PLANTS)].map(Number).sort((a, b) => a - b);

export const plantedMessage = (number: number) => {
  assert(PLANTED_NUMBERS.includes(number), `check ${number} has no planted bad case; add it to GUARD_PLANTS or SPECIAL_PLANTS`);
  const special = SPECIAL_PLANTS[number];
  if (special) {
    const { output, match } = special();
    return problemLine(output, match);
  }
  const plant = GUARD_PLANTS[number];
  assert(plant.match instanceof RegExp, `check ${number} needs a match pattern, got ${typeof plant.match}; name the message it plants`);
  return problemLine(runGuard(plantedRepo(plant)).out, plant.match);
};

export const repoFile = (relativePath: string) => {
  assert(relativePath.length > 0, `a repo file needs a path, got an empty one; name the file`);
  assert(!relativePath.startsWith("/"), `a repo file path is relative to the repo root, got ${relativePath}; drop the leading slash`);
  return readFileSync(join(AUDIT_DIRECTORY, "..", "..", relativePath), "utf8");
};
