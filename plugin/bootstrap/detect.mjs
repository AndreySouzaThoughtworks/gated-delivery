import assert from "node:assert";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { delimiter, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * @typedef {{ name: string, marker: string, requires?: string }} Watcher
 * @typedef {{ search: { depth: number, skip: string[] }, watchers: Watcher[] }} MarkerTable
 */

/** @type {MarkerTable} */
const markerTable = JSON.parse(readFileSync(new URL("./markers.json", import.meta.url), "utf8"));

/** @type {Partial<Record<string, string>>} */
const LANGUAGE_BY_EXTENSION = {
  ".py": "python",
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
};
const LANGUAGE_BY_MARKER = {
  "pyproject.toml": "python",
  "setup.py": "python",
  "requirements.txt": "python",
  "package.json": "javascript",
  "tsconfig.json": "typescript",
};
/** @type {Partial<Record<string, string>>} */
const LANGUAGE_BY_OVERWATCH_NAME = { python: "python", vitest: "javascript", jest: "javascript", bun: "javascript", deno: "javascript" };
export const SUPPORTED_LANGUAGES = ["python", "typescript", "javascript"];

const PACKAGE_MANAGER_BY_LOCKFILE = {
  "uv.lock": "uv",
  "poetry.lock": "poetry",
  "pnpm-lock.yaml": "pnpm",
  "yarn.lock": "yarn",
  "package-lock.json": "npm",
  "bun.lock": "bun",
  "bun.lockb": "bun",
  "go.sum": "go",
  "Cargo.lock": "cargo",
};
const LINTER_MARKERS = {
  ruff: ["ruff.toml", ".ruff.toml"],
  mypy: ["mypy.ini"],
  eslint: [".eslintrc", ".eslintrc.json", ".eslintrc.js", ".eslintrc.cjs", "eslint.config.js", "eslint.config.mjs", "eslint.config.ts"],
  biome: ["biome.json", "biome.jsonc"],
  typescript: ["tsconfig.json"],
  "pre-commit": [".pre-commit-config.yaml"],
};
/** @type {Record<string, string>} */
const LINTER_TOOL_TABLES = { ruff: "[tool.ruff", mypy: "[tool.mypy" };
const OTHER_CI_MARKERS = [".gitlab-ci.yml", "Jenkinsfile", "azure-pipelines.yml", ".circleci"];
const GITHUB_WORKFLOWS_DIR = join(".github", "workflows");
const WORKFLOW_EXTENSIONS = [".yml", ".yaml"];
const GUARDRAIL_FILES = { zanityToml: "zanity.toml", zanityBaseline: "zanity-baseline.json", overwatchConfig: ".overwatch.json" };
const HIDDEN_PREFIX = ".";

/** @param {string} dir */
const listDir = (dir) => {
  const entries = readdirSync(dir, { withFileTypes: true });
  return entries;
};

/**
 * @param {string} root
 * @param {number} depthLeft
 * @param {string} [prefix]
 * @returns {string[]}
 */
const sourceFiles = (root, depthLeft, prefix = "") => {
  assert(depthLeft >= 0, `depth budget must not be negative, got ${depthLeft}`);
  const skipped = new Set(markerTable.search.skip);
  return listDir(join(root, prefix)).flatMap((entry) => {
    const relative = join(prefix, entry.name);
    if (entry.isDirectory()) {
      const descend = depthLeft > 0 && !skipped.has(entry.name) && !entry.name.startsWith(HIDDEN_PREFIX);
      return descend ? sourceFiles(root, depthLeft - 1, relative) : [];
    }
    return [relative];
  });
};

/** @param {string} tool */
const onPath = (tool) => {
  const found = (process.env.PATH ?? "").split(delimiter).some((dir) => dir && existsSync(join(dir, tool)));
  return found;
};

/** @param {string} repo */
export const detect = (repo) => {
  const root = resolve(repo);
  assert(existsSync(root), `${root} must exist, got missing; pass --repo <existing directory>`);
  const files = sourceFiles(root, markerTable.search.depth);
  const topLevel = new Set(listDir(root).map((entry) => entry.name));
  const languages = new Set([
    ...files.map((file) => LANGUAGE_BY_EXTENSION[extname(file)]),
    ...Object.entries(LANGUAGE_BY_MARKER).filter(([marker]) => topLevel.has(marker)).map(([, language]) => language),
  ].filter((language) => language !== undefined));
  const testRunners = markerTable.watchers
    .filter((watcher) => existsSync(join(root, watcher.marker)))
    .map(({ name, marker, requires }) => ({ name, marker, language: LANGUAGE_BY_OVERWATCH_NAME[name], requiresOnPath: requires ? onPath(requires) : true }));
  const workflowsDir = join(root, GITHUB_WORKFLOWS_DIR);
  const githubWorkflows = existsSync(workflowsDir)
    ? listDir(workflowsDir).map((entry) => entry.name).filter((name) => WORKFLOW_EXTENSIONS.includes(extname(name)))
    : [];
  const pyproject = topLevel.has("pyproject.toml") ? readFileSync(join(root, "pyproject.toml"), "utf8") : "";
  const linters = Object.entries(LINTER_MARKERS)
    .filter(([name, configFiles]) => configFiles.some((configFile) => topLevel.has(configFile)) || (name in LINTER_TOOL_TABLES && pyproject.includes(LINTER_TOOL_TABLES[name])))
    .map(([name]) => name);
  const result = {
    root,
    languages: [...languages].sort(),
    unsupportedLanguages: [...languages].filter((language) => !SUPPORTED_LANGUAGES.includes(language)),
    packageManagers: [...new Set(Object.entries(PACKAGE_MANAGER_BY_LOCKFILE).filter(([lockfile]) => topLevel.has(lockfile)).map(([, manager]) => manager))],
    testRunners,
    githubWorkflows,
    otherCi: OTHER_CI_MARKERS.filter((ciFile) => topLevel.has(ciFile)),
    linters,
    guardrails: Object.fromEntries(Object.entries(GUARDRAIL_FILES).map(([key, file]) => [key, topLevel.has(file)])),
  };
  return result;
};

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const repoFlag = process.argv.indexOf("--repo");
  const repo = repoFlag === -1 ? "." : process.argv[repoFlag + 1];
  console.log(JSON.stringify(detect(repo), null, 2));
}
