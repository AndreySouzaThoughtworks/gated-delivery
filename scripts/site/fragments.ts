import assert from "node:assert";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { MISTAKES_FILE, dataBlock, excerptBlock, mistakeRows, ruleQuotation } from "./facts.ts";
import type { FactContext } from "./facts.ts";
import { callout, checkCard, inlineCode, stackedTable, terminal } from "./html.ts";

export const FRAGMENTS_DIRECTORY = "docs-site-src";
export const DEMOS_DIRECTORY = `${FRAGMENTS_DIRECTORY}/demos`;
export { MISTAKES_FILE, mistakeRows } from "./facts.ts";

const VARIABLE = /\{\{\s*([\w.]+)\s*\}\}/g;
const CALLOUT = /<x-callout>([\s\S]*?)<\/x-callout>/g;
const TERMINAL = /<x-terminal title="([^"]+)">([\s\S]*?)<\/x-terminal>/g;
const DEMO = /<x-demo name="([\w-]+)"\s*\/>/g;
const MISTAKE = /<x-mistake match="([^"]+)"\s*\/>/g;
const RULE = /<x-rule id="([\w.-]+)"\s*\/>/g;
const EXCERPT = /<x-excerpt file="([^"]+)" start="([^"]+)" lines="(\d+)"\s*\/>/g;
const DATA = /<x-data name="([\w-]+)"\s*\/>/g;
const CHECK = /<x-check number="(\d+)"\s*\/>/g;
const MISTAKE_COLUMNS = ["Mistake", "Category", "Rule"];
const DEMO_TIMEOUT_MS = 10000;
const FIXTURE_DATE = "2026-01-01T00:00:00Z";
const FIXTURE_LABEL = "<fixture>";
const REPOSITORY_LABEL = "<repo>";
const FIXTURE_ENVIRONMENT = {
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Demo",
  GIT_AUTHOR_EMAIL: "demo@noreply.example",
  GIT_COMMITTER_NAME: "Demo",
  GIT_COMMITTER_EMAIL: "demo@noreply.example",
  GIT_AUTHOR_DATE: FIXTURE_DATE,
  GIT_COMMITTER_DATE: FIXTURE_DATE,
};
const PROMPT = "$ ";
const FIRST_COLUMNS = 3;

export type Demo = { script: string; args: string[]; setup?: string[]; cwd?: string; env?: Record<string, string> };
export type FragmentContext = FactContext & { file: string };

export const demoOutput = (root: string, name: string) => {
  const folder = join(root, DEMOS_DIRECTORY, name);
  assert(existsSync(join(folder, "demo.json")), `${DEMOS_DIRECTORY}/${name}/demo.json is missing, so the demo "${name}" cannot run. Fix: add demo.json with a script and its arguments.`);
  const demo: Demo = JSON.parse(readFileSync(join(folder, "demo.json"), "utf8"));
  assert(typeof demo.script === "string" && Array.isArray(demo.args), `${DEMOS_DIRECTORY}/${name}/demo.json must hold a script and an args list, got ${JSON.stringify(demo)}; add both.`);
  const made = mkdtempSync(join(tmpdir(), "site-demo-"));
  const scratch = realpathSync(made);
  try {
    cpSync(folder, scratch, { recursive: true });
    const binFolder = join(scratch, "bin");
    const environment: NodeJS.ProcessEnv = { ...process.env, ...FIXTURE_ENVIRONMENT, ROOT: root, FIXTURE: scratch, HOME: scratch, PATH: existsSync(binFolder) ? `${binFolder}${delimiter}${process.env.PATH}` : process.env.PATH };
    for (const [key, value] of Object.entries(demo.env ?? {})) environment[key] = value.replaceAll("$ROOT", root).replaceAll("$FIXTURE", scratch);
    for (const command of demo.setup ?? []) {
      const prepared = spawnSync("sh", ["-c", command], { cwd: scratch, env: environment, encoding: "utf8", timeout: DEMO_TIMEOUT_MS });
      assert(prepared.status === 0, `${DEMOS_DIRECTORY}/${name}/demo.json setup command "${command}" exited with ${prepared.status}: ${prepared.stderr.trim()}. Fix: correct the command in demo.json.`);
    }
    const run = spawnSync(process.execPath, [join(root, demo.script), ...demo.args.map((argument) => argument.replaceAll("$FIXTURE", scratch))], { cwd: join(scratch, demo.cwd ?? ""), env: environment, encoding: "utf8", timeout: DEMO_TIMEOUT_MS });
    const scriptName = demo.script.split("/").at(-1);
    const command = `${PROMPT}node ${scriptName} ${demo.args.map((argument) => (argument.includes(" ") ? JSON.stringify(argument) : argument)).join(" ")}`.trimEnd();
    const output = `${run.stdout}${run.stderr}`.trimEnd().replaceAll(scratch, FIXTURE_LABEL).replaceAll(made, FIXTURE_LABEL).replaceAll(root, REPOSITORY_LABEL);
    return `${command}\n${output}\n(exit ${run.status})`;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
};

export const expandVariable = (context: FragmentContext) => (_match: string, name: string) => {
  assert(name !== "", `${context.file} uses an empty variable {{}}; name a site variable.`);
  const value = context.variables[name];
  assert(value !== undefined, `${context.file} uses {{${name}}}, which is not a site variable. Fix: use one of ${Object.keys(context.variables).join(", ")}.`);
  return String(value);
};

const expandMistake = (context: FragmentContext) => (_match: string, fragment: string) => {
  assert(fragment.trim() !== "", `${context.file} has an x-mistake with a blank match; copy a phrase from a real row.`);
  const rows = mistakeRows(readFileSync(join(context.root, MISTAKES_FILE), "utf8"));
  const row = rows.find((cells) => cells[0].includes(fragment));
  assert(row, `${context.file} quotes a mistake that matches "${fragment}", but ${MISTAKES_FILE} has no such row. Fix: copy a phrase from the first column of a real row.`);
  return stackedTable(MISTAKE_COLUMNS, [row.slice(0, FIRST_COLUMNS).map(inlineCode)]);
};

const expandCheck = (context: FragmentContext) => (_match: string, digits: string) => {
  assert(Number(digits) > 0, `${context.file} shows check ${digits}, but check numbers start at 1; use a registry number.`);
  const check = context.checks.find(({ number }) => number === Number(digits));
  assert(check, `${context.file} shows check ${digits}, but the registry has no such check. Fix: use a number from the registry.`);
  return checkCard(check);
};

export const renderFragment = (text: string, context: FragmentContext) => {
  assert(typeof text === "string", `a fragment is text, got ${typeof text}; pass the file body.`);
  assert(context.file !== "", `a fragment needs a file name for its messages, got an empty one; pass its path.`);
  return text
    .replace(TERMINAL, (_match, title: string, body: string) => terminal(title, body.replace(/^\n/, "")))
    .replace(DEMO, (_match, name: string) => terminal(`Real output of ${name}`, demoOutput(context.root, name)))
    .replace(MISTAKE, expandMistake(context))
    .replace(RULE, (_match, id: string) => ruleQuotation(context.root, id))
    .replace(EXCERPT, (_match, file: string, start: string, lines: string) => excerptBlock(context.root, file, start.replaceAll("&quot;", '"'), Number(lines)))
    .replace(DATA, (_match, name: string) => dataBlock(name, context))
    .replace(CHECK, expandCheck(context))
    .replace(CALLOUT, (_match, inner: string) => callout(inner))
    .replace(VARIABLE, expandVariable(context));
};

